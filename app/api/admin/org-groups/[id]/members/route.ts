/**
 * /api/admin/org-groups/[id]/members — map organisations into / out of a group.
 * Super-admin only. Mapping is a single organisations.group_id write; it never
 * creates or deletes an organisation.
 */

import { db } from "@/db";
import { orgGroups, organisations } from "@/db/schema";
import { ok, bad } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/billing";
import { and, eq } from "drizzle-orm";

// POST { orgId } — add an org to this group (moves it if it was in another).
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error } = await requireSuperAdmin();
  if (error) return error;

  const [group] = await db.select({ id: orgGroups.id }).from(orgGroups).where(eq(orgGroups.id, params.id)).limit(1);
  if (!group) return bad("Group not found", 404);

  const body = await req.json().catch(() => null);
  const orgId = body?.orgId ? String(body.orgId) : "";
  if (!orgId) return bad("orgId is required");

  const [org] = await db.select({ id: organisations.id, groupId: organisations.groupId }).from(organisations).where(eq(organisations.id, orgId)).limit(1);
  if (!org) return bad("Organisation not found", 404);

  await db.update(organisations).set({ groupId: params.id, updatedAt: new Date() }).where(eq(organisations.id, orgId));
  return ok({ added: true, orgId, movedFrom: org.groupId ?? null });
}

// DELETE ?orgId=... — remove an org from this group.
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const { error } = await requireSuperAdmin();
  if (error) return error;

  const orgId = new URL(req.url).searchParams.get("orgId");
  if (!orgId) return bad("orgId is required");

  // Only detach if it actually belongs to THIS group.
  await db.update(organisations)
    .set({ groupId: null, updatedAt: new Date() })
    .where(and(eq(organisations.id, orgId), eq(organisations.groupId, params.id)));

  // If it was this group's designated Head Office, clear that too.
  const [group] = await db.select({ headOfficeOrgId: orgGroups.headOfficeOrgId }).from(orgGroups).where(eq(orgGroups.id, params.id)).limit(1);
  if (group?.headOfficeOrgId === orgId) {
    await db.update(orgGroups).set({ headOfficeOrgId: null, updatedAt: new Date() }).where(eq(orgGroups.id, params.id));
  }

  return ok({ removed: true, orgId });
}
