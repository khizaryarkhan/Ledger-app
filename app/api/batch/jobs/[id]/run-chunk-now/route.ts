/**
 * PERMANENT — this is now the client's real-time recovery mechanism for a
 * stalled chunked job, not just a diagnostic. Originally added as one (see
 * git history for the 2026-09-03 stuck-import investigation this repo's
 * CLAUDE.md documents), it started being called for real by
 * app/(app)/batch/_components/poll-job.ts's shared polling loop once it
 * became clear the server-side recovery paths share a common weak point:
 * Inngest event delivery. runBatchChunkLoop's self-chaining is
 * event-triggered, and the batchJobWatchdog cron that's supposed to catch a
 * dropped event is ALSO event/cron-triggered through the same Inngest
 * pipeline — so a delivery blip can silently defeat both safety nets at
 * once. Confirmed live 2026-09-05 (Foodready.ai QBO Sandbox, full-entity
 * load test): several chunked jobs sat at a fixed processedCount for
 * minutes — well past a single dropped event, and past the watchdog's own
 * 2-minute cadence — until manually POSTed here. A client-side nudge has
 * nothing Inngest-shaped in its path (a plain fetch from the browser to
 * this Next.js route), so it recovers a stalled job in seconds whenever the
 * user's tab is open, independent of whichever part of the Inngest chain
 * stopped delivering.
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
 *
 * GUARD (added 2026-09-05, load-test incident): only ever call this on a job
 * that was actually created chunk-resumable — /api/batch/upload/start,
 * /api/batch/delete/commit and /api/batch/bulk-edit/apply all set
 * `leaseUntil` (already-expired) at creation specifically as that marker
 * (see lib/batch/reap.ts's header comment for the same convention).
 * /api/batch/upload/commit's >100-row path does NOT — it dispatches the
 * LEGACY whole-job runner (lib/batch/commit-runner.ts) via a plain Inngest
 * event with no lease/cursor at all. Calling processUploadChunk against
 * one of those (as this route did, unconditionally, before this guard)
 * lets claimChunk succeed anyway (its condition is just "leaseUntil is
 * null or expired" — true for a legacy job that never set it), so THIS
 * chunked engine starts independently re-processing the exact same rows
 * the legacy runner is already working through with zero awareness of
 * each other. Confirmed live: a 500-row Purchase Order create was
 * simultaneously submitted by both processors, and every row QBO's own
 * duplicate-document-number check didn't catch would have been created
 * twice. A job whose leaseUntil is null while still running/queued is
 * exactly the legacy-runner signature — refuse it outright rather than
 * risk a second, concurrent QBO-writing process.
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

  const [job] = await db.select({ operation: batchJobs.operation, input: batchJobs.input, status: batchJobs.status, leaseUntil: batchJobs.leaseUntil })
    .from(batchJobs).where(and(eq(batchJobs.id, params.id), eq(batchJobs.orgId, orgId!))).limit(1);
  if (!job) return bad("Job not found", 404);

  if (job.status !== "done" && job.status !== "failed" && job.leaseUntil === null) {
    return bad(
      "This job was never chunk-resumable (leaseUntil was never set at creation) — it's running through the legacy whole-job runner via Inngest instead. Forcing the chunked engine onto it here would start a second, concurrent process writing the same rows to QuickBooks. Wait for its own Inngest-driven run to finish, or re-check /api/batch/jobs/[id] for status.",
      409,
    );
  }

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
