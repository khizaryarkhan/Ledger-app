/** Update / delete a reporting dimension (cascades to its values + rules). */
import { db } from "@/db";
import { reportingDimensions } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  const patch: any = { updatedAt: new Date() };
  if (body.name != null) patch.name = String(body.name).trim();
  if (body.description !== undefined) patch.description = body.description;
  if (body.sortOrder != null) patch.sortOrder = Number(body.sortOrder) || 0;
  if (body.active != null) patch.active = !!body.active;

  const [row] = await db.update(reportingDimensions).set(patch)
    .where(and(eq(reportingDimensions.id, params.id), eq(reportingDimensions.orgId, orgId!)))
    .returning();
  if (!row) return bad("Dimension not found", 404);
  return ok({ dimension: row });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const [row] = await db.delete(reportingDimensions)
    .where(and(eq(reportingDimensions.id, params.id), eq(reportingDimensions.orgId, orgId!)))
    .returning();
  if (!row) return bad("Dimension not found", 404);
  return ok({ deleted: true });
}
