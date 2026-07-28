/**
 * Push a PDF attachment to QBO or Xero for an AP bill.
 * Called after approval so the audit trail lives in the accounting system.
 *
 * Failures are logged but never rethrown — the caller (approve route) must
 * not fail because of an attachment push error.
 */

import { getOrgQboToken } from "@/lib/qbo-token";
import { getOrgXeroToken } from "@/lib/xero-token";

const QBO_API = "https://quickbooks.api.intuit.com/v3/company";

export async function pushBillApprovalAttachment(
  orgId: string,
  bill: {
    qboId?:      string | null;
    xeroId?:     string | null;
    source?:     string | null;
    billNumber?: string | null;
  },
  pdfBuffer: Buffer,
): Promise<void> {
  const filename = `approval-${(bill.billNumber ?? "bill").replace(/[^a-zA-Z0-9-]/g, "_")}.pdf`;

  // Push to whichever accounting system the bill came from — determined by
  // which external ID is populated, not the source field (which can be null).
  if (bill.qboId) {
    const token = await getOrgQboToken(orgId).catch(() => null);
    if (token) {
      await pushToQbo(token.accessToken, token.realmId, bill.qboId, filename, pdfBuffer).catch(e =>
        console.error("[bill-attachments] QBO push failed:", e?.message),
      );
    } else {
      console.warn("[bill-attachments] No QBO token for org", orgId);
    }
  }

  if (bill.xeroId) {
    const token = await getOrgXeroToken(orgId).catch(() => null);
    if (token) {
      await pushToXero(token.accessToken, token.tenantId, bill.xeroId, filename, pdfBuffer).catch(e =>
        console.error("[bill-attachments] Xero push failed:", e?.message),
      );
    } else {
      console.warn("[bill-attachments] No Xero token for org", orgId);
    }
  }
}

async function pushToQbo(
  accessToken: string,
  realmId:     string,
  billId:      string,
  filename:    string,
  pdf:         Buffer,
): Promise<void> {
  const form = new FormData();

  const metaJson = JSON.stringify({
    AttachableRef: [{ EntityRef: { type: "Bill", value: billId } }],
    FileName:      filename,
    ContentType:   "application/pdf",
  });
  form.append("file_metadata_01", new Blob([metaJson], { type: "application/json" }));
  form.append(
    "file_content_01",
    new Blob([new Uint8Array(pdf)], { type: "application/pdf" }),
    filename,
  );

  const res = await fetch(`${QBO_API}/${realmId}/upload?minorversion=65`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept:        "application/json",
    },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`QBO upload ${res.status}: ${body.slice(0, 200)}`);
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
    const body = await res.text().catch(() => "");
    throw new Error(`Xero upload ${res.status}: ${body.slice(0, 200)}`);
  }
}
