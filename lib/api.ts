import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { db } from "@/db";
import { userOrganisations, reps, users, organisations, orgGroupUsers } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { bearerTokenFrom, verifyMobileToken, type MobileAccessClaims } from "@/lib/mobile-auth";

// Resolves the caller's session: the web app's NextAuth cookie session, or —
// when there is none — a mobile bearer token from the Authorization header.
// Returns a NextAuth-shaped session so downstream code (session.user.id, etc.)
// works unchanged for both paths. Bearer sessions carry `bearerOrgId`, the org
// the mobile client selected at login — requireOrg() below treats it exactly
// like the `active_org_id` cookie, and re-validates it against the DB either way.
async function resolveSession(): Promise<{ user: Record<string, any>; bearerOrgId?: string } | null> {
  const session = await auth();
  if (session?.user) return session as any;

  let authHeader: string | null = null;
  try { authHeader = headers().get("authorization"); } catch { /* not in a request context */ }
  const token = bearerTokenFrom(authHeader);
  if (!token) return null;

  const claims = await verifyMobileToken<MobileAccessClaims>(token, "mobile_access");
  if (!claims) return null;

  return {
    user: { id: claims.sub, role: claims.role, orgId: claims.orgId, repId: claims.repId, email: claims.email },
    bearerOrgId: claims.orgId,
  };
}

export async function requireAuth() {
  const session = await resolveSession();
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), session: null, orgId: null };
  }
  const orgId = (session.user as any).orgId as string | null;
  return { error: null, session, orgId };
}

export async function requireOrgAuth() {
  const { error, session, orgId } = await requireAuth();
  if (error) return { error, session: null, orgId: null };
  if (!orgId) {
    return { error: NextResponse.json({ error: "No organisation assigned" }, { status: 403 }), session: null, orgId: null };
  }
  return { error: null, session, orgId };
}

export function isSuperAdmin(session: any) {
  return (session?.user as any)?.role === "super_admin";
}

export function isPlatformAdmin(session: any) {
  const role = (session?.user as any)?.role;
  return role === "super_admin" || role === "platform_admin";
}

// Returns orgId, role, repId for the ACTIVE org — strict membership-validated.
//
// Hardening (CRITICAL for multi-tenant safety):
// 1. Verifies users.status is "Active" on EVERY request (deactivated users blocked immediately)
// 2. Verifies user has a CURRENT user_organisations membership for the resolved orgId
//    (super_admin exempt — they can access any org via cookie)
// 3. Role and repId resolved against the active org, not the stale JWT
//
// Result: removing a user from user_organisations or setting status=Inactive
// blocks access immediately, regardless of what's in the JWT.
export async function requireOrg() {
  const session = await resolveSession();
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), session: null, orgId: null, role: null, repId: null };
  }
  const userId      = (session.user as any).id     as string;
  const jwtRepId    = (session.user as any).repId  as string | null ?? null;

  // STEP 1: Re-validate the user record on every request.
  // Catches: deactivated users, deleted users, role changes.
  const [userRow] = await db.select({
    id: users.id, status: users.status, role: users.role, orgId: users.orgId,
  }).from(users).where(eq(users.id, userId)).limit(1);

  if (!userRow) {
    return { error: NextResponse.json({ error: "Account no longer exists" }, { status: 401 }), session: null, orgId: null, role: null, repId: null };
  }
  if (userRow.status !== "Active") {
    return { error: NextResponse.json({ error: "Account is inactive" }, { status: 403 }), session: null, orgId: null, role: null, repId: null };
  }

  const isSuperAdmin = userRow.role === "super_admin";

  // STEP 2: Resolve which org the user is acting on.
  let activeOrgCookie: string | null = null;
  try {
    const cookieStore = cookies();
    activeOrgCookie = cookieStore.get("active_org_id")?.value || null;
  } catch { /* edge case */ }
  // Mobile bearer sessions carry no cookie — the org chosen at login stands in for it.
  if (!activeOrgCookie) activeOrgCookie = (session as any).bearerOrgId || null;

  let orgId: string | null = null;
  let orgRole: string | null = null;

  // STEP 3: Validate membership for the requested org.
  // Super admin: can access any org if cookie is set, otherwise their default
  // Everyone else: MUST have a user_organisations row for the org they want to access
  if (isSuperAdmin) {
    orgId = activeOrgCookie || userRow.orgId;
  } else {
    // Try cookie first
    if (activeOrgCookie) {
      const [m] = await db.select({ orgId: userOrganisations.orgId, role: userOrganisations.role })
        .from(userOrganisations)
        .where(and(eq(userOrganisations.userId, userId), eq(userOrganisations.orgId, activeOrgCookie)))
        .limit(1);
      if (m) { orgId = m.orgId; orgRole = m.role; }
    }
    // Try the JWT primary org — but ONLY if user still has a junction-table membership for it
    if (!orgId && userRow.orgId) {
      const [m] = await db.select({ orgId: userOrganisations.orgId, role: userOrganisations.role })
        .from(userOrganisations)
        .where(and(eq(userOrganisations.userId, userId), eq(userOrganisations.orgId, userRow.orgId)))
        .limit(1);
      if (m) { orgId = m.orgId; orgRole = m.role; }
    }
    // Final fallback: ANY org the user is a member of. Without this, a user
    // linked to an org purely via user_organisations (e.g. an existing account
    // an admin attached to a new org) whose home users.orgId is null/another org
    // — and with no active_org cookie yet (fresh login) — would be locked out
    // with "no access to any organisation" despite holding a valid membership.
    // Safe: it only ever resolves an org the user has a real membership row for.
    if (!orgId) {
      const [m] = await db.select({ orgId: userOrganisations.orgId, role: userOrganisations.role })
        .from(userOrganisations)
        .where(eq(userOrganisations.userId, userId))
        .orderBy(userOrganisations.orgId)
        .limit(1);
      if (m) { orgId = m.orgId; orgRole = m.role; }
    }
  }

  if (!orgId) {
    return { error: NextResponse.json({ error: "You do not have access to any organisation" }, { status: 403 }), session: null, orgId: null, role: null, repId: null };
  }

  // STEP 4: Final role — super_admin always wins; otherwise per-org role from junction
  const role = isSuperAdmin ? "super_admin" : (orgRole || userRow.role);

  // STEP 5: repId only valid if the rep belongs to the active org
  let repId: string | null = null;
  if (jwtRepId) {
    const [rep] = await db.select({ id: reps.id })
      .from(reps)
      .where(and(eq(reps.id, jwtRepId), eq(reps.orgId, orgId)))
      .limit(1);
    if (rep) repId = rep.id;
  }

  return { error: null, session, orgId, role, repId };
}

/**
 * Consolidated (group) read scope. Resolves the set of org ids the caller may
 * view for their ACTIVE group (the `active_group_id` cookie set by the org
 * switcher). Group access comes from `org_group_users` (super_admin sees any
 * group). Used ONLY by consolidated read endpoints — per-org routes keep using
 * requireOrg(), so this never widens single-org access.
 */
// Internal: if the caller has a VALID, AUTHORISED active group (active_group_id
// cookie), return that group's org set; otherwise null. Authorisation mirrors
// org_group_users (super_admin sees any group). Never throws.
async function resolveActiveGroup(session: any): Promise<{ groupId: string; orgIds: string[]; role: string } | null> {
  let activeGroupId: string | null = null;
  try { activeGroupId = cookies().get("active_group_id")?.value || null; } catch { /* edge */ }
  if (!activeGroupId) return null;

  const userId = (session?.user as any)?.id as string | undefined;
  const isSuper = (session?.user as any)?.role === "super_admin";
  if (!userId) return null;

  let role = "ho_manager";
  if (!isSuper) {
    const [grant] = await db.select({ role: orgGroupUsers.role })
      .from(orgGroupUsers)
      .where(and(eq(orgGroupUsers.userId, userId), eq(orgGroupUsers.groupId, activeGroupId)))
      .limit(1);
    if (!grant) return null;            // group selected but not authorised → no group scope
    role = grant.role;
  }

  const orgs = await db.select({ id: organisations.id })
    .from(organisations)
    .where(eq(organisations.groupId, activeGroupId));
  return { groupId: activeGroupId, orgIds: orgs.map((o) => o.id), role };
}

// Strict group scope for the dedicated consolidated endpoints — errors if there
// is no valid active group.
export async function requireGroupScope() {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), orgIds: [] as string[], groupId: null as string | null, role: null as string | null, session: null };
  }
  const g = await resolveActiveGroup(session);
  if (!g) {
    return { error: NextResponse.json({ error: "No group selected, or you don't have access to it" }, { status: 400 }), orgIds: [] as string[], groupId: null as string | null, role: null as string | null, session };
  }
  return { error: null, orgIds: g.orgIds, groupId: g.groupId, role: g.role, session };
}

// Read scope for the MAIN APP. When a valid group is active, reads span every
// org in the group (consolidated "one account" view); otherwise they scope to
// the single active org exactly as before. Use this in GET list endpoints and
// filter with inArray(table.orgId, orgIds). WRITES must keep using requireOrg()
// (a write always targets one org).
export async function requireReadScope() {
  const base = await requireOrg();
  if (base.error) return { ...base, orgIds: [] as string[], isGroup: false, groupId: null as string | null };
  const g = base.session ? await resolveActiveGroup(base.session) : null;
  if (g && g.orgIds.length > 0) {
    return { ...base, orgIds: g.orgIds, isGroup: true, groupId: g.groupId };
  }
  return { ...base, orgIds: [base.orgId!], isGroup: false, groupId: null as string | null };
}

/**
 * Verify a client-supplied foreign-key id belongs to the caller's org.
 *
 * Postgres FK constraints only prove a row EXISTS — not that it's same-org. So
 * a POST/PATCH that accepts customerId/projectId/repId/assigneeId from the body
 * could otherwise link to another tenant's row (IDOR). Call this for every such
 * id before persisting. A null/undefined id is treated as "not provided" → true
 * (the field is optional); pass a concrete id to enforce ownership.
 *
 * `table` must expose `id` and `orgId` columns (all tenant-owned tables do).
 */
export async function ownsInOrg(
  table: { id: any; orgId: any },
  id: string | null | undefined,
  orgId: string,
): Promise<boolean> {
  if (!id) return true;
  const [row] = await db
    .select({ id: table.id })
    .from(table as any)
    .where(and(eq(table.id, id), eq(table.orgId, orgId)))
    .limit(1);
  return !!row;
}

/**
 * Verify a client-supplied user id is a member of the caller's org. Use for
 * assignee/owner fields that reference `users` (which aren't org-scoped rows).
 * Null/undefined → true (optional field not provided).
 */
export async function userInOrg(userId: string | null | undefined, orgId: string): Promise<boolean> {
  if (!userId) return true;
  const [m] = await db
    .select({ userId: userOrganisations.userId })
    .from(userOrganisations)
    .where(and(eq(userOrganisations.userId, userId), eq(userOrganisations.orgId, orgId)))
    .limit(1);
  return !!m;
}

export function requireRole(role: string, minRole: string) {
  const hierarchy = ["company_user", "company_admin", "super_admin"];
  return hierarchy.indexOf(role) >= hierarchy.indexOf(minRole);
}

/**
 * Who may post a FLOOR inventory transaction — a goods receipt, a shipment, or
 * a production build.
 *
 * These record physical stock movement and are done by warehouse/production
 * staff, who are ordinary `company_user`s, not finance admins. Gating them on
 * company_admin made the whole receiving/production/shipping flow unusable for
 * the people who actually do the work (and made the mobile app pointless).
 *
 * What stays admin-only, deliberately:
 *  - turning a receipt/shipment into a money document (Bill → A/P,
 *    Invoice → A/R): `receiving/bill`, `shipping/invoice`
 *  - voiding/reversing a posted document: the `[id]` routes
 *  - master data: items, SKUs, supplier SKUs, BOMs, BOM lines
 *
 * So an operator can say "this stock physically arrived / shipped / was built",
 * but cannot create a payable, a receivable, or unwind posted history.
 * `rep` and `platform_admin` are intentionally excluded (they aren't org
 * operators); requireRole's hierarchy already yields false for them.
 */
export function canPostInventoryTxn(role: string | null | undefined): boolean {
  return !!role && requireRole(role, "company_user");
}

export function ok(data: any) { return NextResponse.json(data); }
export function bad(message: string, status = 400) { return NextResponse.json({ error: message }, { status }); }
