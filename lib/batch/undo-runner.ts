/**
 * Background runner that reverses an import: deletes every record the original
 * job created in QuickBooks. Uses the qboId logged per row. Best-effort per
 * record (a record already deleted/edited in QBO is reported, not fatal).
 *
 * Wrapped in a single top-level try/catch (runInner) for the same reason
 * commit-runner.ts is: without one, ANY unexpected throw here — including a
 * transient DB blip on one of the periodic checkpoint writes below, which
 * happen every 10 records and are outside the per-record try/catch — left the
 * job pinned at "running" forever (Inngest retries:0 on this function, and
 * nothing else was watching it). Now a crash marks the undo failed with the
 * real reason instead of hanging silently.
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getEntity } from "./entities";
import { getOrgQboToken } from "@/lib/qbo-token";
import { qboReadOne, qboDelete } from "./qbo-client";
import { detectProvider } from "./provider";
import { getXeroEntity } from "./xero/registry";
import { getOrgXeroToken } from "@/lib/xero-token";
import { deleteXeroRecord } from "./xero/delete";

export async function runBatchUndoJob(undoJobId: string): Promise<void> {
  const [undoJob] = await db.select().from(batchJobs).where(eq(batchJobs.id, undoJobId)).limit(1);
  if (!undoJob || undoJob.status === "done" || undoJob.status === "failed") return;

  const fail = (error: string) =>
    db.update(batchJobs).set({ status: "failed", results: [{ ok: false, error }], input: null, finishedAt: new Date() })
      .where(eq(batchJobs.id, undoJobId));

  try {
    await runInner();
  } catch (e: any) {
    await fail(e?.message || "The undo crashed unexpectedly").catch(() => {});
  }
  return;

  async function runInner(): Promise<void> {

  const originalJobId = (undoJob.input as any)?.originalJobId as string | undefined;
  if (!originalJobId) { await fail("Missing original job reference"); return; }

  const [orig] = await db.select().from(batchJobs).where(eq(batchJobs.id, originalJobId)).limit(1);
  if (!orig) { await fail("Original job not found"); return; }

  const provider = await detectProvider(undoJob.orgId);
  const created = ((orig.results as any[]) || []).filter((r) => r.ok && r.qboId);
  await db.update(batchJobs).set({ status: "running", totalRows: created.length }).where(eq(batchJobs.id, undoJobId));

  // ── Xero: delete each created record via its delete semantics ──
  if (provider === "xero") {
    const xe = getXeroEntity(orig.entityId);
    const xtoken = xe ? await getOrgXeroToken(undoJob.orgId).catch(() => null) : null;
    if (!xe || !xtoken) { await fail("Xero entity/connection unavailable"); return; }
    const xr: any[] = [];
    let xs = 0;
    for (let i = 0; i < created.length; i++) {
      const del = await deleteXeroRecord(xtoken, xe, String(created[i].qboId));
      if (del.ok) { xs++; xr.push({ qboId: created[i].qboId, ok: true }); }
      else xr.push({ qboId: created[i].qboId, ok: false, error: del.error });
      if ((i + 1) % 10 === 0) await db.update(batchJobs).set({ successCount: xs, errorCount: i + 1 - xs }).where(eq(batchJobs.id, undoJobId));
    }
    await db.update(batchJobs).set({ status: "done", successCount: xs, errorCount: created.length - xs, results: xr, input: null, finishedAt: new Date() }).where(eq(batchJobs.id, undoJobId));
    await db.update(batchJobs).set({ undoneAt: new Date() }).where(eq(batchJobs.id, originalJobId));
    return;
  }

  const entity = getEntity(orig.entityId);
  if (!entity?.qboEntity) { await fail("Unknown entity"); return; }

  const token = await getOrgQboToken(undoJob.orgId).catch(() => null);
  if (!token) { await fail("QuickBooks is not connected"); return; }

  const results: any[] = [];
  let successCount = 0;
  for (let i = 0; i < created.length; i++) {
    const id = String(created[i].qboId);
    try {
      const rec = await qboReadOne(token, entity.qboEntity, id);
      if (!rec) { results.push({ qboId: id, ok: false, error: "Already gone in QuickBooks" }); }
      else {
        const del = await qboDelete(token, entity.qboEntity, id, rec.SyncToken);
        if (del.ok) { successCount++; results.push({ qboId: id, ok: true }); }
        else results.push({ qboId: id, ok: false, error: del.error });
      }
    } catch (e: any) {
      results.push({ qboId: id, ok: false, error: e?.message || "Delete failed" });
    }
    if ((i + 1) % 10 === 0)
      await db.update(batchJobs).set({ successCount, errorCount: i + 1 - successCount }).where(eq(batchJobs.id, undoJobId));
  }

  await db.update(batchJobs).set({
    status: "done", successCount, errorCount: created.length - successCount,
    results, input: null, finishedAt: new Date(),
  }).where(eq(batchJobs.id, undoJobId));

  // Mark the original as reversed.
  await db.update(batchJobs).set({ undoneAt: new Date() }).where(eq(batchJobs.id, originalJobId));
  }
}