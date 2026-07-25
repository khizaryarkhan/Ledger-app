/**
 * POST /api/org/users/reset-password — admin resets a team member's password.
 *
 * Company-admin only, scoped to the admin's own org. Two modes:
 *   • "link" — email the user a secure, 1-hour reset link (same token flow as
 *     the public forgot-password page). The admin never handles a password.
 *   • "set"  — admin sets a new password directly (for users without working
 *     email). Plaintext handoff — logged, min length enforced.
 */
import { db } from "@/db";
import { users, userOrganisations } from "@/db/schema";
import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { sendSystemEmail, renderPasswordResetEmail, getAppUrl } from "@/lib/system-mailer";

const Schema = z.object({
  userId:   z.string().uuid(),
  mode:     z.enum(["link", "set"]),
  password: z.string().min(8).max(200).optional(),
});

export async function POST(req: Request) {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;

  const role = (session?.user as any)?.role;
  if (role !== "company_admin" && role !== "super_admin" && role !== "platform_admin") {
    return bad("Only Company Admins can reset passwords", 403);
  }

  try {
    const data = Schema.parse(await req.json());
    if (data.mode === "set" && !data.password) return bad("A new password is required");

    const [target] = await db
      .select({ id: users.id, orgId: users.orgId, name: users.name, email: users.email, status: users.status })
      .from(users).where(eq(users.id, data.userId)).limit(1);
    if (!target) return bad("User not found", 404);

    // Scope: the target must belong to THIS org (home org or an attached org).
    if (!isSuperAdmin(session) && target.orgId !== orgId) {
      const [membership] = await db.select({ userId: userOrganisations.userId })
        .from(userOrganisations)
        .where(and(eq(userOrganisations.userId, data.userId), eq(userOrganisations.orgId, orgId!)))
        .limit(1);
      if (!membership) return bad("Forbidden", 403);
    }

    const actorId   = (session!.user as any).id;
    const actorName = (session!.user as any).name ?? null;

    if (data.mode === "link") {
      if (target.status !== "Active") return bad("Activate the user before sending a reset link");
      const token  = crypto.randomBytes(32).toString("hex");
      const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await db.update(users).set({ resetToken: token, resetTokenExpiry: expiry }).where(eq(users.id, target.id));
      await sendSystemEmail({
        to:      target.email,
        subject: "Reset your Prime Accountax password",
        html:    renderPasswordResetEmail({ name: target.name, resetUrl: `${getAppUrl()}/reset-password?token=${token}` }),
      });
      await logEvent({ orgId: orgId!, eventType: "user_password_reset", actorId, actorName,
        meta: { targetUserId: target.id, targetEmail: target.email, method: "link" } });
      return ok({ sent: true, email: target.email });
    }

    // mode === "set"
    const passwordHash = await bcrypt.hash(data.password!, 10);
    await db.update(users)
      .set({ passwordHash, resetToken: null, resetTokenExpiry: null })
      .where(eq(users.id, target.id));
    await logEvent({ orgId: orgId!, eventType: "user_password_reset", actorId, actorName,
      meta: { targetUserId: target.id, targetEmail: target.email, method: "set" } });
    return ok({ updated: true, email: target.email });
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error("[org/users/reset-password]", e);
    return bad("Failed to reset password", 500);
  }
}
