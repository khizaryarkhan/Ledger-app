import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { userOrganisations, organisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyCredentials } from "@/lib/credentials";
import { signPreAuthToken, signAccessToken, signRefreshToken } from "@/lib/mobile-auth";
import { logEvent } from "@/lib/audit";

// Step 1 of mobile login. Verifies email/password(+MFA) with the exact same
// logic the web app's NextAuth Credentials provider uses (lib/credentials.ts).
// If the user has exactly one organisation, we skip straight to issuing an
// org-scoped access/refresh pair. Otherwise the client must call
// /api/mobile/auth/select-org with the returned preAuthToken.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const user = await verifyCredentials({
    email: body.email,
    password: body.password,
    mfaCode: body.mfaCode,
  });
  if (!user) return NextResponse.json({ error: "Invalid email, password, or authentication code" }, { status: 401 });

  const memberships = await db
    .select({ orgId: userOrganisations.orgId, role: userOrganisations.role, name: organisations.name })
    .from(userOrganisations)
    .innerJoin(organisations, eq(organisations.id, userOrganisations.orgId))
    .where(eq(userOrganisations.userId, user.id));

  const orgs = memberships.map((m) => ({ id: m.orgId, name: m.name }));
  // Super admins aren't required to hold a membership row — fall back to their home org.
  if (orgs.length === 0 && user.role === "super_admin" && user.orgId) {
    const [home] = await db.select({ id: organisations.id, name: organisations.name })
      .from(organisations).where(eq(organisations.id, user.orgId)).limit(1);
    if (home) orgs.push(home);
  }
  if (orgs.length === 0) {
    return NextResponse.json({ error: "You do not have access to any organisation" }, { status: 403 });
  }

  await logEvent({ orgId: orgs[0].id, eventType: "user_login", actorId: user.id, actorName: user.email });

  if (orgs.length === 1) {
    const role = user.role === "super_admin" ? "super_admin" : (memberships[0]?.role ?? user.role);
    const claims = { sub: user.id, role, orgId: orgs[0].id, repId: user.repId, email: user.email };
    const [accessToken, refreshToken] = await Promise.all([signAccessToken(claims), signRefreshToken(claims)]);
    return NextResponse.json({
      accessToken, refreshToken,
      user: { id: user.id, email: user.email, name: user.name },
      org: orgs[0], role,
    });
  }

  const preAuthToken = await signPreAuthToken(user.id);
  return NextResponse.json({
    preAuthToken,
    user: { id: user.id, email: user.email, name: user.name },
    orgs,
  });
}
