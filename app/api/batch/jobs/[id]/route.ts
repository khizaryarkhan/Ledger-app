/**
 * GET /api/batch/jobs/[id] — one batch job's status + progress + results.
 * Polled by the UI to render a live progress bar and the final report.
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [job] = await db
    .select({
      id: batchJobs.id,
      operation: batchJobs.operation,
      entityLabel: batchJobs.entityLabel,
      status: batchJobs.status,
      totalRows: batchJobs.totalRows,
      successCount: batchJobs.successCount,
      errorCount: batchJobs.errorCount,
      results: batchJobs.results,
      undoneAt: batchJobs.undoneAt,
      createdAt: batchJobs.createdAt,
      finishedAt: batchJobs.finishedAt,
    })
    .from(batchJobs)
    .where(and(eq(batchJobs.id, params.id), eq(batchJobs.orgId, orgId!)))
    .limit(1);

  if (!job) return bad("Job not found", 404);

  // Self-heal orphaned jobs. A queued/running row older than the worker could
  // ever legitimately take means its background function died without writing a
  // terminal status (e.g. the process was killed, or — pre-fix — an uncaught
  // throw). Reap it to "failed" so the UI stops polling forever instead of
  // showing a job that never completes.
  const STALE_MS = 15 * 60 * 1000;
  if ((job.status === "queued" || job.status === "running") && !job.finishedAt
      && job.createdAt && Date.now() - new Date(job.createdAt).getTime() > STALE_MS) {
    const reason = "The background job stopped without finishing (timed out). Re-run the update — it's safe to retry.";
    const timeoutResults = [{ row: 0, ok: false, error: reason }];
    await db.update(batchJobs)
      .set({ status: "failed", results: timeoutResults, errorCount: Math.max(job.errorCount ?? 0, 1), input: null, finishedAt: new Date() })
      .where(eq(batchJobs.id, params.id));
    job.status = "failed";
    job.finishedAt = new Date();
    job.results = timeoutResults;
    job.errorCount = Math.max(job.errorCount ?? 0, 1);
  }

  const processed = (job.successCount ?? 0) + (job.errorCount ?? 0);
  // Only expose the full results array once finished (keeps the poll light).
  const done = job.status === "done" || job.status === "failed";
  return ok({
    ...job,
    processed,
    results: done ? job.results : undefined,
  });
}
