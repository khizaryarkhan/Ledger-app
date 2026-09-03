/**
 * Temporary diagnostic — DELETE once the Aberny Charity stuck-import
 * investigation is closed out.
 *
 * POST /api/batch/jobs/[id]/run-chunk-now
 *
 * Calls processUploadChunk directly and returns its ChunkOutcome inline,
 * bypassing the async Inngest event queue entirely — so a real chunk error
 * (or a genuine claim-busy) is visible in the HTTP response immediately,
 * instead of inferred from polling and waiting on event-processing timing.
 * Safe alongside the normal Inngest chain: claimChunk is atomic, so this
 * either gets the lease and does real work, or cleanly reports busy.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { processUploadChunk } from "@/lib/batch/chunk-runner";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  if (!params.id) return bad("id required");

  const outcome = await processUploadChunk(orgId!, params.id);
  return ok(outcome);
}
