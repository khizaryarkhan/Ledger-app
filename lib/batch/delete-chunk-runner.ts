/**
 * Chunked, resumable delete runner (QuickBooks).
 *
 * The old /api/batch/delete/commit ran its whole loop synchronously inside
 * the HTTP handler, with a single db.update at the very end and NOTHING
 * written in between. Deletes are irreversible in QuickBooks, so that design
 * meant: past a few hundred records, or any hiccup in that unbroken chain of
 * HTTP calls, the function could be killed by the platform's timeout with an
 * unknown number of records already deleted and ZERO record of which ones —
 * the batch_jobs row stayed "running" forever, silent about what had actually
 * happened in the org's live QuickBooks data.
 *
 * Same lease/cursor engine as the import runner (lib/batch/lease.ts): each
 * call deletes a bounded slice, and every single deletion is durably recorded
 * — id + outcome — before moving to the next, so a crash mid-run loses at
 * most the one in-flight record from the log, never the truth of what's
 * already gone.
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getEntity } from "./entities";
import { getOrgQboToken } from "@/lib/qbo-token";
import { qboDelete } from "./qbo-client";
import { claimChunk, finishChunkCall, releaseLeaseOnError, runChunkLoop, type ChunkOutcome } from "./lease";

export async function processDeleteChunk(orgId: string, jobId: string): Promise<ChunkOutcome> {
  const [job] = await db.select().from(batchJobs)
    .where(and(eq(batchJobs.id, jobId), eq(batchJobs.orgId, orgId))).limit(1);
  if (!job) return { accepted: false, processedCount: 0, totalRows: 0, done: false, error: "Job not found" };
  if (job.status === "done") return { accepted: false, processedCount: job.processedCount ?? 0, totalRows: job.totalRows, done: true, status: "done" };

  const cursor = job.processedCount ?? 0;
  const claim = await claimChunk(jobId, cursor);
  if (!claim.claimed) {
    return { accepted: false, processedCount: claim.processedCount, totalRows: claim.totalRows, done: claim.status === "done", status: claim.status ?? undefined, busy: claim.busy };
  }

  try {
    const input = (job.input || {}) as any;
    const targets: { id: string; syncToken: string }[] = Array.isArray(input.targets) ? input.targets : [];
    if (targets.length === 0) {
      throw new Error("This delete's staged records were cleared (it was left idle too long). Re-select the remaining records to continue.");
    }

    const entity = getEntity(job.entityId);
    if (!entity?.qboEntity) throw new Error("Unknown entity");
    const token = await getOrgQboToken(job.orgId).catch(() => null);
    if (!token) throw new Error("QuickBooks is not connected for this organisation");

    const total = targets.length;
    if (total !== job.totalRows) await db.update(batchJobs).set({ totalRows: total }).where(eq(batchJobs.id, jobId));

    if (cursor >= total) {
      await finishChunkCall(jobId, true);
      return { accepted: true, processedCount: cursor, totalRows: total, done: true, status: "done" };
    }

    const { processedTo } = await runChunkLoop(jobId, cursor, total, async (i) => {
      const t = targets[i];
      const res = await qboDelete(token, entity.qboEntity!, t.id, String(t.syncToken ?? "0"));
      return res.ok ? { ok: true, id: t.id } : { ok: false, id: t.id, error: res.error };
    });

    const done = processedTo >= total;
    await finishChunkCall(jobId, done);

    const [fin] = await db.select({ sc: batchJobs.successCount, ec: batchJobs.errorCount })
      .from(batchJobs).where(eq(batchJobs.id, jobId)).limit(1);
    return { accepted: true, processedCount: processedTo, totalRows: total, done, status: done ? "done" : "running", successCount: fin?.sc ?? 0, errorCount: fin?.ec ?? 0 };
  } catch (e: any) {
    await releaseLeaseOnError(jobId);
    return { accepted: false, processedCount: cursor, totalRows: job.totalRows, done: false, error: e?.message || "Chunk failed" };
  }
}
