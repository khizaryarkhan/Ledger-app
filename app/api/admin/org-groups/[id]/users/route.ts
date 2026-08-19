/**
 * /api/admin/org-groups/[id]/users — who may access this Group Account's
 * consolidated view, and in what capacity. Super-admin only.
 *
 * role: 'ho_manager' (full across the group) | 'ho_finance' (receivables).
 * This grants GROUP-level access on top of whatever per-org access the user
 * already has — it never changes or removes their branch-level access.
 */

import { db } from "@/db";
import { orgGroups, orgGroupUsers, users } from "@/db/schema";
import { ok, bad } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/billing";
import { and, eq } from "drizzle-orm";

const ROLES = new Set(["ho_manager", "ho_finance"]);

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error } = await requireSuperAdmin();
  if (error) return error;

  const rows = await db
    .select({ userId: orgGroupUsers.userId, role: orgGroupUsers.role, name: users.name, email: users.email })
    .from(orgGroupUsers)
    .innerJoin(users, eq(users.id, orgGroupUsers.userId))
    .where(eq(orgGroupUsers.groupId, params.id));

  return ok(rows);
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error } = await requireSuperAdmin();
  if (error) return error;

  const [group] = await db.select({ id: orgGroups.id }).from(orgGroups).where(eq(orgGroups.id, params.id)).limit(1);
  if (!group) return bad("Group not found", 404);

  const body = await req.json().catch(() => null);
  const email = body?.email ? String(body.email).toLowerCase().trim() : "";
  const role = body?.role ? String(body.role) : "ho_finance";
  if (!email) return bad("An email is required");
  if (!ROLES.has(role)) return bad("Invalid role");

  // The user must already have a login — group access is granted to existing
  // people, not created here. (Create their login via a branch's Users first.)
  const [user] = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.email, email)).limit(1);
  if (!user) return bad(`No user found with the email "${email}". Create their login first, then grant group access.`, 404);

  // Upsert: if already granted, just update the role.
  const [existing] = await db.select({ id: orgGroupUsers.id }).from(orgGroupUsers)
    .where(and(eq(orgGroupUsers.groupId, params.id), eq(orgGroupUsers.userId, user.id))).limit(1);
  if (existing) {
    await db.update(orgGroupUsers).set({ role }).where(eq(orgGroupUsers.id, existing.id));
  } else {
    await db.insert(orgGroupUsers).values({ groupId: params.id, userId: user.id, role });
  }

  return ok({ userId: user.id, name: user.name, email: user.email, role, updated: !!existing });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const { error } = await requireSuperAdmin();
  if (error) return error;

  const userId = new URL(req.url).searchParams.get("userId");
  if (!userId) return bad("userId is required");

  await db.delete(orgGroupUsers).where(and(eq(orgGroupUsers.groupId, params.id), eq(orgGroupUsers.userId, userId)));
  return ok({ removed: true, userId });
}
