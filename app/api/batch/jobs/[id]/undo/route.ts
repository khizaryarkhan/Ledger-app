/**
 * POST /api/batch/jobs/[id]/undo — reverse an import.
 *
 * Queues a background undo job that deletes the records the original import
 * created. Only import ("upload") jobs that created records and haven't already
 * been undone can be reversed.
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";
import { inngest } from "@/lib/inngest";
import { runBatchUndoJob } from "@/lib/batch/undo-runner";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id as string;

  const [orig] = await db.select().from(batchJobs)
    .where(and(eq(batchJobs.id, params.id), eq(batchJobs.orgId, orgId!)))
    .limit(1);
  if (!orig) return bad("Job not found", 404);
  if (orig.operation !== "upload") return bad("Only imports can be undone");
  if (orig.undoneAt) return bad("This import has already been undone");
  if (orig.status !== "done") return bad("Wait for the import to finish first");

  const created = ((orig.results as any[]) || []).filter((r) => r.ok && r.qboId);
  if (created.length === 0) return bad("This import didn't create anything to undo");

  const [undoJob] = await db.insert(batchJobs).values({
    orgId: orgId!,
    userId,
    operation: "undo",
    entityId: orig.entityId,
    entityLabel: `Undo — ${orig.entityLabel}`,
    status: "queued",
    totalRows: created.length,
    input: { originalJobId: orig.id },
  }).returning({ id: batchJobs.id });

  // Run inline for interactive-sized undos — completion must not depend on the
  // Inngest background worker being delivered (it isn't consumed in every
  // environment, which left undo jobs stuck at "queued" and nothing deleted,
  // exactly like the commit path). The runner claims the job atomically, so
  // this is safe alongside the queued event. Larger undos go to the queue.
  const INLINE_MAX = 100;
  if (created.length <= INLINE_MAX) {
    await runBatchUndoJob(undoJob.id).catch((e) => console.error("[batch inline undo]", e));
    return ok({ jobId: undoJob.id, total: created.length, background: false });
  }

  await inngest.send({ name: "batch/undo", data: { jobId: undoJob.id } });
  return ok({ jobId: undoJob.id, total: created.length, background: true });
}
