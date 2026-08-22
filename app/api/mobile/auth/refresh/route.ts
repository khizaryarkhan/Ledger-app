import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, userOrganisations, reps } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { verifyMobileToken, signAccessToken, signRefreshToken } from "@/lib/mobile-auth";

// Exchanges a refresh token for a new access/refresh pair, re-validating the
// user's status and org membership on every call (a deactivated user or one
// removed from the org loses access immediately, regardless of token age).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.refreshToken) return NextResponse.json({ error: "refreshToken is required" }, { status: 400 });

  const claims = await verifyMobileToken<{ orgId: string }>(body.refreshToken, "mobile_refresh");
  if (!claims) return NextResponse.json({ error: "Session expired, please sign in again" }, { status: 401 });

  const [user] = await db.select().from(users).where(eq(users.id, claims.sub)).limit(1);
  if (!user || user.status !== "Active") {
    return NextResponse.json({ error: "Account is inactive" }, { status: 403 });
  }

  const isSuperAdmin = user.role === "super_admin";
  let role: string = user.role;
  if (!isSuperAdmin) {
    const [membership] = await db.select({ role: userOrganisations.role })
      .from(userOrganisations)
      .where(and(eq(userOrganisations.userId, user.id), eq(userOrganisations.orgId, claims.orgId)))
      .limit(1);
    if (!membership) return NextResponse.json({ error: "You no longer have access to that organisation" }, { status: 403 });
    role = membership.role;
  }

  let repId: string | null = null;
  if (user.repId) {
    const [rep] = await db.select({ id: reps.id }).from(reps)
      .where(and(eq(reps.id, user.repId), eq(reps.orgId, claims.orgId))).limit(1);
    if (rep) repId = rep.id;
  }

  const tokenClaims = { sub: user.id, role, orgId: claims.orgId, repId, email: user.email };
  const [accessToken, refreshToken] = await Promise.all([signAccessToken(tokenClaims), signRefreshToken(tokenClaims)]);
  return NextResponse.json({ accessToken, refreshToken });
}
