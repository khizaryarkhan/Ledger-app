/**
 * GET /api/batch/jobs — recent Batch Functions runs for the org (history panel).
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { requireOrg, ok } from "@/lib/api";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const limit = Math.min(Number(new URL(req.url).searchParams.get("limit") || 25), 100);

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
      createdAt: batchJobs.createdAt,
      finishedAt: batchJobs.finishedAt,
    })
    .from(batchJobs)
    .where(eq(batchJobs.orgId, orgId!))
    .orderBy(desc(batchJobs.createdAt))
    .limit(limit);

  return ok({ jobs: rows });
}
