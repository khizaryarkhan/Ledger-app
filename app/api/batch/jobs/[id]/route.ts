/**
 * GET /api/batch/jobs/[id] — one batch job's status + progress + results.
 * Polled by the UI to render a live progress bar and the final report.
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";
import { reapIfStale } from "@/lib/batch/reap";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [job] = await db
    .select({
      id: batchJobs.id,
      orgId: batchJobs.orgId,
      operation: batchJobs.operation,
      entityLabel: batchJobs.entityLabel,
      status: batchJobs.status,
      totalRows: batchJobs.totalRows,
      processedCount: batchJobs.processedCount,
      successCount: batchJobs.successCount,
      errorCount: batchJobs.errorCount,
      results: batchJobs.results,
      undoneAt: batchJobs.undoneAt,
      leaseUntil: batchJobs.leaseUntil,
      lastChunkError: batchJobs.lastChunkError,
      createdAt: batchJobs.createdAt,
      finishedAt: batchJobs.finishedAt,
    })
    .from(batchJobs)
    .where(and(eq(batchJobs.id, params.id), eq(batchJobs.orgId, orgId!)))
    .limit(1);

  if (!job) return bad("Job not found", 404);

  // Same stale-job handling as the list endpoint (lib/batch/reap.ts): resume
  // a stuck chunked job, or fail a genuinely-abandoned one — never just leave
  // the UI polling a job that will never change again.
  const patch = await reapIfStale(job as any).catch(() => null);
  if (patch) Object.assign(job, patch);

  // processedCount only means something for chunked jobs; legacy runners
  // never set it, so fall back to success+error (what they DO maintain).
  const processed = job.processedCount ?? (job.successCount ?? 0) + (job.errorCount ?? 0);
  const done = job.status === "done" || job.status === "failed";
  return ok({
    id: job.id,
    operation: job.operation,
    entityLabel: job.entityLabel,
    status: job.status,
    totalRows: job.totalRows,
    successCount: job.successCount,
    errorCount: job.errorCount,
    undoneAt: job.undoneAt,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
    lastChunkError: job.lastChunkError,
    processed,
    // Only expose the full results array once finished (keeps the poll light).
    results: done ? job.results : undefined,
  });
}
