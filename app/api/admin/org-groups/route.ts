/**
 * /api/admin/org-groups — Group Accounts (Head Office → branches).
 *
 * A Group Account is the spine that branch organisations map into so a Head
 * Office can later see consolidated receivables. Super-admin only. This route
 * manages the groups themselves; membership (which orgs belong) is set via
 * /api/admin/org-groups/[id]/members. Purely additive — nothing here changes
 * how existing single-org scoping resolves yet.
 */

import { db } from "@/db";
import { orgGroups, organisations, orgGroupUsers, users } from "@/db/schema";
import { ok, bad } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/billing";
import { desc, eq, isNotNull } from "drizzle-orm";

export async function GET() {
  const { error } = await requireSuperAdmin();
  if (error) return error;

  const groups = await db.select().from(orgGroups).orderBy(desc(orgGroups.createdAt));

  // Members inline so the admin page can render each group's branches in one call.
  const memberOrgs = await db
    .select({ id: organisations.id, name: organisations.name, slug: organisations.slug, status: organisations.status, groupId: organisations.groupId })
    .from(organisations)
    .where(isNotNull(organisations.groupId));

  // Users granted consolidated (Head-Office) access to each group.
  const groupUsers = await db
    .select({ groupId: orgGroupUsers.groupId, userId: orgGroupUsers.userId, role: orgGroupUsers.role, name: users.name, email: users.email })
    .from(orgGroupUsers)
    .innerJoin(users, eq(users.id, orgGroupUsers.userId));

  return ok(
    groups.map((g) => ({
      ...g,
      members: memberOrgs.filter((o) => o.groupId === g.id),
      users: groupUsers.filter((u) => u.groupId === g.id),
    })),
  );
}

export async function POST(req: Request) {
  const { error } = await requireSuperAdmin();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const name = body?.name ? String(body.name).trim() : "";
  if (!name) return bad("A group name is required");
  const currency = body?.currency ? String(body.currency).trim().toUpperCase().slice(0, 8) : "EUR";

  const [group] = await db.insert(orgGroups).values({ name, currency }).returning();

  // Optionally seed the first member / head office in the same step.
  const headOfficeOrgId = body?.headOfficeOrgId ? String(body.headOfficeOrgId) : null;
  if (headOfficeOrgId) {
    const [org] = await db.select({ id: organisations.id }).from(organisations).where(eq(organisations.id, headOfficeOrgId)).limit(1);
    if (org) {
      await db.update(organisations).set({ groupId: group.id, updatedAt: new Date() }).where(eq(organisations.id, headOfficeOrgId));
      await db.update(orgGroups).set({ headOfficeOrgId, updatedAt: new Date() }).where(eq(orgGroups.id, group.id));
      (group as any).headOfficeOrgId = headOfficeOrgId;
    }
  }

  return ok({ ...group, members: [] });
}
