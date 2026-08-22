// Shared email+password(+MFA) verification, used by both the NextAuth
// Credentials provider (web, cookie session) and the mobile login route
// (bearer token session). Keeping this in one place means both auth paths
// enforce identical rate-limiting, MFA, and account-status rules.

import { db } from "@/db";
import { users, userOrganisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { rateLimit } from "@/lib/rate-limit";
import { verifyTotp, consumeRecoveryCode } from "@/lib/mfa";
import { decryptSecret } from "@/lib/crypto";

export type VerifiedUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  orgId: string | null;
  repId: string | null;
};

export async function verifyCredentials(input: {
  email?: string | null;
  password?: string | null;
  mfaCode?: string | null;
}): Promise<VerifiedUser | null> {
  if (!input.email || !input.password) return null;
  const email = String(input.email).toLowerCase().trim();

  // Throttle password attempts per email to blunt online brute-forcing.
  const rl = await rateLimit(`login:${email}`, 10, 900);
  if (!rl.ok) return null;

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || user.status !== "Active") return null;
  const valid = await bcrypt.compare(String(input.password), user.passwordHash);
  if (!valid) return null;

  // Multi-factor gate — only blocks users who have ENROLLED (mfaEnabled).
  if ((user as any).mfaEnabled) {
    const code = input.mfaCode ? String(input.mfaCode) : "";
    if (!code) return null;
    const secret = (user as any).mfaSecret ? decryptSecret((user as any).mfaSecret) : null;
    const totpOk = secret ? verifyTotp(code, secret) : false;
    if (!totpOk) {
      const remaining = await consumeRecoveryCode(code, ((user as any).mfaRecoveryCodes as string[]) ?? []);
      if (!remaining) return null; // bad code → deny
      await db.update(users).set({ mfaRecoveryCodes: remaining }).where(eq(users.id, user.id));
    }
  }

  // Block login if the user has no organisation access. Super admin is exempt.
  if (user.role !== "super_admin") {
    const memberships = await db
      .select({ id: userOrganisations.id })
      .from(userOrganisations)
      .where(eq(userOrganisations.userId, user.id))
      .limit(1);
    if (memberships.length === 0) {
      await db.update(users).set({ status: "Inactive" }).where(eq(users.id, user.id));
      return null;
    }
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    orgId: user.orgId,
    repId: (user as any).repId ?? null,
  };
}
