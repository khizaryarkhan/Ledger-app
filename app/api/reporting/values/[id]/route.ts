/** Update / delete a dimension value. */
import { db } from "@/db";
import { reportingDimensionValues } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  const patch: any = { updatedAt: new Date() };
  if (body.name != null) patch.name = String(body.name).trim();
  if (body.code !== undefined) patch.code = body.code;
  if (body.parentId !== undefined) patch.parentId = body.parentId;
  if (body.sortOrder != null) patch.sortOrder = Number(body.sortOrder) || 0;
  if (body.active != null) patch.active = !!body.active;

  const [row] = await db.update(reportingDimensionValues).set(patch)
    .where(and(eq(reportingDimensionValues.id, params.id), eq(reportingDimensionValues.orgId, orgId!)))
    .returning();
  if (!row) return bad("Value not found", 404);
  return ok({ value: row });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const [row] = await db.delete(reportingDimensionValues)
    .where(and(eq(reportingDimensionValues.id, params.id), eq(reportingDimensionValues.orgId, orgId!)))
    .returning();
  if (!row) return bad("Value not found", 404);
  return ok({ deleted: true });
}
