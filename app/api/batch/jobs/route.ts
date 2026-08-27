/**
 * GET /api/batch/jobs — recent Batch Functions runs for the org (history panel).
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { and, eq, desc, lt, isNull, inArray, sql } from "drizzle-orm";
import { requireOrg, ok } from "@/lib/api";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const limit = Math.min(Number(new URL(req.url).searchParams.get("limit") || 25), 100);

  // Reap orphaned jobs (queued/running but never finished, older than any real
  // runtime) so History reflects reality instead of showing a perpetual spinner.
  const staleCutoff = new Date(Date.now() - 5 * 60 * 1000);
  await db.update(batchJobs)
    // APPEND the timeout note to whatever per-row results exist (COALESCE for
    // NULL, || concatenates jsonb arrays) — never overwrite, so the qboIds of
    // records already created survive and the import stays undoable.
    .set({ status: "failed", results: sql`COALESCE(${batchJobs.results}, '[]'::jsonb) || ${JSON.stringify([{ row: 0, ok: false, error: "The import stopped part-way (timed out). Records created before it stopped are kept and can be reversed with Undo; re-import only the remaining rows." }])}::jsonb`, errorCount: sql`GREATEST(${batchJobs.errorCount}, 1)`, input: null, finishedAt: new Date() })
    .where(and(
      eq(batchJobs.orgId, orgId!),
      inArray(batchJobs.status, ["queued", "running"]),
      isNull(batchJobs.finishedAt),
      lt(batchJobs.createdAt, staleCutoff),
    ))
    .catch(() => {});

  const rows = await db
    .select({
      id: batchJobs.id,
      operation: batchJobs.operation,
      entityLabel: batchJobs.entityLabel,
      fileName: batchJobs.fileName,
      status: batchJobs.status,
      totalRows: batchJobs.totalRows,
      successCount: batchJobs.successCount,
      errorCount: batchJobs.errorCount,
      undoneAt: batchJobs.undoneAt,
      createdAt: batchJobs.createdAt,
      finishedAt: batchJobs.finishedAt,
    })
    .from(batchJobs)
    .where(eq(batchJobs.orgId, orgId!))
    .orderBy(desc(batchJobs.createdAt))
    .limit(limit);

  return ok({ jobs: rows });
}
