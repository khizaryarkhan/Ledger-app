/**
 * PATCH  /api/batch/scheduled/[id] — toggle active / edit fields.
 * DELETE /api/batch/scheduled/[id] — remove a schedule.
 */

import { db } from "@/db";
import { scheduledImports } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrg, ok } from "@/lib/api";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const body = await req.json().catch(() => ({}));

  const set: any = { updatedAt: new Date() };
  if (typeof body.active === "boolean") set.active = body.active;
  if (typeof body.cadence === "string" && ["hourly", "daily", "weekly"].includes(body.cadence)) set.cadence = body.cadence;
  if (typeof body.name === "string" && body.name.trim()) set.name = body.name.trim();

  await db.update(scheduledImports).set(set)
    .where(and(eq(scheduledImports.id, params.id), eq(scheduledImports.orgId, orgId!)));
  return ok({ updated: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  await db.delete(scheduledImports)
    .where(and(eq(scheduledImports.id, params.id), eq(scheduledImports.orgId, orgId!)));
  return ok({ deleted: true });
}
