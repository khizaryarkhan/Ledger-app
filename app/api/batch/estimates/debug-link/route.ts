/**
 * GET /api/batch/estimates/debug-link?estimate=1643   (estimate DocNumber)
 *   or ?invoice=INV-123                                 (invoice DocNumber)
 *
 * READ-ONLY diagnostic. Dumps the raw QBO LinkedTxn structure for an estimate
 * and every invoice linked to it (or a single invoice), so we can see exactly
 * how QBO records an estimate→invoice link that shows correctly in the UI, and
 * match our created invoices to it. No writes. Safe to leave in.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { getOrgQboToken } from "@/lib/qbo-token";
import { qboQueryAll } from "@/lib/batch/qbo-client";

export const runtime = "nodejs";

const esc = (s: string) => s.replace(/'/g, "\\'");

// Trim an invoice to the parts that matter for link diagnosis.
function slimInvoice(inv: any) {
  return {
    Id: inv.Id,
    DocNumber: inv.DocNumber,
    TxnDate: inv.TxnDate,
    Customer: inv.CustomerRef,
    txnLevelLinkedTxn: inv.LinkedTxn ?? null,
    lines: (inv.Line || [])
      .filter((l: any) => l.DetailType === "SalesItemLineDetail")
      .map((l: any) => ({
        Id: l.Id,
        Amount: l.Amount,
        Description: l.Description,
        ItemRef: l.SalesItemLineDetail?.ItemRef,
        lineLevelLinkedTxn: l.LinkedTxn ?? null,
      })),
  };
}

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const url = new URL(req.url);
  const estNo = url.searchParams.get("estimate");
  const estId = url.searchParams.get("estimateId");
  const invNo = url.searchParams.get("invoice");

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected", 400);

  // No params → list recent estimates that HAVE at least one linked invoice, so
  // the caller can pick a real one to inspect.
  if (!estNo && !estId && !invNo) {
    const recent = await qboQueryAll(token, "Estimate", "").catch(() => []);
    const withInvoices = recent
      .filter((e: any) => (e.LinkedTxn || []).some((lt: any) => lt.TxnType === "Invoice"))
      .map((e: any) => ({
        estimateId: e.Id,
        DocNumber: e.DocNumber,
        TxnStatus: e.TxnStatus,
        customer: e.CustomerRef?.name,
        linkedInvoiceCount: (e.LinkedTxn || []).filter((lt: any) => lt.TxnType === "Invoice").length,
      }))
      .slice(0, 40);
    return ok({
      hint: "Pick one and call ?estimateId=<estimateId> (or ?estimate=<DocNumber>) to see the link structure.",
      estimatesWithLinkedInvoices: withInvoices,
    });
  }

  if (invNo) {
    const invs = await qboQueryAll(token, "Invoice", `DocNumber = '${esc(invNo)}'`);
    return ok({ invoices: invs.map(slimInvoice) });
  }

  const where = estId ? `Id = '${esc(estId)}'` : `DocNumber = '${esc(estNo!)}'`;
  const ests = await qboQueryAll(token, "Estimate", where);
  if (ests.length === 0) return bad(`No estimate matching ${estId ? `Id ${estId}` : `DocNumber ${estNo}`}`, 404);
  const est = ests[0];

  const linkedInvoiceIds = (est.LinkedTxn || [])
    .filter((lt: any) => lt.TxnType === "Invoice" && lt.TxnId)
    .map((lt: any) => String(lt.TxnId));

  let invoices: any[] = [];
  if (linkedInvoiceIds.length) {
    const inList = linkedInvoiceIds.map((x: string) => `'${x}'`).join(",");
    invoices = await qboQueryAll(token, "Invoice", `Id IN (${inList})`).catch(() => []);
  }

  return ok({
    estimate: {
      Id: est.Id,
      DocNumber: est.DocNumber,
      TxnStatus: est.TxnStatus,
      Customer: est.CustomerRef,
      estimateLevelLinkedTxn: est.LinkedTxn ?? null,
      lines: (est.Line || [])
        .filter((l: any) => l.DetailType === "SalesItemLineDetail")
        .map((l: any) => ({ Id: l.Id, Amount: l.Amount, Description: l.Description, ItemRef: l.SalesItemLineDetail?.ItemRef })),
    },
    linkedInvoices: invoices.map(slimInvoice),
  });
}
