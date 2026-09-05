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
import { preloadPaymentApplicationIds } from "./builders";
import { commitOneDoc, commitDocsBatch, docKeyOf } from "./commit-one";
import { claimChunk, finishChunkCall, releaseLeaseOnError, runChunkLoop, runBatchedChunkLoop, type ChunkOutcome } from "./lease";

// Creates go through QBO's Batch API (up to 30/request, run several batches
// concurrently — see qboBatch/QBO_BATCH_CONCURRENCY's own comments and
// CLAUDE.md's Data Studio section) instead of one qboPost per row. Only a
// plain create — never `modify`, which needs a fresh per-record SyncToken
// read first, so it stays on the per-record path (runChunkLoop).
//
// Originally scoped to just "invoice"; widened 2026-09-05 during a full
// entity load-test pass (500+ rows/entity) once every other FULL/NO_DELETE
// entity's build() was confirmed to have no same-batch-create dependency
// (a builder that needs a record THIS SAME upload just created, before this
// one, to reference — none of these do: receivepayment/billpayment resolve
// against pre-EXISTING invoices/bills via the already-preloaded
// preloadPaymentApplicationIds cache, not anything freshly created in this
// batch).
const BATCHABLE_CREATE_ENTITIES = new Set([
  "invoice", "estimate", "creditmemo", "salesreceipt", "refundreceipt", "receivepayment",
  "bill", "expense", "check", "purchaseorder", "vendorcredit", "billpayment", "creditcardcredit",
  "journalentry", "deposit", "transfer", "timeactivity",
  "customer", "vendor", "item", "account", "class", "department", "employee",
]);

export async function processUploadChunk(orgId: string, jobId: string): Promise<ChunkOutcome> {
  // Everything below — including the two DB round-trips before the loop even
  // starts — used to sit outside this function's try/catch entirely. A
  // transient DB blip there (this org has one logged: "Error connecting to
  // database: fetch failed") threw straight out of processUploadChunk, past
  // dispatchChunk, into runBatchChunkLoop's step.run — where it looked like
  // an ordinary step failure to Inngest, retried a couple of times per this
  // function's `retries`, and on exhaustion just ended the run. No
  // ChunkOutcome was ever produced, so none of runBatchChunkLoop's own
  // branches (continue / busy-retry / error-retry) ever ran, and neither did
  // the last_chunk_error write — the job sat at its cursor with zero record
  // of why, every single time, indistinguishable from a genuinely
  // unrecoverable failure. Confirmed live 2026-09-03 (Aberny Charity, two
  // separate jobs both stuck exactly at the same cursor with no error
  // recorded). Wrapping the whole function closes that gap; `claimed` tracks
  // whether releaseLeaseOnError is actually ours to call, so a throw before
  // claiming never releases a lease this invocation never held.
  let cursor = 0;
  let claimed = false;
  let totalRowsForError = 0;
  try {
    const [job] = await db.select().from(batchJobs)
      .where(and(eq(batchJobs.id, jobId), eq(batchJobs.orgId, orgId))).limit(1);
    if (!job) return { accepted: false, processedCount: 0, totalRows: 0, done: false, error: "Job not found" };
    if (job.status === "done") return { accepted: false, processedCount: job.processedCount ?? 0, totalRows: job.totalRows, done: true, status: "done" };
    if (job.undoneAt) return { accepted: false, processedCount: job.processedCount ?? 0, totalRows: job.totalRows, done: false, status: "undone", error: "This import was undone" };

    cursor = job.processedCount ?? 0;
    totalRowsForError = job.totalRows;
    const claim = await claimChunk(jobId, cursor);
    if (!claim.claimed) {
      return { accepted: false, processedCount: claim.processedCount, totalRows: claim.totalRows, done: claim.status === "done", status: claim.status ?? undefined, busy: claim.busy };
    }
    claimed = true;

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
    await preloadPaymentApplicationIds(entity.id, docs, resolver);

    const useBatch = operation === "upload" && BATCHABLE_CREATE_ENTITIES.has(entity.id);
    const { processedTo } = useBatch
      ? await runBatchedChunkLoop(jobId, cursor, total, async (indices) => {
          const group = indices.map((i) => docs[i]);
          const results = await commitDocsBatch(token, entity, group, resolver);
          return results.map((r, k) => {
            const i = indices[k];
            const doc = group[k];
            return r.ok
              ? { ok: true, row: i + 1, qboId: r.qboId, docNumber: r.docNumber }
              : { ok: false, row: i + 1, error: (r as any).error, key: docKeyOf(entity, doc), data: doc.rows };
          });
        })
      : await runChunkLoop(jobId, cursor, total, async (i) => {
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
    if (claimed) await releaseLeaseOnError(jobId);
    return { accepted: false, processedCount: cursor, totalRows: totalRowsForError, done: false, error: e?.message || "Chunk failed" };
  }
}
