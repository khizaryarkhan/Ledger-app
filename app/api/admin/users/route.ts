import { db } from "@/db";
import { users, userOrganisations, reps } from "@/db/schema";
import { isSuperAdmin, requireOrg, ok, bad } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/billing";
import { logEvent } from "@/lib/audit";
import { z } from "zod";
import { eq, and, or, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";

// Virtual roles exposed to the UI:
//   company_admin  → Admin          (users.role = 'company_admin')
//   company_user   → Full Access    (users.role = 'company_user')
//   rep            → Rep / PM       (users.role = 'rep', reps.tier = 'rep')
//   ed             → ED / RM        (users.role = 'rep', reps.tier = 'ed')
//
// 'rep' and 'ed' both map to users.role='rep'; tier is stored in the reps table.

const UserSchema = z.object({
  orgId:     z.string().uuid().optional(),
  name:      z.string().min(1),
  email:     z.string().email(),
  password:  z.string().min(8),
  role:      z.enum(["company_admin", "company_user", "rep", "ed"]).default("company_user"),
  managerId: z.string().uuid().optional(), // for rep users: which ED/RM rep record they report to
});

const userCols = {
  id: users.id, orgId: users.orgId, name: users.name,
  email: users.email, role: users.role, status: users.status,
  createdAt: users.createdAt, repId: users.repId,
};

// ── GET ──────────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;
  const isSuper = isSuperAdmin(session);

  const url = new URL(req.url);

  // ?email= lookup (used by org creation modal to check if user exists)
  const emailParam = url.searchParams.get("email");
  if (emailParam) {
    const [found] = await db.select(userCols).from(users).where(eq(users.email, emailParam.toLowerCase())).limit(1);
    return ok(found ? [found] : []);
  }

  // ?orgId= lookup — super admin fetching users of a specific org. Must cover
  // BOTH membership models: users linked via user_organisations (multi-org /
  // invited) AND legacy users whose primary users.orgId is this org but who
  // have no junction row. Querying only the junction table missed the latter,
  // so long-standing orgs (e.g. EDC) showed "no users".
  const orgIdParam = url.searchParams.get("orgId");
  if (orgIdParam) {
    if (!isSuper) return bad("Forbidden", 403);
    const rows = await db
      .select({
        id: users.id, orgId: users.orgId, name: users.name,
        email: users.email,
        role: sql<string>`COALESCE(${userOrganisations.role}, ${users.role})`,
        status: users.status, createdAt: users.createdAt, repId: users.repId,
        repTier: reps.tier, repManagerId: reps.managerId,
      })
      .from(users)
      .leftJoin(userOrganisations, and(eq(userOrganisations.userId, users.id), eq(userOrganisations.orgId, orgIdParam)))
      .leftJoin(reps, eq(reps.id, users.repId))
      .where(or(eq(users.orgId, orgIdParam), eq(userOrganisations.orgId, orgIdParam)));
    return ok(rows);
  }

  // List all members of this org.
  // Covers two cases:
  //   1. users.orgId = orgId (primary-org users, all existing accounts)
  //   2. user_organisations.orgId = orgId (multi-org / invited users)
  // The LEFT JOIN on user_organisations lets us pick up the org-specific role
  // when present; falls back to users.role for single-org accounts.
  const rows = await db
    .select({
      id: users.id, orgId: users.orgId, name: users.name,
      email: users.email,
      role: sql<string>`COALESCE(${userOrganisations.role}, ${users.role})`,
      status: users.status, createdAt: users.createdAt, repId: users.repId,
      repTier: reps.tier, repManagerId: reps.managerId,
    })
    .from(users)
    .leftJoin(userOrganisations, and(
      eq(userOrganisations.userId, users.id),
      eq(userOrganisations.orgId, orgId!),
    ))
    .leftJoin(reps, and(eq(reps.id, users.repId), eq(reps.orgId, orgId!)))
    .where(or(
      eq(users.orgId, orgId!),
      eq(userOrganisations.orgId, orgId!),
    ));
  return ok(rows);
}

// ── POST — create user ────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;
  const isSuper = isSuperAdmin(session);
  const isAdmin = (session!.user as any).role === "company_admin";
  if (!isSuper && !isAdmin) return bad("Only Company Admins can create users", 403);

  try {
    const data = UserSchema.parse(await req.json());
    const targetOrgId = isSuper ? (data.orgId || orgId!) : orgId!;

    const isPortalRole = data.role === "rep" || data.role === "ed";
    const dbRole  = isPortalRole ? "rep" : data.role;
    const repTier = data.role === "ed" ? "ed" : data.role === "rep" ? "rep" : null;

    const [existing] = await db.select().from(users).where(eq(users.email, data.email.toLowerCase())).limit(1);
    if (existing) return bad(`Email "${data.email}" is already registered`, 409);

    const passwordHash = await bcrypt.hash(data.password, 12);
    const [created] = await db.insert(users).values({
      orgId: targetOrgId, name: data.name,
      email: data.email.toLowerCase(), passwordHash, role: dbRole,
    }).returning(userCols);

    // For Rep/ED: create reps record and link via users.repId
    let repTierOut: string | null = null;
    let repManagerIdOut: string | null = null;
    if (repTier) {
      const [repRecord] = await db.insert(reps).values({
        orgId: targetOrgId, name: data.name,
        email: data.email.toLowerCase(), tier: repTier,
        ...(data.managerId ? { managerId: data.managerId } : {}),
      }).returning();
      await db.update(users).set({ repId: repRecord.id }).where(eq(users.id, created.id));
      repTierOut = repTier;
      repManagerIdOut = repRecord.managerId ?? null;
      (created as any).repId = repRecord.id;
    }

    // Junction row — required by requireOrg() on every API call
    await db.insert(userOrganisations).values({
      userId: created.id, orgId: targetOrgId, role: dbRole,
    });

    return ok({ ...created, repTier: repTierOut, repManagerId: repManagerIdOut });
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    return bad("Failed to create user", 500);
  }
}

// ── PUT — full update (super admin only) ─────────────────────────────────────
export async function PUT(req: Request) {
  const { error } = await requireSuperAdmin(); // DB-revalidated
  if (error) return error;

  try {
    const { userId, name, email, role } = await req.json();
    if (!userId) return bad("userId required");

    const [target] = await db.select(userCols).from(users).where(eq(users.id, userId)).limit(1);
    if (!target) return bad("User not found", 404);

    const updates: Record<string, any> = {};
    if (name?.trim()) updates.name = name.trim();
    if (email?.trim()) {
      const normalised = email.toLowerCase().trim();
      if (normalised !== target.email) {
        const [clash] = await db.select({ id: users.id }).from(users).where(eq(users.email, normalised)).limit(1);
        if (clash) return bad(`Email "${normalised}" is already registered`, 409);
        updates.email = normalised;
      }
    }
    if (role && ["company_admin", "company_user"].includes(role)) updates.role = role;

    if (Object.keys(updates).length === 0) return bad("Nothing to update");
    await db.update(users).set(updates).where(eq(users.id, userId));
    const [updated] = await db.select(userCols).from(users).where(eq(users.id, userId)).limit(1);
    return ok(updated);
  } catch (e: any) {
    return bad("Failed to update user", 500);
  }
}

// ── PATCH — partial update (role change or status toggle) ────────────────────
export async function PATCH(req: Request) {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;
  const isSuper = isSuperAdmin(session);
  const isAdmin = (session!.user as any).role === "company_admin";
  if (!isSuper && !isAdmin) return bad("Forbidden", 403);

  try {
    const body = await req.json();

    // ── Role change ──────────────────────────────────────────────────────────
    if (body.role !== undefined) {
      const { userId, role: virtualRole } = body;
      if (!userId) return bad("userId required");

      // company_admin may not elevate anyone to company_admin (only super can).
      // NB: both branches of this ternary used to be identical — the guard was dead.
      const allowed = isSuper
        ? ["company_admin", "company_user", "rep", "ed"]
        : ["company_user", "rep", "ed"];
      if (!allowed.includes(virtualRole)) return bad("Invalid role or insufficient permissions", 403);

      const dbRole    = ["rep", "ed"].includes(virtualRole) ? "rep" : virtualRole;
      const targetTier = virtualRole === "ed" ? "ed" : virtualRole === "rep" ? "rep" : null;

      const [target] = await db.select(userCols).from(users).where(eq(users.id, userId)).limit(1);
      if (!target) return bad("User not found", 404);
      if (!isSuper && target.orgId !== orgId) return bad("Forbidden", 403);

      // Update users + junction
      await db.update(users).set({ role: dbRole }).where(eq(users.id, userId));
      await db.update(userOrganisations).set({ role: dbRole })
        .where(and(eq(userOrganisations.userId, userId), eq(userOrganisations.orgId, orgId!)));

      // Handle reps table for portal roles
      // managerId can be set when assigning rep/ed tier — which RD/ED they report to
      const managerId: string | null = body.managerId || null;

      if (targetTier) {
        if (target.repId) {
          // Already has a rep record — update tier and manager
          await db.update(reps)
            .set({ tier: targetTier, managerId })
            .where(and(eq(reps.id, target.repId), eq(reps.orgId, orgId!)));
        } else {
          // Create a new rep record and link
          const [repRecord] = await db.insert(reps).values({
            orgId: orgId!, name: target.name, email: target.email, tier: targetTier,
            ...(managerId ? { managerId } : {}),
          }).returning();
          await db.update(users).set({ repId: repRecord.id }).where(eq(users.id, userId));
        }
      } else {
        // Demoting from rep/ed → unlink and delete reps record (cascades to set projects.repId=null)
        if (target.repId) {
          await db.update(users).set({ repId: null }).where(eq(users.id, userId));
          await db.delete(reps)
            .where(and(eq(reps.id, target.repId), eq(reps.orgId, orgId!)));
        }
      }

      await logEvent({
        orgId: target.orgId || orgId!, eventType: "user_role_changed",
        actorId: (session!.user as any).id, actorName: (session!.user as any).name ?? null,
        meta: { targetUserId: userId, targetEmail: target.email, newRole: dbRole },
      });
      return ok({ success: true });
    }

    // ── Status toggle ────────────────────────────────────────────────────────
    const { userId, status } = body;
    if (!userId || !["Active", "Inactive"].includes(status)) return bad("Invalid request");
    const [target] = await db.select(userCols).from(users).where(eq(users.id, userId)).limit(1);
    if (!target) return bad("User not found", 404);
    if (!isSuper && target.orgId !== orgId) return bad("Forbidden", 403);
    await db.update(users).set({ status }).where(eq(users.id, userId));
    if (status === "Inactive") {
      await logEvent({
        orgId: target.orgId || orgId!, eventType: "user_deactivated",
        actorId: (session!.user as any).id, actorName: (session!.user as any).name ?? null,
        meta: { targetUserId: userId, targetEmail: target.email },
      });
    }
    return ok({ success: true });
  } catch (e: any) {
    return bad("Failed to update user", 500);
  }
}

// ── DELETE ───────────────────────────────────────────────────────────────────
export async function DELETE(req: Request) {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;
  const isSuper = isSuperAdmin(session);
  const isAdmin = (session!.user as any).role === "company_admin";
  if (!isSuper && !isAdmin) return bad("Only admins can delete users", 403);

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  if (!userId) return bad("userId required");

  const [target] = await db.select(userCols).from(users).where(eq(users.id, userId)).limit(1);
  if (!target) return bad("User not found", 404);
  if (!isSuper && target.orgId !== orgId) return bad("Forbidden", 403);
  if (target.role === "super_admin") return bad("Cannot delete super admins", 403);
  if ((session!.user as any).id === userId) return bad("Cannot delete your own account", 403);

  // Delete reps record first (if any) so the cascade sets projects.repId=null cleanly
  if (target.repId) {
    await db.update(users).set({ repId: null }).where(eq(users.id, userId));
    await db.delete(reps).where(eq(reps.id, target.repId));
  }

  await db.delete(userOrganisations).where(eq(userOrganisations.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  await logEvent({
    orgId: target.orgId || orgId!, eventType: "user_deactivated",
    actorId: (session!.user as any).id, actorName: (session!.user as any).name ?? null,
    meta: { targetUserId: userId, targetEmail: target.email, deleted: true },
  });
  return ok({ deleted: true });
}
