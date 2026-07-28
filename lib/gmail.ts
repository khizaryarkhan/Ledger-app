/**
 * Shared Gmail helpers — token refresh, draft creation, and direct send.
 * Used by the mailer router, scheduled cron, and manual email composer.
 */

import { db } from "@/db";
import { gmailTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

export async function getValidGmailToken(orgId: string) {
  const [token] = await db.select().from(gmailTokens).where(eq(gmailTokens.orgId, orgId)).limit(1);
  if (!token) return null;

  // Tokens are encrypted at rest — decrypt for use (legacy plaintext passes through).
  const refreshToken = decryptSecret(token.refreshToken)!;
  const accessToken  = decryptSecret(token.accessToken)!;

  const now      = Date.now();
  const expiresAt = new Date(token.accessTokenExpiresAt).getTime();

  if (expiresAt - now < 5 * 60 * 1000) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     process.env.GMAIL_CLIENT_ID!,
        client_secret: process.env.GMAIL_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type:    "refresh_token",
      }),
    });
    if (!res.ok) return { ...token, accessToken, refreshToken };
    const data = await res.json();
    await db.update(gmailTokens).set({
      accessToken:           encryptSecret(data.access_token)!,
      accessTokenExpiresAt:  new Date(now + (data.expires_in || 3600) * 1000),
      updatedAt:             new Date(),
    }).where(eq(gmailTokens.id, token.id));
    return { ...token, accessToken: data.access_token, refreshToken };
  }

  return { ...token, accessToken, refreshToken };
}

/**
 * Create a Gmail draft (sits in Drafts — user reviews and sends manually).
 * Returns the draft id on success, throws on failure.
 */
export async function createGmailDraft(
  accessToken: string,
  from: string,
  to: string,
  subject: string,
  body: string,
) {
  const raw = Buffer.from(
    [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${encodeHeader(subject)}`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      body,
    ].join("\r\n"),
  )
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: { raw } }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message ?? "Gmail draft creation failed");
  }

  const data = await res.json();
  return data.id as string;
}

/**
 * Send an email directly via Gmail API (not as a draft).
 * Supports plain-text body, CC, BCC, and PDF attachments.
 */
/**
 * RFC 2047 encode a header value that contains non-ASCII characters (e.g. em dash).
 * Without this, Gmail will corrupt special characters in the Subject line.
 */
function encodeHeader(value: string): string {
  if (/[^\x00-\x7F]/.test(value)) {
    return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
  }
  return value;
}

/**
 * Fetch the RFC Message-ID of a sent Gmail message by its internal Gmail ID.
 * Requires the access token used to send — no extra scope beyond gmail.send.
 */
export async function fetchGmailMessageId(accessToken: string, gmailId: string): Promise<string | null> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailId}?format=metadata&metadataHeaders=Message-ID`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return null;
  const data = await res.json();
  const header = (data.payload?.headers || []).find((h: any) => h.name === "Message-ID");
  return header?.value ?? null;
}

export async function sendGmail(
  accessToken: string,
  from: string,
  opts: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
    inReplyTo?: string;
    messageId?: string;
    attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
  },
): Promise<{ gmailId: string }> {
  const boundary = `boundary_${Date.now()}`;
  const hasAttachments = opts.attachments && opts.attachments.length > 0;

  // Bodies are HTML (branded templates). If a caller passes plain text, convert
  // its newlines so it still renders. Sent as text/html so it's never shown raw.
  const looksHtml = /<[a-z!/][\s\S]*>/i.test(opts.body);
  const htmlBody = looksHtml ? opts.body : opts.body.replace(/\n/g, "<br>");

  let rawMessage: string;

  const threadHeaders = [
    ...(opts.messageId  ? [`Message-ID: ${opts.messageId}`]            : []),
    ...(opts.inReplyTo  ? [`In-Reply-To: ${opts.inReplyTo}`]           : []),
    ...(opts.inReplyTo  ? [`References: ${opts.inReplyTo}`]            : []),
  ];

  if (hasAttachments) {
    // Multipart MIME with attachments
    const parts: string[] = [];
    parts.push(
      `--${boundary}`,
      `Content-Type: text/html; charset=utf-8`,
      ``,
      htmlBody,
    );
    for (const att of opts.attachments!) {
      parts.push(
        `--${boundary}`,
        `Content-Type: ${att.contentType}`,
        `Content-Transfer-Encoding: base64`,
        `Content-Disposition: attachment; filename="${att.filename}"`,
        ``,
        att.content.toString("base64"),
      );
    }
    parts.push(`--${boundary}--`);

    const headers = [
      `From: ${from}`,
      `To: ${opts.to}`,
      ...(opts.cc  ? [`Cc: ${opts.cc}`]  : []),
      ...(opts.bcc ? [`Bcc: ${opts.bcc}`] : []),
      ...threadHeaders,
      `Subject: ${encodeHeader(opts.subject)}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      ``,
    ];
    rawMessage = [...headers, ...parts].join("\r\n");
  } else {
    rawMessage = [
      `From: ${from}`,
      `To: ${opts.to}`,
      ...(opts.cc  ? [`Cc: ${opts.cc}`]  : []),
      ...(opts.bcc ? [`Bcc: ${opts.bcc}`] : []),
      ...threadHeaders,
      `Subject: ${encodeHeader(opts.subject)}`,
      `Content-Type: text/html; charset=utf-8`,
      ``,
      htmlBody,
    ].join("\r\n");
  }

  const raw = Buffer.from(rawMessage)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `Gmail send failed (${res.status})`);
  }

  const data = await res.json();
  return { gmailId: data.id as string };
}
