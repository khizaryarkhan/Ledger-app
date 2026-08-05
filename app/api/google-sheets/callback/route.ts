import { NextResponse } from "next/server";
import { db } from "@/db";
import { googleSheetsTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyOAuthState } from "@/lib/oauth-state";
import { encryptSecret } from "@/lib/crypto";
import { logEvent } from "@/lib/audit";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const base = process.env.AUTH_URL || "https://ledger-app-alpha-roan.vercel.app";
  const back = (q: string) => NextResponse.redirect(new URL(`/batch/scheduled?sheets=${q}`, base));

  const verified = verifyOAuthState(searchParams.get("state"));
  if (!verified) return back("error");
  const { orgId, userId } = verified;
  if (!code) return back("error");

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GMAIL_CLIENT_ID!,
        client_secret: process.env.GMAIL_CLIENT_SECRET!,
        redirect_uri: process.env.GOOGLE_SHEETS_REDIRECT_URI!,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) { console.error("Sheets token exchange failed:", await tokenRes.text()); return back("error"); }
    const { access_token, refresh_token, expires_in } = await tokenRes.json();

    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${access_token}` } });
    const email = (await userRes.json().catch(() => ({})))?.email || "";
    const accessTokenExpiresAt = new Date(Date.now() + (expires_in || 3600) * 1000);

    const [existing] = await db.select().from(googleSheetsTokens).where(eq(googleSheetsTokens.orgId, orgId)).limit(1);
    if (existing) {
      await db.update(googleSheetsTokens).set({
        orgId, userId, email,
        accessToken: encryptSecret(access_token)!,
        refreshToken: refresh_token ? encryptSecret(refresh_token)! : existing.refreshToken,
        accessTokenExpiresAt, updatedAt: new Date(),
      }).where(eq(googleSheetsTokens.id, existing.id));
    } else {
      await db.insert(googleSheetsTokens).values({
        orgId, userId, email,
        accessToken: encryptSecret(access_token)!,
        refreshToken: encryptSecret(refresh_token)!, accessTokenExpiresAt,
      });
    }

    await logEvent({ orgId, eventType: "integration_connected", actorId: userId, meta: { provider: "Google Sheets", email } });
    return back("connected");
  } catch (e: any) {
    console.error("Sheets callback error:", e);
    return back("error");
  }
}
