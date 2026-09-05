/**
 * Temporary diagnostic — DELETE once the Data Studio full-entity load-test
 * pass (2026-09-05) is closed out.
 *
 * POST /api/batch/jobs/[id]/run-chunk-now
 *
 * Calls the right chunk processor directly and returns its ChunkOutcome
 * inline, bypassing the async Inngest event queue entirely — so a real
 * chunk error (or a genuine claim-busy) is visible in the HTTP response
 * immediately, instead of inferred from polling and waiting on
 * event-processing timing. Safe alongside the normal Inngest chain:
 * claimChunk is atomic, so this either gets the lease and does real work,
 * or cleanly reports busy.
 *
 * Dispatches by the job's own `operation` — originally upload-only, widened
 * to cover delete and bulk-edit too: at load-test volume (500+ rows), a
 * chunked delete or field-edit job hitting the same Inngest self-chaining
 * unreliability already flagged for imports (CLAUDE.md) would otherwise
 * need to sit and wait on the 2-minute watchdog for every single chunk.
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";
import { processUploadChunk } from "@/lib/batch/chunk-runner";
import { processDeleteChunk } from "@/lib/batch/delete-chunk-runner";
import { processFieldEditChunk } from "@/lib/batch/fieldedit-chunk-runner";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  if (!params.id) return bad("id required");

  const [job] = await db.select({ operation: batchJobs.operation, input: batchJobs.input })
    .from(batchJobs).where(and(eq(batchJobs.id, params.id), eq(batchJobs.orgId, orgId!))).limit(1);
  if (!job) return bad("Job not found", 404);

  // Same dispatch rule as inngest/functions/batch.ts's runBatchChunkLoop —
  // a field-edit job is a "modify" with input.fieldEdit set, not its own
  // operation string.
  const outcome = job.operation === "delete"
    ? await processDeleteChunk(orgId!, params.id)
    : job.operation === "modify" && (job.input as any)?.fieldEdit
      ? await processFieldEditChunk(orgId!, params.id)
      : await processUploadChunk(orgId!, params.id);
  return ok(outcome);
}
