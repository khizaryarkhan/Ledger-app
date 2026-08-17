/**
 * POST /api/batch/jobs/[id]/run — run a queued commit job inline.
 *
 * A fallback the client fires right after creating a job, so a batch never
 * depends on the Inngest background worker actually being delivered (event
 * delivery isn't reliable in every environment — jobs were getting stuck at
 * "queued" forever). runBatchCommitJob does an atomic queued→running claim, so
 * if the Inngest worker also picks it up, only one of them processes it.
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";
import { runBatchCommitJob } from "@/lib/batch/commit-runner";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  // Scope the job to the caller's org before touching it.
  const [job] = await db
    .select({ id: batchJobs.id, status: batchJobs.status })
    .from(batchJobs)
    .where(and(eq(batchJobs.id, params.id), eq(batchJobs.orgId, orgId!)))
    .limit(1);
  if (!job) return bad("Job not found", 404);

  // Only queued jobs need a kick; anything else is already claimed or finished.
  if (job.status !== "queued") return ok({ ran: false, status: job.status });

  await runBatchCommitJob(params.id).catch((e) => console.error("[batch inline run]", e));
  return ok({ ran: true });
}
