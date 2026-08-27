/**
 * Chunked, resumable import runner (QuickBooks).
 *
 * The whole file is staged once on the job (input.rawRows). Each call processes
 * documents starting at the job's cursor (processed_count) until a short time
 * budget is hit, then returns — the client fires the next call, and so on until
 * the file is done. This makes import size irrelevant: no single request runs
 * long, so nothing times out, on any plan.
 *
 * Duplicate-safety (critical — these are real QuickBooks writes):
 *  - An atomic lease (processed_count + lease_until) means only ONE runner ever
 *    processes a given cursor at a time. Two overlapping calls: one wins, the
 *    other is told "busy" and re-syncs.
 *  - The cursor advances PER DOCUMENT, together with that doc's result, in one
 *    statement — so a mid-chunk crash or a client retry resumes exactly at the
 *    next unprocessed doc and never re-creates a record.
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { and, eq, sql, isNull, or, lt } from "drizzle-orm";
import { getEntity } from "./entities";
import { normalizeRows, groupDocs, ensureIdentityMapping } from "./engine";
import { getOrgQboToken } from "@/lib/qbo-token";
import { RefResolver } from "./ref-resolver";
import { commitOneDoc, docKeyOf } from "./commit-one";

const TIME_BUDGET_MS = 45_000;      // return before any 60s function cap
const MAX_DOCS_PER_CHUNK = 400;     // hard upper bound per call
const LEASE_MS = 120_000;

export type ChunkOutcome = {
  accepted: boolean;
  processedCount: number;
  totalRows: number;
  done: boolean;
  status?: string;
  busy?: boolean;
  error?: string;
  successCount?: number;
  errorCount?: number;
};

export async function processUploadChunk(orgId: string, jobId: string): Promise<ChunkOutcome> {
  const started = Date.now();

  const [job] = await db.select().from(batchJobs)
    .where(and(eq(batchJobs.id, jobId), eq(batchJobs.orgId, orgId))).limit(1);
  if (!job) return { accepted: false, processedCount: 0, totalRows: 0, done: false, error: "Job not found" };
  if (job.status === "done") return { accepted: false, processedCount: job.processedCount ?? 0, totalRows: job.totalRows, done: true, status: "done" };
  if (job.undoneAt) return { accepted: false, processedCount: job.processedCount ?? 0, totalRows: job.totalRows, done: false, status: "undone", error: "This import was undone" };

  const cursor = job.processedCount ?? 0;
  const now = new Date();

  // Atomic lease at this cursor. Only the call that flips it proceeds.
  const claim = await db.update(batchJobs)
    .set({ leaseUntil: new Date(Date.now() + LEASE_MS), status: "running" })
    .where(and(
      eq(batchJobs.id, jobId),
      eq(batchJobs.processedCount, cursor),
      or(isNull(batchJobs.leaseUntil), lt(batchJobs.leaseUntil, now)),
    ))
    .returning({ id: batchJobs.id });
  if (claim.length === 0) {
    const [cur] = await db.select({ pc: batchJobs.processedCount, lu: batchJobs.leaseUntil, st: batchJobs.status, tr: batchJobs.totalRows })
      .from(batchJobs).where(eq(batchJobs.id, jobId)).limit(1);
    return {
      accepted: false,
      processedCount: cur?.pc ?? cursor,
      totalRows: cur?.tr ?? job.totalRows,
      done: cur?.st === "done",
      status: cur?.st,
      busy: !!(cur?.lu && cur.lu > now),
    };
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
      await db.update(batchJobs).set({ status: "done", input: null, leaseUntil: null, finishedAt: new Date() }).where(eq(batchJobs.id, jobId));
      return { accepted: true, processedCount: cursor, totalRows: total, done: true, status: "done" };
    }

    const resolver = new RefResolver(token);
    if (entity.refs?.length) await resolver.preload(entity.refs);

    let i = cursor;
    let n = 0;
    while (i < total && n < MAX_DOCS_PER_CHUNK && (Date.now() - started) < TIME_BUDGET_MS) {
      const doc = docs[i];
      let resultRow: any;
      try {
        const r = await commitOneDoc(token, entity, operation, doc, resolver);
        if (r.ok) {
          resultRow = { row: i + 1, ok: true, qboId: r.qboId, docNumber: r.docNumber };
        } else {
          resultRow = { row: i + 1, ok: false, error: (r as any).error, key: docKeyOf(entity, doc), data: doc.rows };
        }
      } catch (e: any) {
        resultRow = { row: i + 1, ok: false, error: e?.message || "Build failed", key: docKeyOf(entity, doc), data: doc.rows };
      }
      // One atomic statement advances the cursor, appends the result (with its
      // qboId) and the counts, and extends the lease — so this doc is durably
      // "done" the instant it commits.
      await db.update(batchJobs).set({
        processedCount: i + 1,
        results: sql`COALESCE(${batchJobs.results}, '[]'::jsonb) || ${JSON.stringify([resultRow])}::jsonb`,
        successCount: sql`${batchJobs.successCount} + ${resultRow.ok ? 1 : 0}`,
        errorCount: sql`${batchJobs.errorCount} + ${resultRow.ok ? 0 : 1}`,
        leaseUntil: new Date(Date.now() + LEASE_MS),
      }).where(eq(batchJobs.id, jobId));
      i++; n++;
    }

    const done = i >= total;
    // On finish: clear the lease + input. Between chunks: set the lease to NOW —
    // "expired" so the next chunk can immediately claim it, yet recent enough
    // that the stale-job reaper (which uses a 2-minute lease grace) leaves an
    // actively-progressing import alone instead of killing it mid-run.
    await db.update(batchJobs)
      .set(done
        ? { status: "done", leaseUntil: null, input: null, finishedAt: new Date() }
        : { status: "running", leaseUntil: new Date() })
      .where(eq(batchJobs.id, jobId));

    const [fin] = await db.select({ sc: batchJobs.successCount, ec: batchJobs.errorCount })
      .from(batchJobs).where(eq(batchJobs.id, jobId)).limit(1);
    return { accepted: true, processedCount: i, totalRows: total, done, status: done ? "done" : "running", successCount: fin?.sc ?? 0, errorCount: fin?.ec ?? 0 };
  } catch (e: any) {
    // Release the lease (set to NOW, not null → reaper's 2-min grace still
    // protects it) so the client can retry; the cursor already reflects exactly
    // what committed, so a retry resumes cleanly.
    await db.update(batchJobs).set({ leaseUntil: new Date() }).where(eq(batchJobs.id, jobId)).catch(() => {});
    return { accepted: false, processedCount: cursor, totalRows: job.totalRows, done: false, error: e?.message || "Chunk failed" };
  }
}
