/**
 * GET /api/google-sheets/connect — start the Google Sheets OAuth consent flow.
 * Navigate here (not fetch) to connect.
 */

import { NextResponse } from "next/server";
import { requireOrg } from "@/lib/api";
import { signOAuthState } from "@/lib/oauth-state";
import { SHEETS_SCOPE } from "@/lib/google-sheets";

export async function GET() {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  const clientId = process.env.GMAIL_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_SHEETS_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "GMAIL_CLIENT_ID and GOOGLE_SHEETS_REDIRECT_URI must be set" }, { status: 500 });
  }
  const userId = (session!.user as any).id;
  const state = signOAuthState(orgId!, userId);
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(SHEETS_SCOPE)}&access_type=offline&prompt=consent&state=${encodeURIComponent(state)}`;
  return NextResponse.redirect(url);
}
