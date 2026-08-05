/**
 * Background runner that reverses an import: deletes every record the original
 * job created in QuickBooks. Uses the qboId logged per row. Best-effort per
 * record (a record already deleted/edited in QBO is reported, not fatal).
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getEntity } from "./entities";
import { getOrgQboToken } from "@/lib/qbo-token";
import { qboReadOne, qboDelete } from "./qbo-client";

export async function runBatchUndoJob(undoJobId: string): Promise<void> {
  const [undoJob] = await db.select().from(batchJobs).where(eq(batchJobs.id, undoJobId)).limit(1);
  if (!undoJob || undoJob.status === "done" || undoJob.status === "failed") return;

  const fail = (error: string) =>
    db.update(batchJobs).set({ status: "failed", results: [{ ok: false, error }], input: null, finishedAt: new Date() })
      .where(eq(batchJobs.id, undoJobId));

  const originalJobId = (undoJob.input as any)?.originalJobId as string | undefined;
  if (!originalJobId) { await fail("Missing original job reference"); return; }

  const [orig] = await db.select().from(batchJobs).where(eq(batchJobs.id, originalJobId)).limit(1);
  if (!orig) { await fail("Original job not found"); return; }

  const entity = getEntity(orig.entityId);
  if (!entity?.qboEntity) { await fail("Unknown entity"); return; }

  const token = await getOrgQboToken(undoJob.orgId).catch(() => null);
  if (!token) { await fail("QuickBooks is not connected"); return; }

  const created = ((orig.results as any[]) || []).filter((r) => r.ok && r.qboId);
  await db.update(batchJobs).set({ status: "running", totalRows: created.length }).where(eq(batchJobs.id, undoJobId));

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
