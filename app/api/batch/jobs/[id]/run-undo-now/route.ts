/**
 * Temporary diagnostic — DELETE once the Data Studio Inngest-delivery
 * investigation is closed out (see CLAUDE.md, 2026-09-03).
 *
 * POST /api/batch/jobs/[id]/run-undo-now
 *
 * Runs a legacy (non-chunked) undo job inline, bypassing the `batch/undo`
 * Inngest event entirely. Observed live: two consecutive undo attempts for
 * a >100-record job (which always queues via Inngest, never inline) sat at
 * successCount:0 and were reaped as "timed out" after ~1 minute each,
 * meaning the batch/undo event was never actually delivered/processed —
 * the same event-delivery unreliability already seen on the chunk-run path.
 * runBatchUndoJob claims its job atomically, so this is safe to call even
 * if a delayed Inngest delivery also fires later.
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";
import { runBatchUndoJob } from "@/lib/batch/undo-runner";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [job] = await db.select({ id: batchJobs.id, status: batchJobs.status })
    .from(batchJobs).where(and(eq(batchJobs.id, params.id), eq(batchJobs.orgId, orgId!))).limit(1);
  if (!job) return bad("Job not found", 404);
  if (job.status === "done" || job.status === "failed") return ok({ ran: false, status: job.status });

  await runBatchUndoJob(params.id);
  const [after] = await db.select().from(batchJobs).where(eq(batchJobs.id, params.id)).limit(1);
  return ok({ ran: true, status: after?.status, successCount: after?.successCount, errorCount: after?.errorCount });
}
