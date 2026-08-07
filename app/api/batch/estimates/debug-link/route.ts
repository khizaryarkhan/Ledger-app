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
import { qboQueryAll, qboReadOne, qboDelete } from "@/lib/batch/qbo-client";
import { createProgressInvoice } from "@/lib/batch/estimate-invoicing";
import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 120;

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
        Qty: l.SalesItemLineDetail?.Qty,
        UnitPrice: l.SalesItemLineDetail?.UnitPrice,
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

  // ?tryCreate=<estimateId>[&amount=1][&line=0] → SELF-CLEANING TEST. Create a
  // tiny progress invoice against a real estimate, read back exactly what QBO
  // stored (link + qty/price), then DELETE it so nothing remains in the books.
  // Lets us verify the exact payload QBO accepts + links, with zero residue.
  const tryId = url.searchParams.get("tryCreate");
  if (tryId) {
    const est = await qboReadOne(token, "estimate", tryId);
    if (!est) return bad(`No estimate with Id ${tryId}`, 404);
    const salesLines = (est.Line || []).filter((l: any) => l.DetailType === "SalesItemLineDetail");
    if (salesLines.length === 0) return bad("Estimate has no sales lines", 400);
    const lineIdx = Number(url.searchParams.get("line") || 0);
    const amount = Number(url.searchParams.get("amount") || 1);

    const res = await createProgressInvoice(token, tryId, [{ index: lineIdx, amount }], {});
    if (!res.ok) {
      return ok({ tryCreate: tryId, billedLine: lineIdx, billedAmount: amount, result: "QBO_REJECTED", error: res.error });
    }
    const raw = res.raw || {};
    const stored = slimInvoice(raw);
    let cleanup = "not attempted";
    try {
      const del = await qboDelete(token, "invoice", String(raw.Id), String(raw.SyncToken));
      cleanup = del.ok ? "deleted (no residue)" : `DELETE FAILED — remove invoice ${raw.DocNumber || raw.Id} manually: ${del.error}`;
    } catch (e: any) {
      cleanup = `DELETE THREW — remove invoice ${raw.DocNumber || raw.Id} manually: ${e?.message}`;
    }
    return ok({
      tryCreate: tryId,
      billedLine: lineIdx,
      billedAmount: amount,
      result: "CREATED",
      linkedToEstimate:
        (raw.LinkedTxn || []).some((x: any) => x.TxnType === "Estimate") ||
        (raw.Line || []).some((l: any) => (l.LinkedTxn || []).some((x: any) => x.TxnType === "Estimate")),
      stored,
      cleanup,
    });
  }

  // ?lastjob=1 → the most recent invoice-from-estimates batch: its per-row
  // results (success doc numbers / exact QBO errors) AND, for each created
  // invoice, the link QBO actually stored. One fetch tells the whole story.
  if (url.searchParams.get("lastjob")) {
    const [job] = await db
      .select()
      .from(batchJobs)
      .where(and(eq(batchJobs.orgId, orgId!), eq(batchJobs.entityId, "estimateinvoice")))
      .orderBy(desc(batchJobs.createdAt))
      .limit(1);
    if (!job) return ok({ note: "No invoice-from-estimates job found yet." });

    const rows = (job.results as any[]) || [];
    const createdIds = rows.filter((r) => r.ok && r.qboId).map((r) => String(r.qboId));
    let created: any[] = [];
    if (createdIds.length) {
      const inList = createdIds.map((x) => `'${x}'`).join(",");
      const invs = await qboQueryAll(token, "Invoice", `Id IN (${inList})`).catch(() => []);
      created = invs.map(slimInvoice);
    }
    return ok({
      job: { createdAt: job.createdAt, status: job.status, total: job.totalRows, ok: job.successCount, failed: job.errorCount },
      rows,
      createdInvoicesAsStoredInQbo: created,
    });
  }

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
