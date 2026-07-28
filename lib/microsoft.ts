/**
 * Shared Microsoft / Outlook helpers — token refresh and send via Graph API.
 * Mirrors the Gmail helper pattern (lib/gmail.ts).
 *
 * OAuth app registration required in Azure AD:
 *   - Redirect URI: MICROSOFT_REDIRECT_URI
 *   - Scopes: Mail.Send, User.Read, offline_access
 *   - Account type: Accounts in any organizational directory and personal Microsoft accounts
 *
 * Environment variables:
 *   MICROSOFT_CLIENT_ID
 *   MICROSOFT_CLIENT_SECRET
 *   MICROSOFT_REDIRECT_URI
 */

import { db } from "@/db";
import { microsoftTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

export async function getValidMicrosoftToken(orgId: string) {
  const [token] = await db
    .select()
    .from(microsoftTokens)
    .where(eq(microsoftTokens.orgId, orgId))
    .limit(1);
  if (!token) return null;

  // Tokens are encrypted at rest — decrypt for use (legacy plaintext passes through).
  const refreshToken = decryptSecret(token.refreshToken)!;
  const accessToken  = decryptSecret(token.accessToken)!;

  const now = Date.now();
  const expiresAt = new Date(token.accessTokenExpiresAt).getTime();

  // Refresh if within 5 minutes of expiry
  if (expiresAt - now < 5 * 60 * 1000) {
    const res = await fetch(
      `https://login.microsoftonline.com/common/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id:     process.env.MICROSOFT_CLIENT_ID!,
          client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
          refresh_token: refreshToken,
          grant_type:    "refresh_token",
          scope:         "https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read offline_access",
        }),
      }
    );
    if (!res.ok) {
      console.error("Microsoft token refresh failed:", await res.text());
      return { ...token, accessToken, refreshToken }; // stale token — surfaces a clear error at send
    }
    const data = await res.json();
    await db
      .update(microsoftTokens)
      .set({
        accessToken:          encryptSecret(data.access_token)!,
        refreshToken:         data.refresh_token ? encryptSecret(data.refresh_token)! : token.refreshToken,
        accessTokenExpiresAt: new Date(now + (data.expires_in || 3600) * 1000),
        updatedAt:            new Date(),
      })
      .where(eq(microsoftTokens.id, token.id));
    return { ...token, accessToken: data.access_token, refreshToken };
  }

  return { ...token, accessToken, refreshToken };
}

/**
 * Send an email via Microsoft Graph API.
 * Supports plain-text body, CC, BCC, PDF attachments, and email threading.
 * messageId / inReplyTo are injected via internetMessageHeaders so Microsoft
 * preserves our self-generated RFC 5322 Message-ID for thread continuity.
 */
export async function sendMicrosoft(
  accessToken: string,
  opts: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
    inReplyTo?: string;
    messageId?: string;
    attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
  }
) {
  // Parse comma-separated recipients into Graph API format
  const parseRecipients = (addr: string) =>
    addr.split(",").map(e => ({ emailAddress: { address: e.trim() } })).filter(r => r.emailAddress.address);

  // Bodies are HTML (branded templates). Convert plain-text newlines if a
  // caller passes plain text, and send as HTML so it's never shown raw.
  const looksHtml = /<[a-z!/][\s\S]*>/i.test(opts.body);
  const htmlBody = looksHtml ? opts.body : opts.body.replace(/\n/g, "<br>");

  const internetMessageHeaders: Array<{ name: string; value: string }> = [];
  if (opts.messageId)  internetMessageHeaders.push({ name: "Message-ID",  value: opts.messageId });
  if (opts.inReplyTo)  internetMessageHeaders.push({ name: "In-Reply-To", value: opts.inReplyTo });
  if (opts.inReplyTo)  internetMessageHeaders.push({ name: "References",  value: opts.inReplyTo });

  const message: Record<string, any> = {
    subject: opts.subject,
    body: {
      contentType: "HTML",
      content: htmlBody,
    },
    toRecipients: parseRecipients(opts.to),
    ...(opts.cc  ? { ccRecipients:  parseRecipients(opts.cc)  } : {}),
    ...(opts.bcc ? { bccRecipients: parseRecipients(opts.bcc) } : {}),
    ...(internetMessageHeaders.length ? { internetMessageHeaders } : {}),
  };

  if (opts.attachments && opts.attachments.length > 0) {
    message.attachments = opts.attachments.map(att => ({
      "@odata.type":  "#microsoft.graph.fileAttachment",
      name:           att.filename,
      contentType:    att.contentType,
      contentBytes:   att.content.toString("base64"),
    }));
  }

  const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.error?.message ?? `Microsoft Graph send failed (${res.status})`;
    throw new Error(msg);
  }
}
