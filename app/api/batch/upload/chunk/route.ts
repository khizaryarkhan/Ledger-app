/**
 * POST /api/batch/upload/chunk  Body: { jobId }
 *
 * Processes the next slice of a chunked import (see lib/batch/chunk-runner).
 * Returns the advanced cursor so the client can drive the next call:
 *   { accepted, processedCount, totalRows, done, status, busy? }
 * The client loops until done === true.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { processUploadChunk } from "@/lib/batch/chunk-runner";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const jobId = body?.jobId ? String(body.jobId) : "";
  if (!jobId) return bad("jobId required");

  const outcome = await processUploadChunk(orgId!, jobId);
  return ok(outcome);
}
