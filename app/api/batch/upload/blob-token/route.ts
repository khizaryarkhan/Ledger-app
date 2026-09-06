/**
 * POST /api/batch/upload/blob-token
 *
 * Issues a short-lived client token so the browser can upload a large,
 * browser-parsed import file DIRECTLY to Vercel Blob storage — never through
 * one of our own serverless functions.
 *
 * Why this exists: Vercel Functions have a hard 4.5 MB request/response body
 * limit that cannot be raised by any app-level config (it's enforced at the
 * platform routing layer, before our code ever runs). handleFile() in
 * batch/upload/page.tsx already parses the workbook in-browser to avoid
 * multipart overhead, but the resulting rows-as-JSON payload is STILL a
 * request body subject to the same 4.5 MB ceiling — so a big enough import
 * (tens of thousands of rows) would 413 before reaching QBO at all,
 * regardless of every throughput fix on the processing side. Confirmed this
 * gap 2026-09-06 while chasing a "SaasAnt supports 10 MB files" comparison —
 * a 10 MB source file's parsed JSON almost certainly exceeds 4.5 MB.
 */
import { requireOrg } from "@/lib/api";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export async function POST(request: Request): Promise<NextResponse> {
  const { error } = await requireOrg();
  if (error) return error;

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["application/json"],
        addRandomSuffix: true,
        // Real ceiling is QBO's own throughput, not this — generous on purpose.
        maximumSizeInBytes: 100 * 1024 * 1024,
      }),
      onUploadCompleted: async () => {
        // Nothing to do server-side here — the batch job row doesn't exist
        // yet at upload time; /api/batch/upload/preview and /start fetch the
        // blob's contents themselves once the client hands them the URL.
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
