/**
 * POST /api/admin/organisations/[id]/resend-welcome
 * Re-send the welcome email to an organisation's admin (or a specific address
 * via body { email }). We never store the plaintext password, so the resend
 * carries a fresh 24h "set your password" link instead of credentials.
 */
import { db } from "@/db";
import { organisations, users, userOrganisations } from "@/db/schema";
import { ok, bad } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/billing";
import { sendSystemEmail, renderWelcomeEmail, getAppUrl } from "@/lib/system-mailer";
import { and, eq } from "drizzle-orm";
import { randomBytes } from "crypto";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error } = await requireSuperAdmin();
  if (error) return error;

  const [org] = await db.select().from(organisations).where(eq(organisations.id, params.id)).limit(1);
  if (!org) return bad("Organisation not found", 404);

  const body = await req.json().catch(() => ({}));
  const explicitEmail: string | undefined = body?.email ? String(body.email).toLowerCase().trim() : undefined;

  // Target: the given email, else the org's admin, else any user in the org.
  let user: { id: string; name: string; email: string } | undefined;
  if (explicitEmail) {
    [user] = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.email, explicitEmail)).limit(1);
  } else {
    const admins = await db.select({ id: users.id, name: users.name, email: users.email })
      .from(userOrganisations).innerJoin(users, eq(users.id, userOrganisations.userId))
      .where(and(eq(userOrganisations.orgId, org.id), eq(userOrganisations.role, "company_admin")));
    user = admins[0];
    if (!user) [user] = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.orgId, org.id)).limit(1);
  }
  if (!user) return bad("No user found for this organisation", 404);

  // Fresh set-password link (24h) so they can get in even if the first mail was lost.
  const token = randomBytes(32).toString("hex");
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.update(users).set({ resetToken: token, resetTokenExpiry: expiry }).where(eq(users.id, user.id));

  try {
    await sendSystemEmail({
      to: user.email,
      subject: `Welcome to ${org.name} — your account is ready`,
      html: renderWelcomeEmail({
        name: user.name, orgName: org.name, email: user.email,
        resetUrl: `${getAppUrl()}/reset-password?token=${token}`,
        loginUrl: `${getAppUrl()}/login`,
      }),
    });
  } catch (e: any) {
    return bad(`Email failed to send: ${e?.message || e}`, 502);
  }
  return ok({ sent: true, to: user.email });
}
