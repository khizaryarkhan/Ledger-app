/**
 * POST /api/batch/delete/commit
 * JSON body: { entity, targets: [{ id, syncToken }] }
 *
 * Hard-deletes the selected QBO transactions, logging the run to batch_jobs.
 * This is irreversible in QuickBooks — the UI confirms before calling this.
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";
import { getEntity } from "@/lib/batch/entities";
import { getOrgQboToken } from "@/lib/qbo-token";
import { qboDelete } from "@/lib/batch/qbo-client";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id as string;

  const body = await req.json().catch(() => null);
  if (!body) return bad("Invalid JSON body");

  const entity = getEntity(String(body.entity || ""));
  if (!entity) return bad("Unknown entity", 404);
  if (!entity.supports.delete || !entity.qboEntity) {
    return bad(entity.note || "This entity does not support delete");
  }

  const targets: { id: string; syncToken: string }[] = Array.isArray(body.targets) ? body.targets : [];
  if (targets.length === 0) return bad("No records selected");

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected for this organisation", 400);

  const [job] = await db.insert(batchJobs).values({
    orgId: orgId!,
    userId,
    operation: "delete",
    entityId: entity.id,
    entityLabel: entity.label,
    status: "running",
    totalRows: targets.length,
  }).returning({ id: batchJobs.id });

  const results: { id: string; ok: boolean; error?: string }[] = [];
  let successCount = 0;

  for (const t of targets) {
    const res = await qboDelete(token, entity.qboEntity, t.id, String(t.syncToken ?? "0"));
    if (res.ok) { successCount++; results.push({ id: t.id, ok: true }); }
    else results.push({ id: t.id, ok: false, error: res.error });
  }

  await db.update(batchJobs).set({
    status: "done",
    successCount,
    errorCount: targets.length - successCount,
    results,
    finishedAt: new Date(),
  }).where(eq(batchJobs.id, job.id));

  return ok({ jobId: job.id, total: targets.length, successCount, errorCount: targets.length - successCount, results });
}
