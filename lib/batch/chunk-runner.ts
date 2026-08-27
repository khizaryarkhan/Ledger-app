/**
 * Chunked, resumable import/update runner (QuickBooks upload + modify).
 *
 * The whole file is staged once on the job (input.rawRows). Each call processes
 * documents starting at the job's cursor (processed_count) until the shared
 * time/count budget is hit, then returns. Lease/cursor mechanics live in
 * lib/batch/lease.ts, shared with the delete and bulk-edit runners.
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getEntity } from "./entities";
import { normalizeRows, groupDocs, ensureIdentityMapping } from "./engine";
import { getOrgQboToken } from "@/lib/qbo-token";
import { RefResolver } from "./ref-resolver";
import { commitOneDoc, docKeyOf } from "./commit-one";
import { claimChunk, finishChunkCall, releaseLeaseOnError, runChunkLoop, type ChunkOutcome } from "./lease";

export async function processUploadChunk(orgId: string, jobId: string): Promise<ChunkOutcome> {
  const [job] = await db.select().from(batchJobs)
    .where(and(eq(batchJobs.id, jobId), eq(batchJobs.orgId, orgId))).limit(1);
  if (!job) return { accepted: false, processedCount: 0, totalRows: 0, done: false, error: "Job not found" };
  if (job.status === "done") return { accepted: false, processedCount: job.processedCount ?? 0, totalRows: job.totalRows, done: true, status: "done" };
  if (job.undoneAt) return { accepted: false, processedCount: job.processedCount ?? 0, totalRows: job.totalRows, done: false, status: "undone", error: "This import was undone" };

  const cursor = job.processedCount ?? 0;
  const claim = await claimChunk(jobId, cursor);
  if (!claim.claimed) {
    return { accepted: false, processedCount: claim.processedCount, totalRows: claim.totalRows, done: claim.status === "done", status: claim.status ?? undefined, busy: claim.busy };
  }

  try {
    const input = (job.input || {}) as any;
    const operation: "upload" | "modify" = job.operation === "modify" ? "modify" : "upload";
    const overrides: Record<string, Record<string, string>> = input.overrides || {};
    const rawRows: any[] = Array.isArray(input.rawRows) ? input.rawRows : [];
    // If the staged rows are gone (an abandoned job was reaped and its input
    // cleared) we can't continue — surface it rather than mis-marking the job
    // "done" with a bogus total. Records already created stay undoable.
    if (rawRows.length === 0) {
      throw new Error("This import's staged rows were cleared (it was left idle too long). Re-import the remaining rows to continue; anything already created can be reversed with Undo.");
    }

    const entity = getEntity(job.entityId);
    if (!entity || !entity.build) throw new Error("Unknown entity or no builder");
    const token = await getOrgQboToken(job.orgId).catch(() => null);
    if (!token) throw new Error("QuickBooks is not connected for this organisation");

    const mapping: Record<string, string> = operation === "modify" && rawRows[0]
      ? ensureIdentityMapping(input.mapping || {}, rawRows[0])
      : (input.mapping || {});
    const normalized = normalizeRows(rawRows, mapping);
    if (Object.keys(overrides).length) {
      for (const row of normalized) {
        for (const [col, map] of Object.entries(overrides)) {
          const c = row[col];
          if (c != null && map[String(c)] != null) row[col] = map[String(c)];
        }
      }
    }
    const docs = groupDocs(normalized, entity);
    const total = docs.length;
    if (total !== job.totalRows) await db.update(batchJobs).set({ totalRows: total }).where(eq(batchJobs.id, jobId));

    if (cursor >= total) {
      await finishChunkCall(jobId, true);
      return { accepted: true, processedCount: cursor, totalRows: total, done: true, status: "done" };
    }

    const resolver = new RefResolver(token);
    if (entity.refs?.length) await resolver.preload(entity.refs);

    const { processedTo } = await runChunkLoop(jobId, cursor, total, async (i) => {
      const doc = docs[i];
      const r = await commitOneDoc(token, entity, operation, doc, resolver);
      return r.ok
        ? { ok: true, row: i + 1, qboId: r.qboId, docNumber: r.docNumber }
        : { ok: false, row: i + 1, error: (r as any).error, key: docKeyOf(entity, doc), data: doc.rows };
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
