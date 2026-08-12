import { db } from "@/db";
import { users, userOrganisations, organisations } from "@/db/schema";
import { ok, bad } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/billing";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { sendSystemEmail, renderWelcomeEmail, getAppUrl } from "@/lib/system-mailer";

// POST /api/admin/organisations/[id]/users
// Super admin: add an existing user (by email) or create a new one, then link to this org
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { error } = await requireSuperAdmin(); // DB-revalidated
    if (error) return error;

    const orgId = params.id;

    // Verify org exists
    const [org] = await db.select({ id: organisations.id }).from(organisations).where(eq(organisations.id, orgId)).limit(1);
    if (!org) return bad("Organisation not found", 404);

    const { name, email, password, role = "company_admin" } = await req.json();
    if (!email?.trim()) return bad("Email is required");
    if (!["company_admin", "company_user"].includes(role)) return bad("Invalid role");

    const normalised = email.toLowerCase().trim();

    // Check if user already exists (by email)
    const [existing] = await db.select().from(users).where(eq(users.email, normalised)).limit(1);

    let userId: string;
    let userRecord: { id: string; name: string; email: string; role: string };

    if (existing) {
      // User exists — just link them regardless of what the frontend thought
      userId = existing.id;
      userRecord = { id: existing.id, name: existing.name, email: existing.email, role: existing.role };
    } else {
      // New user — name and password required
      if (!name?.trim()) return bad("Name is required for new users");
      if (!password || password.length < 8) return bad("Password must be at least 8 characters");
      const passwordHash = await bcrypt.hash(password, 12);
      const [created] = await db.insert(users).values({
        orgId,
        name: name.trim(),
        email: normalised,
        passwordHash,
        role,
      }).returning({ id: users.id, name: users.name, email: users.email, role: users.role });
      userId = created.id;
      userRecord = created;
    }

    // Check if already linked to THIS org — skip insert if so
    const [alreadyLinked] = await db
      .select({ id: userOrganisations.id })
      .from(userOrganisations)
      .where(and(eq(userOrganisations.userId, userId), eq(userOrganisations.orgId, orgId)))
      .limit(1);

    if (!alreadyLinked) {
      await db.insert(userOrganisations).values({ userId, orgId, role });
    }

    // Welcome the newly-created admin (e.g. when fixing an org that had none).
    if (!existing) {
      const [orgRow] = await db.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, orgId)).limit(1);
      sendSystemEmail({
        to: userRecord.email,
        subject: `Welcome to ${orgRow?.name ?? "Prime Accountax"} — your account is ready`,
        html: renderWelcomeEmail({ name: userRecord.name, orgName: orgRow?.name ?? "Prime Accountax", email: userRecord.email, password, loginUrl: `${getAppUrl()}/login` }),
      }).catch((err) => console.error("[org-user welcome]", err));
    }

    return ok({ user: userRecord, linked: !!existing, alreadyLinked: !!alreadyLinked });
  } catch (e: any) {
    console.error("[POST /api/admin/organisations/[id]/users] error:", e);
    return bad(e?.message || String(e), 500);
  }
}

// DELETE /api/admin/organisations/[id]/users?userId=...
// Super admin: remove a user from this organisation.
// - Removes the user_organisations row for (userId, orgId)
// - If this was the user's primary org (users.orgId === orgId), clears that too
// - If user has no other org memberships left, sets their status to Inactive
//   (preserves history but immediately blocks access since requireOrg() rejects inactive users)
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const { error, userId: selfId } = await requireSuperAdmin(); // DB-revalidated
    if (error) return error;

    const orgId = params.id;
    const url = new URL(req.url);
    const userId = url.searchParams.get("userId");
    if (!userId) return bad("userId required");

    // Self-removal guard
    if (userId === selfId) return bad("You cannot remove yourself", 400);

    // 1. Remove the junction-table row for this org
    await db.delete(userOrganisations)
      .where(and(eq(userOrganisations.userId, userId), eq(userOrganisations.orgId, orgId)));

    // 2. If this was their primary org, clear it
    const [u] = await db.select({ id: users.id, orgId: users.orgId })
      .from(users).where(eq(users.id, userId)).limit(1);
    if (u?.orgId === orgId) {
      await db.update(users).set({ orgId: null as any }).where(eq(users.id, userId));
    }

    // 3. If user has no other org memberships, deactivate them so JWT becomes useless
    const remaining = await db.select({ id: userOrganisations.id })
      .from(userOrganisations)
      .where(eq(userOrganisations.userId, userId));
    if (remaining.length === 0) {
      await db.update(users).set({ status: "Inactive" }).where(eq(users.id, userId));
    }

    return ok({ removed: true, remainingOrgs: remaining.length });
  } catch (e: any) {
    console.error("[DELETE /api/admin/organisations/[id]/users] error:", e);
    return bad(e?.message || String(e), 500);
  }
}
