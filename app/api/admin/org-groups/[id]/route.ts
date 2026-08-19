/**
 * /api/admin/org-groups/[id] — one Group Account: detail, edit, delete.
 * Super-admin only.
 */

import { db } from "@/db";
import { orgGroups, organisations } from "@/db/schema";
import { ok, bad } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/billing";
import { eq } from "drizzle-orm";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error } = await requireSuperAdmin();
  if (error) return error;

  const [group] = await db.select().from(orgGroups).where(eq(orgGroups.id, params.id)).limit(1);
  if (!group) return bad("Group not found", 404);

  const members = await db
    .select({ id: organisations.id, name: organisations.name, slug: organisations.slug, status: organisations.status })
    .from(organisations)
    .where(eq(organisations.groupId, params.id));

  return ok({ ...group, members });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error } = await requireSuperAdmin();
  if (error) return error;

  const [group] = await db.select().from(orgGroups).where(eq(orgGroups.id, params.id)).limit(1);
  if (!group) return bad("Group not found", 404);

  const body = await req.json().catch(() => ({}));
  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return bad("Group name cannot be empty");
    updates.name = name;
  }
  if (body.currency !== undefined) updates.currency = String(body.currency).trim().toUpperCase().slice(0, 8);
  if (body.logoUrl !== undefined) updates.logoUrl = body.logoUrl ? String(body.logoUrl) : null;
  if (body.headOfficeOrgId !== undefined) {
    const hoId = body.headOfficeOrgId ? String(body.headOfficeOrgId) : null;
    if (hoId) {
      // The head office must be a member of THIS group.
      const [m] = await db.select({ id: organisations.id }).from(organisations)
        .where(eq(organisations.id, hoId)).limit(1);
      if (!m) return bad("That organisation doesn't exist", 404);
      const [inGroup] = await db.select({ groupId: organisations.groupId }).from(organisations).where(eq(organisations.id, hoId)).limit(1);
      if (inGroup?.groupId !== params.id) return bad("The Head Office must be a member of this group — add it first");
    }
    updates.headOfficeOrgId = hoId;
  }
  if (Object.keys(updates).length === 1) return bad("Nothing to update");

  await db.update(orgGroups).set(updates).where(eq(orgGroups.id, params.id));
  const [updated] = await db.select().from(orgGroups).where(eq(orgGroups.id, params.id)).limit(1);
  return ok(updated);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error } = await requireSuperAdmin();
  if (error) return error;

  const [group] = await db.select({ id: orgGroups.id }).from(orgGroups).where(eq(orgGroups.id, params.id)).limit(1);
  if (!group) return bad("Group not found", 404);

  // Detach members first (neon-http has no transactions), then remove the group.
  // Deleting a group never deletes any organisation — it only un-groups them.
  await db.update(organisations).set({ groupId: null, updatedAt: new Date() }).where(eq(organisations.groupId, params.id));
  await db.delete(orgGroups).where(eq(orgGroups.id, params.id));

  return ok({ deleted: true });
}
