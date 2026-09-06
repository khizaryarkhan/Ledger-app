import { NextResponse } from "next/server";
import { requireOrg } from "@/lib/api";
import { signOAuthState } from "@/lib/oauth-state";

// Never cache this route — it must always build a fresh authorize URL.
export const dynamic = "force-dynamic";

/**
 * GET /api/xero
 * Redirects the user to Xero's OAuth2 authorization page.
 * After the user grants access, Xero redirects to /api/xero/callback.
 */
export async function GET() {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;

  // .trim() guards against a stray newline/space pasted into the Vercel env var.
  const clientId = process.env.XERO_CLIENT_ID?.trim();
  const redirectUri = process.env.XERO_REDIRECT_URI?.trim();

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "XERO_CLIENT_ID and XERO_REDIRECT_URI must be set in environment variables" },
      { status: 500 }
    );
  }

  // HMAC-signed state — callback validates it before trusting orgId/userId.
  const userId = (session!.user as any).id;
  const state = signOAuthState(orgId!, userId);

  // This app uses Xero's NEWER GRANULAR accounting scopes. Empirically verified
  // against the authorize endpoint:
  //   accounting.transactions / .read  → REJECTED (invalid_scope) for this app
  //     (a deprecated/broad scope — apps already on granular scopes can't mix
  //     it back in, which is why it was rejected, not a special restriction)
  //   accounting.invoices               → accepted ✓
  //   accounting.contacts               → accepted ✓
  //
  // Confirmed live 2026-09-06 (user-reported Xero 403, traced against Xero's
  // own scopes doc, developer.xero.com/documentation/guides/oauth2/scopes):
  // accounting.invoices ALREADY covers CreditNotes, Quotes and Items — a
  // previous version of this comment wrongly assumed CreditNotes needed its
  // own grant and would "degrade gracefully" without one. It was already
  // working. The two Data Studio Xero entities that genuinely 403 without
  // this fix are Chart of Accounts (needs accounting.settings) and Payments
  // (needs accounting.payments) — both now requested below.
  //
  // IMPORTANT: scopes are additive per Xero's own token model but never
  // retroactive — an org that connected Xero BEFORE this change is still
  // holding a token scoped to the old, narrower set. They must reconnect
  // (Settings → Integrations → Xero → reconnect) to pick up the new scopes;
  // simply redeploying this code does nothing for an already-issued token.
  const scope =
    "openid accounting.invoices accounting.contacts accounting.payments accounting.settings offline_access";

  // Build the query manually with encodeURIComponent so the spaces between scopes
  // become %20. URLSearchParams encodes spaces as "+", which Xero's identity
  // server does NOT decode back to spaces in the scope field → "invalid_scope".
  const query = [
    `response_type=code`,
    `client_id=${encodeURIComponent(clientId)}`,
    `redirect_uri=${encodeURIComponent(redirectUri)}`,
    `scope=${encodeURIComponent(scope)}`,
    `state=${encodeURIComponent(state)}`,
  ].join("&");

  const authorizeUrl = `https://login.xero.com/identity/connect/authorize?${query}`;

  return NextResponse.redirect(authorizeUrl, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
