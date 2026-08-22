import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, userOrganisations, reps } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { verifyMobileToken, signAccessToken, signRefreshToken } from "@/lib/mobile-auth";
import { logEvent } from "@/lib/audit";

// Step 2 of mobile login for users with more than one organisation. Exchanges
// the short-lived preAuthToken from /login plus a chosen orgId for a real
// access/refresh pair, after re-validating membership against the DB (never
// trusts the org list the client was shown at login).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.preAuthToken || !body?.orgId) {
    return NextResponse.json({ error: "preAuthToken and orgId are required" }, { status: 400 });
  }

  const claims = await verifyMobileToken(body.preAuthToken, "mobile_preauth");
  if (!claims) return NextResponse.json({ error: "Login session expired, please sign in again" }, { status: 401 });

  const [user] = await db.select().from(users).where(eq(users.id, claims.sub)).limit(1);
  if (!user || user.status !== "Active") {
    return NextResponse.json({ error: "Account is inactive" }, { status: 403 });
  }

  const isSuperAdmin = user.role === "super_admin";
  let role: string = user.role;
  if (!isSuperAdmin) {
    const [membership] = await db.select({ role: userOrganisations.role })
      .from(userOrganisations)
      .where(and(eq(userOrganisations.userId, user.id), eq(userOrganisations.orgId, body.orgId)))
      .limit(1);
    if (!membership) return NextResponse.json({ error: "You do not have access to that organisation" }, { status: 403 });
    role = membership.role;
  }

  let repId: string | null = null;
  if (user.repId) {
    const [rep] = await db.select({ id: reps.id }).from(reps)
      .where(and(eq(reps.id, user.repId), eq(reps.orgId, body.orgId))).limit(1);
    if (rep) repId = rep.id;
  }

  const tokenClaims = { sub: user.id, role, orgId: body.orgId as string, repId, email: user.email };
  const [accessToken, refreshToken] = await Promise.all([signAccessToken(tokenClaims), signRefreshToken(tokenClaims)]);

  await logEvent({ orgId: body.orgId, eventType: "user_login", actorId: user.id, actorName: user.email });

  return NextResponse.json({
    accessToken, refreshToken, role, orgId: body.orgId,
    user: { id: user.id, email: user.email, name: user.name },
  });
}
