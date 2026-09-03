/**
 * Stale-job detection, shared by GET /api/batch/jobs (list) and GET
 * /api/batch/jobs/[id] (detail) — previously two near-identical copies that
 * only ever FAILED a stuck job, never tried to continue it.
 *
 * Two different kinds of "stuck" now get two different treatments:
 *
 *  - CHUNKED jobs (upload, delete, bulk-edit — anything the lease/cursor
 *    engine in lib/batch/lease.ts drives) are RESUMABLE by design: every
 *    single item is durably recorded before the next one starts, so a
 *    dropped Inngest event doesn't lose anything, it just stops progress.
 *    A stale lease on one of these means "nudge it", not "it's dead" — the
 *    batchJobWatchdog cron (inngest/functions/batch.ts) already does this
 *    every 2 minutes on its own, but the read path here does it too, so
 *    opening Job History resumes a stuck import immediately rather than
 *    waiting for the next cron tick.
 *
 *  - LEGACY whole-job runners (Xero commit, scheduled QBO imports — anything
 *    using the older runBatchCommitJob/runXeroCommitJob shape) never touch
 *    leaseUntil at all, so a stuck one truly has no resume mechanism — the
 *    process that was running it is just gone. These still fail after the
 *    original 5-minute age cutoff, unchanged from before.
 *
 * Distinguishing the two is exactly what leaseUntil is for: the chunked start
 * routes set it (already-expired) at job creation specifically so this column
 * marks "this job is chunk-resumable" independent of whether processing has
 * begun yet.
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { inngest } from "@/lib/inngest";

type JobRow = {
  id: string; orgId: string; status: string; leaseUntil: Date | null;
  createdAt: Date; finishedAt: Date | null;
  totalRows: number; processedCount: number | null;
  successCount: number; errorCount: number; results: unknown;
};

const LEASE_STALE_MS = 2 * 60 * 1000;
const LEGACY_FAIL_AGE_MS = 5 * 60 * 1000;
// A chunked job only gets marked failed outright once it's been stuck (lease
// stale AND no progress since) for this long — several watchdog cycles' worth
// of failed nudges, not one. Below this, resume-and-wait is always preferred.
const CHUNKED_FAIL_AGE_MS = 20 * 60 * 1000;

/**
 * Inspects one job row and, if it's stuck, either nudges it (chunked) or
 * fails it (legacy / truly abandoned chunked). Returns the row unchanged if
 * there was nothing to do, or the updated fields if it acted.
 */
export async function reapIfStale(job: JobRow): Promise<Partial<JobRow> | null> {
  if (job.status !== "queued" && job.status !== "running") return null;
  if (job.finishedAt) return null;

  const now = Date.now();
  const leaseAge = job.leaseUntil ? now - new Date(job.leaseUntil).getTime() : Infinity;
  const leaseStale = leaseAge > LEASE_STALE_MS;
  if (!leaseStale) return null;

  const isChunked = job.leaseUntil !== null; // see file header — the structural marker
  const age = now - new Date(job.createdAt).getTime();

  if (isChunked && age < CHUNKED_FAIL_AGE_MS) {
    // Resumable and not yet given up on — nudge it and leave status/results
    // alone. Best-effort: if Inngest itself is unreachable, the next person
    // to open this page (or the next watchdog tick) tries again.
    await inngest.send({ name: "batch/chunk-run", data: { jobId: job.id, orgId: job.orgId } }).catch(() => {});
    return null;
  }

  // BUG FIXED 2026-09-03: this used to read `if (isChunked && age <
  // LEGACY_FAIL_AGE_MS)`. Since a legacy job's leaseUntil is always null,
  // isChunked is always false for it — so that condition could never be
  // true for the exact case it was meant to protect. A legacy job's
  // leaseAge is `Infinity` from the moment it's created (leaseUntil is
  // never set), making leaseStale true immediately, and with isChunked
  // false, BOTH grace-period branches were skipped — every legacy job
  // (Undo, Xero commit, scheduled imports) fell straight through to
  // "genuinely give up" on the very first poll, no matter how briefly it
  // had been running or how much real progress it had made. Confirmed live:
  // a 120-row Undo job with successCount climbing normally was marked
  // "failed" ~1.5 minutes in, immediately after being polled once.
  // For a chunked job that already fell through the first branch (past
  // CHUNKED_FAIL_AGE_MS, 20 min), that's already well past 5 minutes too —
  // no separate grace period needed, it should proceed to give up. The
  // 5-minute grace belongs to legacy jobs specifically.
  if (!isChunked && age < LEGACY_FAIL_AGE_MS) {
    return null;
  }

  // Genuinely give up: legacy job past its age cutoff, or a chunked job that's
  // been nudged for CHUNKED_FAIL_AGE_MS with no one ever completing it.
  const remaining = Math.max(0, job.totalRows - (job.processedCount ?? job.successCount + job.errorCount));
  const reason = isChunked
    ? `The import stopped part-way and could not be resumed automatically. ${job.processedCount ?? 0} of ${job.totalRows} record(s) were attempted (${job.successCount} succeeded, ${job.errorCount} failed) — the remaining ${remaining} were never attempted. Records already created are kept and can be reversed with Undo; re-run the import for the untouched records.`
    : "The import stopped part-way (timed out). The records created before it stopped are kept and can be reversed with Undo; re-import only the remaining rows.";

  const existing = Array.isArray(job.results) ? (job.results as any[]) : [];
  const newResults = [...existing, { row: 0, ok: false, error: reason }];
  const newErrorCount = Math.max(job.errorCount ?? 0, 1);

  await db.update(batchJobs)
    .set({ status: "failed", results: newResults, errorCount: newErrorCount, input: null, finishedAt: new Date() })
    .where(eq(batchJobs.id, job.id));

  return { status: "failed", results: newResults as unknown, errorCount: newErrorCount, finishedAt: new Date() };
}
