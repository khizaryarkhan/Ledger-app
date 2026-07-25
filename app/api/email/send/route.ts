/**
 * Unified email send endpoint — used by EmailComposer and any other UI surface.
 *
 * Routes through: Gmail OAuth → Microsoft OAuth → SMTP
 * (whichever transport is configured for the org).
 *
 * POST /api/email/send
 * Body: { to, subject, body, cc?, replyTo?, attachInvoiceIds? }
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { z } from "zod";
import { db } from "@/db";
import { invoices, communications } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { sendEmail } from "@/lib/mailer";
import { getOrgXeroToken } from "@/lib/xero-token";
import { getOrgQboToken } from "@/lib/qbo-token";

const XERO_API = "https://api.xero.com/api.xro/2.0";

// CRLF injection guard — email headers must never contain bare CR or LF
const noCRLF = z.string().regex(/^[^\r\n]*$/, "Value must not contain line breaks");

const Schema = z.object({
  to:                  noCRLF.min(1).max(500),
  subject:             noCRLF.min(1).max(998),  // RFC 5322 max header line length
  body:                z.string().min(1).max(200_000),
  cc:                  noCRLF.max(500).optional(),
  replyTo:             noCRLF.max(500).optional(),
  invoiceId:           z.string().uuid().optional(),
  inReplyToOverride:   z.string().max(998).optional(),
  attachInvoiceIds:    z.array(z.string()).optional(),
  // Client-generated attachments (e.g. the Statement of Open Invoices PDF,
  // built with the same lib the export uses so it's byte-identical). Base64.
  extraAttachments:    z.array(z.object({
    filename:      noCRLF.min(1).max(255),
    contentBase64: z.string().min(1).max(28_000_000), // ~20MB decoded
    contentType:   z.string().max(128).optional(),
  })).max(5).optional(),
});

const QBO_API = "https://quickbooks.api.intuit.com/v3/company";

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  try {
    const data = Schema.parse(await req.json());

    // Fetch PDFs for any requested invoice attachments — all in parallel
    const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
    const attachmentErrors: string[] = [];

    if (data.attachInvoiceIds && data.attachInvoiceIds.length > 0) {
      // 1. Fetch all invoice DB rows in parallel
      const invRows = await Promise.all(
        data.attachInvoiceIds.map(id =>
          db.select().from(invoices)
            .where(and(eq(invoices.id, id), eq(invoices.orgId, orgId!)))
            .limit(1)
            .then(r => r[0] ?? null)
        )
      );

      // 2. Determine which tokens are actually needed, then fetch them in parallel
      const needsXero = invRows.some(inv => inv && inv.xeroId && !inv.xeroId.startsWith("CN-") && !["Paid", "Written Off"].includes(inv.paymentStatus ?? "") && inv.collectionStage !== "Closed");
      const needsQbo  = invRows.some(inv => inv && inv.qboId && !inv.qboId.startsWith("CM-") && !inv.xeroId && !["Paid", "Written Off"].includes(inv.paymentStatus ?? "") && inv.collectionStage !== "Closed");

      const [xeroToken, qboToken] = await Promise.all([
        needsXero ? getOrgXeroToken(orgId!).catch(() => null) : Promise.resolve(null),
        needsQbo  ? getOrgQboToken(orgId!).catch(() => null)  : Promise.resolve(null),
      ]);

      // 3. Fetch all PDFs in parallel
      type PdfResult = { filename: string; content: Buffer; contentType: string } | null;

      const pdfResults = await Promise.allSettled<PdfResult>(
        invRows.map(async inv => {
          if (!inv) return null;

          const isClosedOrPaid =
            ["Paid", "Written Off"].includes(inv.paymentStatus ?? "") ||
            inv.collectionStage === "Closed";

          // ── Xero ────────────────────────────────────────────────────
          if (inv.xeroId && !inv.xeroId.startsWith("CN-")) {
            if (isClosedOrPaid) return null;
            if (!xeroToken) throw new Error("Xero not connected — could not fetch PDF");
            const pdfRes = await fetch(`${XERO_API}/Invoices/${inv.xeroId}`, {
              headers: {
                Authorization:  `Bearer ${xeroToken.accessToken}`,
                "Xero-Tenant-Id": xeroToken.tenantId,
                Accept: "application/pdf",
              },
            });
            if (!pdfRes.ok) {
              const errText = await pdfRes.text();
              console.error(`Xero PDF fetch failed for ${inv.invoiceNumber}: HTTP ${pdfRes.status} — ${errText}`);
              throw new Error(`PDF unavailable for invoice ${inv.invoiceNumber} (Xero error ${pdfRes.status})`);
            }
            const buf = Buffer.from(await pdfRes.arrayBuffer());
            if (!buf.byteLength) throw new Error(`Empty PDF returned for invoice ${inv.invoiceNumber}`);
            return { filename: `Invoice-${inv.invoiceNumber}.pdf`, content: buf, contentType: "application/pdf" };
          }

          // ── QuickBooks ───────────────────────────────────────────────
          if (!inv.qboId || inv.qboId.startsWith("CM-") || isClosedOrPaid) return null;
          if (!qboToken) throw new Error("QuickBooks not connected — could not fetch PDFs");
          const pdfRes = await fetch(
            `${QBO_API}/${qboToken.realmId}/invoice/${inv.qboId}/pdf?minorversion=65`,
            { headers: { Authorization: `Bearer ${qboToken.accessToken}`, Accept: "application/pdf" } },
          );
          if (!pdfRes.ok) {
            const errText = await pdfRes.text();
            console.error(`QBO PDF fetch failed for ${inv.invoiceNumber}: HTTP ${pdfRes.status} — ${errText}`);
            throw new Error(`PDF unavailable for invoice ${inv.invoiceNumber} (QBO error ${pdfRes.status})`);
          }
          const buf = Buffer.from(await pdfRes.arrayBuffer());
          if (!buf.byteLength) throw new Error(`Empty PDF returned for invoice ${inv.invoiceNumber}`);
          return { filename: `Invoice-${inv.invoiceNumber}.pdf`, content: buf, contentType: "application/pdf" };
        })
      );

      for (const r of pdfResults) {
        if (r.status === "fulfilled" && r.value) attachments.push(r.value);
        else if (r.status === "rejected") attachmentErrors.push((r.reason as Error)?.message ?? "PDF fetch failed");
      }
    }

    // Client-provided attachments (statement PDF, etc.).
    if (data.extraAttachments?.length) {
      for (const a of data.extraAttachments) {
        const content = Buffer.from(a.contentBase64, "base64");
        if (content.byteLength) attachments.push({ filename: a.filename, content, contentType: a.contentType || "application/pdf" });
      }
    }

    // Guard total attachment size (most providers reject > ~25MB).
    const totalBytes = attachments.reduce((s, a) => s + a.content.byteLength, 0);
    if (totalBytes > 24 * 1024 * 1024) return bad("Attachments exceed 24MB — reduce the selection or send without invoice PDFs");

    // Determine In-Reply-To: explicit override (user clicked Reply on a specific message)
    // takes precedence over the automatic last-outbound lookup.
    let inReplyTo: string | undefined = data.inReplyToOverride;
    if (!inReplyTo && data.invoiceId) {
      const [prev] = await db
        .select({ messageId: communications.messageId })
        .from(communications)
        .where(and(
          eq(communications.orgId, orgId!),
          eq(communications.invoiceId, data.invoiceId),
          eq(communications.direction, "Outbound"),
          eq(communications.channel, "Email"),
        ))
        .orderBy(desc(communications.sentAt))
        .limit(1);
      if (prev?.messageId) inReplyTo = prev.messageId;
    }

    // Send via whichever transport is configured (Gmail → Microsoft → SMTP)
    const result = await sendEmail(orgId!, {
      to:          data.to,
      subject:     data.subject,
      body:        data.body,
      cc:          data.cc,
      replyTo:     data.replyTo,
      inReplyTo,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    return ok({
      sent:             true,
      transport:        result.transport,
      from:             result.from,
      messageId:        result.messageId,
      attachments:      attachments.map(a => a.filename),
      attachmentErrors,
    });
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error("Email send error:", e);
    return bad(e.message || "Failed to send email", 500);
  }
}
