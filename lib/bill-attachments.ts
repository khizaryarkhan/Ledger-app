/**
 * Push a PDF attachment to QBO or Xero for an AP bill.
 * Called after approval so the audit trail lives in the accounting system.
 *
 * Returns a result object describing success/failure per transport so the
 * caller can include it in the API response for diagnostics.
 */

import { getOrgQboToken } from "@/lib/qbo-token";
import { getOrgXeroToken } from "@/lib/xero-token";

const QBO_API = "https://quickbooks.api.intuit.com/v3/company";

export interface AttachmentResult {
  qbo?: { ok: boolean; error?: string };
  xero?: { ok: boolean; error?: string };
}

export async function pushBillApprovalAttachment(
  orgId: string,
  bill: {
    qboId?:      string | null;
    xeroId?:     string | null;
    billNumber?: string | null;
  },
  pdfBuffer: Buffer,
): Promise<AttachmentResult> {
  const filename = `approval-${(bill.billNumber ?? "bill").replace(/[^a-zA-Z0-9-]/g, "_")}.pdf`;
  const result: AttachmentResult = {};

  if (bill.qboId) {
    try {
      const token = await getOrgQboToken(orgId);
      if (!token) throw new Error("No QBO connection for this organisation");
      await pushToQbo(token.accessToken, token.realmId, bill.qboId, filename, pdfBuffer);
      result.qbo = { ok: true };
    } catch (e: any) {
      console.error("[bill-attachments] QBO push failed:", e?.message);
      result.qbo = { ok: false, error: e?.message ?? "Unknown error" };
    }
  }

  if (bill.xeroId) {
    try {
      const token = await getOrgXeroToken(orgId);
      if (!token) throw new Error("No Xero connection for this organisation");
      await pushToXero(token.accessToken, token.tenantId, bill.xeroId, filename, pdfBuffer);
      result.xero = { ok: true };
    } catch (e: any) {
      console.error("[bill-attachments] Xero push failed:", e?.message);
      result.xero = { ok: false, error: e?.message ?? "Unknown error" };
    }
  }

  return result;
}

/**
 * Manually construct the multipart/form-data body for QBO's upload endpoint.
 * We avoid FormData here because Node.js appends filename="blob" to Blob parts
 * that don't have an explicit filename, which breaks QBO's multipart parser.
 */
async function pushToQbo(
  accessToken: string,
  realmId:     string,
  billId:      string,
  filename:    string,
  pdf:         Buffer,
): Promise<void> {
  const boundary = `QBOBoundary${Date.now()}`;

  const metaJson = JSON.stringify({
    AttachableRef: [{ EntityRef: { type: "Bill", value: billId } }],
    FileName:      filename,
    ContentType:   "application/pdf",
  });

  // Build the multipart body as concatenated Buffers for byte-perfect control.
  const enc  = (s: string) => Buffer.from(s, "utf8");
  const CRLF = "\r\n";

  const body = Buffer.concat([
    enc(`--${boundary}${CRLF}`),
    enc(`Content-Disposition: form-data; name="file_metadata_01"${CRLF}`),
    enc(`Content-Type: application/json; charset=UTF-8${CRLF}`),
    enc(CRLF),
    enc(metaJson),
    enc(CRLF),
    enc(`--${boundary}${CRLF}`),
    enc(`Content-Disposition: form-data; name="file_content_01"; filename="${filename}"${CRLF}`),
    enc(`Content-Type: application/pdf${CRLF}`),
    enc(CRLF),
    pdf,
    enc(CRLF),
    enc(`--${boundary}--${CRLF}`),
  ]);

  const res = await fetch(`${QBO_API}/${realmId}/upload?minorversion=65`, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(body.length),
      Accept:          "application/json",
    },
    body: new Uint8Array(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`QBO ${res.status}: ${text.slice(0, 400)}`);
  }
}

async function pushToXero(
  accessToken: string,
  tenantId:    string,
  xeroId:      string,
  filename:    string,
  pdf:         Buffer,
): Promise<void> {
  const res = await fetch(
    `https://api.xero.com/api.xro/2.0/Bills/${xeroId}/Attachments/${encodeURIComponent(filename)}`,
    {
      method:  "POST",
      headers: {
        Authorization:    `Bearer ${accessToken}`,
        "Xero-Tenant-Id": tenantId,
        "Content-Type":   "application/pdf",
        "Content-Length": String(pdf.length),
      },
      body: new Uint8Array(pdf),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Xero ${res.status}: ${text.slice(0, 400)}`);
  }
}
