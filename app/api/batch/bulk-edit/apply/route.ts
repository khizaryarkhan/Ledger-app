/**
 * POST /api/batch/bulk-edit/apply
 * Body: { entity, ids: string[], setClassId?, setLocationId? }
 *
 * Creates a batch job and runs it INLINE (same reliability pattern as the
 * commit route — no dependence on background-worker delivery). The field-edit
 * runner does minimal sparse updates that never clobber links.
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { getEntity } from "@/lib/batch/entities";
import { getOrgQboToken } from "@/lib/qbo-token";
import { runFieldEditJob } from "@/lib/batch/field-edit-runner";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id as string;

  const body = await req.json().catch(() => null);
  if (!body) return bad("Invalid JSON body");

  const entity = getEntity(String(body.entity || ""));
  if (!entity?.qboEntity) return bad("Unknown entity", 404);
  if (!entity.supports?.modify) return bad("This entity can't be bulk-edited", 400);

  const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
  if (ids.length === 0) return bad("Select at least one record");

  const setClassId: string | null = body.setClassId ? String(body.setClassId) : null;
  const setLocationId: string | null = body.setLocationId ? String(body.setLocationId) : null;
  if (!setClassId && !setLocationId) return bad("Pick a Class and/or Location to set");

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected for this organisation", 400);

  const changed = [setClassId ? "Class" : null, setLocationId ? "Location" : null].filter(Boolean).join(" + ");

  const [job] = await db.insert(batchJobs).values({
    orgId: orgId!,
    userId,
    operation: "modify",
    entityId: entity.id,
    entityLabel: `Bulk edit (${changed}) — ${entity.label}`,
    status: "queued",
    totalRows: ids.length,
    input: { fieldEdit: { ids, setClassId, setLocationId } },
  }).returning({ id: batchJobs.id });

  await runFieldEditJob(job.id).catch((e) => console.error("[bulk-edit inline]", e));

  return ok({ jobId: job.id, total: ids.length, background: false });
}
