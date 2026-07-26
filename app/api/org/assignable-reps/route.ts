/**
 * GET /api/org/assignable-reps — the people who can be assigned to a
 * project/customer in THIS org, for the Reclassify pickers.
 *
 * Unlike /api/reps (which lists only the reps table for this org), this covers
 * EVERY assignable team member of the org:
 *   • Reps / EDs — including users whose home org is different but who are
 *     ATTACHED to this org via user_organisations (previously invisible because
 *     their reps row lives in their home org).
 *   • Company admins — so an admin can own a project as a rep.
 *
 * For any assignable member that has no reps row in THIS org yet, one is created
 * (matched by email to avoid duplicates), so projects.repId / customers.repId —
 * which FK to reps(id) scoped to the org — resolve correctly and the existing
 * reclassify ownership check passes.
 */
import { db } from "@/db";
import { users, userOrganisations, reps } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { and, eq, or, sql, inArray } from "drizzle-orm";

const ADMIN_ROLES = new Set(["company_admin", "super_admin", "platform_admin"]);

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  // All members of this org (home-org accounts + attached multi-org users),
  // with the role that applies IN this org.
  const members = await db
    .select({
      id: users.id, name: users.name, email: users.email, status: users.status,
      role: sql<string>`COALESCE(${userOrganisations.role}, ${users.role})`,
      homeRepId: users.repId,
    })
    .from(users)
    .leftJoin(userOrganisations, and(
      eq(userOrganisations.userId, users.id),
      eq(userOrganisations.orgId, orgId!),
    ))
    .where(or(eq(users.orgId, orgId!), eq(userOrganisations.orgId, orgId!)));

  // Assignable = anyone who can own work: reps/EDs (role "rep") and admins.
  const assignable = members.filter(m =>
    m.status === "Active" && (m.role === "rep" || ADMIN_ROLES.has(m.role)));

  // Tier (PM vs ED/RM) comes from the member's home reps row; admins → "rep" (PM).
  const homeRepIds = [...new Set(assignable.map(m => m.homeRepId).filter(Boolean))] as string[];
  const homeReps = homeRepIds.length
    ? await db.select({ id: reps.id, tier: reps.tier }).from(reps).where(inArray(reps.id, homeRepIds))
    : [];
  const tierByHomeRep = new Map(homeReps.map(r => [r.id, r.tier]));
  const tierOf = (m: typeof assignable[number]) =>
    ADMIN_ROLES.has(m.role) ? "rep" : (m.homeRepId ? (tierByHomeRep.get(m.homeRepId) ?? "rep") : "rep");

  // Existing reps in this org, keyed by email so we never duplicate.
  const orgReps = await db.select().from(reps).where(eq(reps.orgId, orgId!));
  const byEmail = new Map(orgReps.filter(r => r.email).map(r => [r.email!.toLowerCase(), r]));

  // Create a rep row in this org for any assignable member (with an email) that
  // lacks one. Email is the join key, so this stays idempotent across calls.
  const toCreate: { orgId: string; name: string; email: string; tier: string }[] = [];
  const queued = new Set<string>();
  for (const m of assignable) {
    const key = (m.email ?? "").toLowerCase();
    if (!key || byEmail.has(key) || queued.has(key)) continue;
    queued.add(key);
    toCreate.push({ orgId: orgId!, name: m.name, email: m.email!, tier: tierOf(m) });
  }
  if (toCreate.length > 0) {
    const created = await db.insert(reps).values(toCreate).returning();
    for (const r of created) if (r.email) byEmail.set(r.email.toLowerCase(), r);
  }

  // One entry per assignable member, using their org-local rep row.
  const result: { id: string; name: string; tier: string }[] = [];
  const seen = new Set<string>();
  for (const m of assignable) {
    const rep = m.email ? byEmail.get(m.email.toLowerCase()) : null;
    if (rep && !seen.has(rep.id)) {
      seen.add(rep.id);
      // Prefer the org-local rep row's tier (org-specific designation); fall
      // back to the member's home tier for freshly-created rows.
      result.push({ id: rep.id, name: m.name, tier: rep.tier ?? tierOf(m) });
    }
  }
  result.sort((a, b) => a.name.localeCompare(b.name));
  return ok(result);
}
