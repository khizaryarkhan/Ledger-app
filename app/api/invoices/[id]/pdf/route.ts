import { db } from "@/db";
import { invoices } from "@/db/schema";
import { requireOrg, bad } from "@/lib/api";
import { eq, and } from "drizzle-orm";
import { isInvoiceInScope } from "@/lib/receivables/rep-scope";
import { getOrgQboToken } from "@/lib/qbo-token";
import { getOrgXeroToken } from "@/lib/xero-token";

const QBO_API = "https://quickbooks.api.intuit.com/v3/company";
const XERO_API = "https://api.xero.com/api.xro/2.0";
const PDF_TIMEOUT_MS = 15_000;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  // A rep may only pull PDFs for invoices in their own book — the id alone
  // must not be enough to fetch a document from another rep's customer.
  if (!(await isInvoiceInScope(orgId!, (session?.user as any)?.id ?? null, params.id))) {
    return bad("Invoice not found", 404);
  }

  const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, params.id), eq(invoices.orgId, orgId!))).limit(1);
  if (!inv) return bad("Invoice not found", 404);

  const isXero = !!inv.xeroId && !inv.xeroId.startsWith("CN-");
  const isQbo = !!inv.qboId && !inv.qboId.startsWith("CM-");
  if (!isXero && !isQbo) return bad("No PDF available for this invoice", 400);

  // Abort if the accounting API takes longer than PDF_TIMEOUT_MS
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PDF_TIMEOUT_MS);
  const provider = isXero ? "Xero" : "QuickBooks";

  try {
    let pdfRes: Response;

    if (isXero) {
      // Xero returns the invoice as a PDF when Accept: application/pdf
      const xt = await getOrgXeroToken(orgId!);
      if (!xt) { clearTimeout(timer); return bad("Xero not connected", 400); }
      pdfRes = await fetch(`${XERO_API}/Invoices/${inv.xeroId}`, {
        headers: {
          Authorization: `Bearer ${xt.accessToken}`,
          "Xero-Tenant-Id": xt.tenantId,
          Accept: "application/pdf",
        },
        signal: controller.signal,
      });
    } else {
      const token = await getOrgQboToken(orgId!);
      if (!token) { clearTimeout(timer); return bad("QuickBooks not connected", 400); }
      pdfRes = await fetch(
        `${QBO_API}/${token.realmId}/invoice/${inv.qboId}/pdf?minorversion=65`,
        {
          headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "application/pdf" },
          signal: controller.signal,
        }
      );
    }

    clearTimeout(timer);

    if (!pdfRes.ok) {
      const errText = await pdfRes.text().catch(() => "");
      console.error(`${provider} PDF fetch failed for ${inv.invoiceNumber}: HTTP ${pdfRes.status} — ${errText}`);
      return bad(`PDF unavailable (${provider} returned ${pdfRes.status})`, 502);
    }

    const pdfBuffer = await pdfRes.arrayBuffer();
    if (pdfBuffer.byteLength === 0) return bad(`${provider} returned an empty PDF`, 502);

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Invoice-${inv.invoiceNumber}.pdf"`,
        "Content-Length": pdfBuffer.byteLength.toString(),
        "Cache-Control": "private, max-age=300", // cache 5 min in browser — same PDF won't re-fetch
      },
    });
  } catch (e: any) {
    clearTimeout(timer);
    if (e?.name === "AbortError") {
      console.error(`${provider} PDF timeout for invoice ${inv.invoiceNumber}`);
      return bad(`PDF request timed out — ${provider} did not respond in time. Try again.`, 504);
    }
    console.error(`PDF fetch error for ${inv.invoiceNumber}:`, e);
    return bad(`Failed to fetch PDF from ${provider}`, 500);
  }
}
