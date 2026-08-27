/**
 * POST /api/batch/delete/commit
 * JSON body: { entity, targets: [{ id, syncToken }] }
 *
 * QBO: stages the targets on a job and hands off to the chunked engine
 * (lib/batch/delete-chunk-runner.ts) — same durable, resumable pattern as
 * imports. This used to run the WHOLE delete loop synchronously in this
 * handler with a single db.update at the very end: past a few hundred
 * records (or any hiccup), the platform could kill the function mid-loop
 * with an unknown number of irreversible deletes already done in QuickBooks
 * and ZERO record of which ones. That's a worse blind spot than a stuck
 * import, since there's no source file left to diff against afterward.
 *
 * Xero: unchanged — synchronous, smaller volumes, not the reported issue.
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";
import { getEntity } from "@/lib/batch/entities";
import { getOrgQboToken } from "@/lib/qbo-token";
import { detectProvider } from "@/lib/batch/provider";
import { getXeroEntity } from "@/lib/batch/xero/registry";
import { getOrgXeroToken } from "@/lib/xero-token";
import { deleteXeroRecord } from "@/lib/batch/xero/delete";
import { inngest } from "@/lib/inngest";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id as string;

  const body = await req.json().catch(() => null);
  if (!body) return bad("Invalid JSON body");

  const provider = await detectProvider(orgId!);
  const targets: { id: string; syncToken: string }[] = Array.isArray(body.targets) ? body.targets : [];
  if (targets.length === 0) return bad("No records selected");

  // ── Xero path — unchanged, synchronous ──
  if (provider === "xero") {
    const xe = getXeroEntity(String(body.entity || ""));
    if (!xe || !xe.supports.delete) return bad("This entity can't be deleted");
    const xtoken = await getOrgXeroToken(orgId!).catch(() => null);
    if (!xtoken) return bad("Xero is not connected for this organisation", 400);
    const [xjob] = await db.insert(batchJobs).values({
      orgId: orgId!, userId, operation: "delete", entityId: xe.id, entityLabel: xe.label,
      status: "running", totalRows: targets.length,
    }).returning({ id: batchJobs.id });
    const xresults: any[] = [];
    let xsuccess = 0;
    for (const t of targets) {
      const res = await deleteXeroRecord(xtoken, xe, t.id);
      if (res.ok) { xsuccess++; xresults.push({ id: t.id, ok: true }); }
      else xresults.push({ id: t.id, ok: false, error: res.error });
    }
    await db.update(batchJobs).set({ status: "done", successCount: xsuccess, errorCount: targets.length - xsuccess, results: xresults, finishedAt: new Date() }).where(eq(batchJobs.id, xjob.id));
    return ok({ jobId: xjob.id, total: targets.length, successCount: xsuccess, errorCount: targets.length - xsuccess, results: xresults, chunked: false });
  }

  // ── QBO path — staged, chunked, server-driven ──
  const entity = getEntity(String(body.entity || ""));
  if (!entity) return bad("Unknown entity", 404);
  if (!entity.supports.delete || !entity.qboEntity) {
    return bad(entity.note || "This entity does not support delete");
  }

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected for this organisation", 400);

  const [job] = await db.insert(batchJobs).values({
    orgId: orgId!,
    userId,
    operation: "delete",
    entityId: entity.id,
    entityLabel: entity.label,
    status: "running",
    totalRows: targets.length,
    processedCount: 0,
    leaseUntil: new Date(), // see upload/start route — the chunk-resumable marker
    input: { targets },
  }).returning({ id: batchJobs.id });

  await inngest.send({ name: "batch/chunk-run", data: { jobId: job.id, orgId: orgId! } }).catch(() => {});

  return ok({ jobId: job.id, total: targets.length, chunked: true });
}
