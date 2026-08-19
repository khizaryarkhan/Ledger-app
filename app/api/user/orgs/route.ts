import { auth } from "@/lib/auth";
import { db } from "@/db";
import { userOrganisations, organisations, orgGroups, orgGroupUsers } from "@/db/schema";
import { eq, or, desc } from "drizzle-orm";
import { ok, bad } from "@/lib/api";
import { cookies } from "next/headers";

// Groups the user may view consolidated (Head-Office access). Rendered at the
// top of the switcher as "All branches" entries. type:"group" so the switcher
// and switch-org know to enter group mode rather than single-org mode.
async function groupEntries(userId: string, isSuperAdmin: boolean, activeGroupId: string | null) {
  const rows = isSuperAdmin
    ? await db.select({ id: orgGroups.id, name: orgGroups.name }).from(orgGroups).orderBy(desc(orgGroups.createdAt))
    : await db.select({ id: orgGroups.id, name: orgGroups.name, role: orgGroupUsers.role })
        .from(orgGroupUsers)
        .innerJoin(orgGroups, eq(orgGroups.id, orgGroupUsers.groupId))
        .where(eq(orgGroupUsers.userId, userId));
  return rows.map((g: any) => ({
    id: g.id, name: g.name, displayName: null, logoUrl: null,
    role: g.role ?? "ho_manager", type: "group" as const,
    isActive: !!activeGroupId && activeGroupId === g.id,
  }));
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return bad("Unauthorized", 401);

  const userId       = (session.user as any).id     as string;
  const userRole     = (session.user as any).role   as string;
  const defaultOrgId = (session.user as any).orgId  as string | null;
  const isSuperAdmin = userRole === "super_admin";

  const cookieStore = cookies();
  const activeGroupId = cookieStore.get("active_group_id")?.value ?? null;
  // While a group is active, no single org is "active" in the switcher.
  const activeOrgId = activeGroupId ? null : (cookieStore.get("active_org_id")?.value ?? defaultOrgId);
  const groups = await groupEntries(userId, isSuperAdmin, activeGroupId);

  // Super admin: return ALL organisations (they can switch between any of them).
  if (isSuperAdmin) {
    const orgs = await db
      .select({
        id: organisations.id,
        name: organisations.name,
        displayName: organisations.displayName,
        logoUrl: organisations.logoUrl,
      })
      .from(organisations)
      .orderBy(desc(organisations.createdAt));

    return ok([
      ...groups,
      ...orgs.map(org => ({
        ...org, type: "org" as const,
        role: "super_admin",
        isActive: org.id === activeOrgId,
      })),
    ]);
  }

  // Regular user: only orgs they're a member of via the junction table.
  const memberships = await db
    .select({ orgId: userOrganisations.orgId, role: userOrganisations.role })
    .from(userOrganisations)
    .where(eq(userOrganisations.userId, userId));

  // Also include the user's default orgId if not already in junction table
  const orgIds = new Set(memberships.map(m => m.orgId));
  if (defaultOrgId && !orgIds.has(defaultOrgId)) {
    orgIds.add(defaultOrgId);
    memberships.push({ orgId: defaultOrgId, role: userRole ?? "company_user" });
  }

  if (orgIds.size === 0) return ok(groups);

  const orgs = await db
    .select({
      id: organisations.id,
      name: organisations.name,
      displayName: organisations.displayName,
      logoUrl: organisations.logoUrl,
    })
    .from(organisations)
    .where(or(...[...orgIds].map(id => eq(organisations.id, id))));

  return ok([
    ...groups,
    ...orgs.map(org => ({
      ...org, type: "org" as const,
      role: memberships.find(m => m.orgId === org.id)?.role ?? "company_user",
      isActive: org.id === activeOrgId,
    })),
  ]);
}
