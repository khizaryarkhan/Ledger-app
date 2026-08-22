// Bearer-token auth for the mobile app. The web app authenticates via NextAuth's
// httpOnly session cookie, which a React Native client can't rely on across app
// restarts — so mobile gets its own stateless JWT pair, signed with the SAME
// secret NextAuth already uses (AUTH_SECRET/NEXTAUTH_SECRET), verified in
// lib/api.ts as a fallback when no cookie session is present.
//
// Two token types:
//  - "mobile_preauth": issued right after password+MFA verification, before an
//    org is chosen. Short-lived, carries only the user id.
//  - "mobile_access" / "mobile_refresh": issued once an org is selected. Both
//    carry {sub, role, orgId, repId, email}; requireOrg() re-validates all of
//    that against the DB on every request exactly like it does for cookie
//    sessions, so a stale/forged claim can't grant access on its own.
//
// No server-side revocation list — same trust model as the existing JWT
// session strategy. Access tokens are short-lived so a leaked one has a small
// blast radius; refresh tokens are longer-lived but re-validated (status,
// membership) on every use in /api/mobile/auth/refresh.

import { SignJWT, jwtVerify } from "jose";

const ACCESS_TOKEN_TTL = 60 * 60;          // 1 hour
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60; // 30 days
const PREAUTH_TOKEN_TTL = 10 * 60;         // 10 minutes

function secretKey() {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not configured");
  return new TextEncoder().encode(secret);
}

export type MobileAccessClaims = {
  sub: string;           // user id
  role: string;
  orgId: string;
  repId: string | null;
  email: string;
};

export async function signPreAuthToken(userId: string): Promise<string> {
  return new SignJWT({ typ: "mobile_preauth" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${PREAUTH_TOKEN_TTL}s`)
    .sign(secretKey());
}

export async function signAccessToken(claims: MobileAccessClaims): Promise<string> {
  return new SignJWT({
    typ: "mobile_access",
    role: claims.role,
    orgId: claims.orgId,
    repId: claims.repId,
    email: claims.email,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL}s`)
    .sign(secretKey());
}

export async function signRefreshToken(claims: MobileAccessClaims): Promise<string> {
  return new SignJWT({
    typ: "mobile_refresh",
    orgId: claims.orgId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${REFRESH_TOKEN_TTL}s`)
    .sign(secretKey());
}

/** Verifies a token and checks its `typ` claim. Never throws — returns null on any failure. */
export async function verifyMobileToken<T extends Record<string, unknown> = Record<string, unknown>>(
  token: string,
  expectedTyp: "mobile_preauth" | "mobile_access" | "mobile_refresh",
): Promise<(T & { sub: string }) | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (payload.typ !== expectedTyp || !payload.sub) return null;
    return payload as unknown as T & { sub: string };
  } catch {
    return null;
  }
}

export function bearerTokenFrom(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return match ? match[1] : null;
}
