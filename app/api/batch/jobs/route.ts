/**
 * GET /api/batch/jobs — recent Batch Functions runs for the org (history panel).
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireOrg, ok } from "@/lib/api";
import { reapIfStale } from "@/lib/batch/reap";

// See the matching note in [id]/route.ts — this list is also polled to show
// live progress, so it must never serve a cached snapshot.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const limit = Math.min(Number(new URL(req.url).searchParams.get("limit") || 25), 100);

  const rows = await db
    .select({
      id: batchJobs.id,
      orgId: batchJobs.orgId,
      operation: batchJobs.operation,
      entityLabel: batchJobs.entityLabel,
      fileName: batchJobs.fileName,
      status: batchJobs.status,
      totalRows: batchJobs.totalRows,
      processedCount: batchJobs.processedCount,
      successCount: batchJobs.successCount,
      errorCount: batchJobs.errorCount,
      results: batchJobs.results,
      undoneAt: batchJobs.undoneAt,
      leaseUntil: batchJobs.leaseUntil,
      createdAt: batchJobs.createdAt,
      finishedAt: batchJobs.finishedAt,
    })
    .from(batchJobs)
    .where(eq(batchJobs.orgId, orgId!))
    .orderBy(desc(batchJobs.createdAt))
    .limit(limit);

  // Resume-or-fail any stuck job on this page, so History reflects reality
  // (and a stuck chunked import gets nudged the moment someone looks at it)
  // instead of showing a perpetual spinner. lib/batch/reap.ts — shared with
  // the single-job endpoint so the two can't disagree on what "stale" means.
  for (const row of rows) {
    const patch = await reapIfStale(row as any).catch(() => null);
    if (patch) Object.assign(row, patch);
  }

  return ok({ jobs: rows.map(({ orgId: _o, processedCount: _p, results: _r, leaseUntil: _l, ...rest }) => rest) });
}
