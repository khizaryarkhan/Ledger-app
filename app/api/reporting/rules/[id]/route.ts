/** Update / delete a classification rule. */
import { db } from "@/db";
import { reportingRules } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  const patch: any = { updatedAt: new Date(), updatedBy: (session!.user as any).id };
  for (const k of ["name", "description"] as const) if (body[k] !== undefined) patch[k] = body[k];
  if (body.priority != null) patch.priority = Number(body.priority) || 100;
  if (body.conditions !== undefined) patch.conditions = body.conditions;
  if (body.active != null) patch.active = !!body.active;
  if (body.targetValueId !== undefined) patch.targetValueId = body.targetValueId;
  if (body.effectiveFrom !== undefined) patch.effectiveFrom = body.effectiveFrom || null;
  if (body.effectiveTo !== undefined) patch.effectiveTo = body.effectiveTo || null;

  const [row] = await db.update(reportingRules).set(patch)
    .where(and(eq(reportingRules.id, params.id), eq(reportingRules.orgId, orgId!)))
    .returning();
  if (!row) return bad("Rule not found", 404);
  return ok({ rule: row });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const [row] = await db.delete(reportingRules)
    .where(and(eq(reportingRules.id, params.id), eq(reportingRules.orgId, orgId!)))
    .returning();
  if (!row) return bad("Rule not found", 404);
  return ok({ deleted: true });
}
