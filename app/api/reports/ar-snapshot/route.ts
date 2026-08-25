/**
 * AR Snapshot — provider-agnostic open receivables as of a date.
 *
 * GET /api/reports/ar-snapshot?asOf=YYYY-MM-DD[&source=qbo|local]
 *
 * Returns rows shaped like the invoices table. Every downstream consumer
 * (Dashboard KPIs + all AR aging reports) buckets these rows by dueDate, so
 * they all reconcile to the same grand total.
 *
 * ── Multi-tenant design ──────────────────────────────────────────────────────
 * This app integrates QuickBooks, Xero AND Sage Intacct. Each provider's sync
 * writes the invoice's *authoritative open balance* straight from that
 * provider's books into a dedicated column:
 *     QBO   → qboBalance         (Invoice.Balance)
 *     Xero  → xeroBalance        (Invoice.AmountDue)
 *     Sage  → sageIntacctBalance (APBILL/ARINVOICE TOTALDUE)
 * …plus the provider's own dueDate and paymentStatus.
 *
 * So for TODAY we compute aging the same way for every tenant: take each open
 * invoice / unapplied credit, use its provider balance as the open amount, and
 * bucket by its dueDate. Because the balance and due date come from the provider
 * itself — and QBO, Xero and Sage all age by due date — this reproduces each
 * provider's aged-receivables report without any provider-specific code or a
 * live API call. One path, all tenants, fast and offline.
 *
 * For HISTORICAL dates the live balance no longer applies (it's "as of now"),
 * so we reconstruct point-in-time:
 *     - QBO connected → QBO's own AgedReceivableDetail (authoritative).
 *     - otherwise     → local event-sourced engine (best effort for Xero/Sage).
 *
 * `source` override (debug / reconciliation):
 *     source=qbo   → force QBO's native report regardless of date
 *     source=local → force the local event-sourced engine
 */

import { db } from "@/db";
import { invoices, qboTokens } from "@/db/schema";
import { requireReadScope, ok, bad } from "@/lib/api";
import { eq } from "drizzle-orm";
import { computeArAging } from "@/lib/ar-aging";
import type { DetailRow } from "@/lib/ar-aging";
import { fetchQboAging } from "@/lib/qbo-aging-report";

/** Provider-agnostic open balance for a synced invoice/credit row.
 *  Prefers the connected provider's authoritative balance; falls back to
 *  total − paid for local-only rows. CMs/credits carry a negative balance. */
function openBalanceOf(inv: {
  qboBalance: number | null;
  xeroBalance: number | null;
  sageIntacctBalance: number | null;
  total: number;
  paid: number;
}): number {
  if (inv.qboBalance != null) return inv.qboBalance;
  if (inv.xeroBalance != null) return inv.xeroBalance;
  if (inv.sageIntacctBalance != null) return inv.sageIntacctBalance;
  return Math.max(0, Number(inv.total || 0) - Number(inv.paid || 0));
}

/** Map a QBO-native aging detail row to our invoice-table row shape.
 *  dueDate is reconstructed from QBO's own aging (asOf − daysPastDue) so the
 *  downstream dueDate bucketing reproduces QBO's buckets exactly. */
function qboRowToInvoiceShape(d: DetailRow, asOf: string) {
  const isCredit = d.txnType === "Credit Memo" || d.openBalance < 0;
  const due = new Date(asOf + "T00:00:00Z");
  due.setUTCDate(due.getUTCDate() - (Number.isFinite(d.daysPastDue) ? d.daysPastDue : 0));
  return {
    id:              d.txnId,
    customerId:      d.customerId,
    projectId:       d.projectId ?? null,
    invoiceNumber:   d.txnNumber,
    invoiceDate:     d.txnDate,
    dueDate:         due.toISOString().slice(0, 10),
    currency:        d.currency,
    total:           d.openBalance,
    paid:            0,
    qboBalance:      d.openBalance,
    paymentStatus:   "Unpaid",
    collectionStage: "New",
    paidAt:          null,
    qboId:           d.qboId,
    txnType:         isCredit ? "CreditMemo" : "Invoice",
    amount:          d.openBalance,
    taxAmount:       0,
    paymentTerms:    30,
  };
}

export async function GET(req: Request) {
  // Group mode → aggregate the snapshot across every branch; else the single org.
  const { error, orgIds } = await requireReadScope();
  if (error) return error;

  const url = new URL(req.url);
  const asOf = url.searchParams.get("asOf");
  const source = url.searchParams.get("source"); // "qbo" | "local" | null
  if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return bad("asOf=YYYY-MM-DD required");
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const isToday = asOf >= todayStr;

  // Compute per org and concatenate. Rows already carry customer/project ids;
  // in consolidated mode this yields every branch's open items in one array.
  const perOrg = await Promise.all(orgIds.map((id) => snapshotForOrg(id, asOf, source, isToday)));
  return ok(perOrg.flat());
}

/**
 * The AR snapshot for a SINGLE org — the original per-org logic, now callable
 * once per branch. Never throws: a branch whose provider report is unavailable
 * contributes [] rather than failing the whole consolidated request.
 */
async function snapshotForOrg(orgId: string, asOf: string, source: string | null, isToday: boolean): Promise<any[]> {
  try {
    // Explicit overrides (debug / reconciliation).
    if (source === "qbo") {
      const qbo = await fetchQboAging(orgId, asOf);
      return qbo.detail.filter(d => Math.abs(d.openBalance) >= 0.005).map(d => qboRowToInvoiceShape(d, asOf));
    }
    if (source === "local") {
      const local = await computeArAging(orgId, asOf, false);
      return localDetailToRows(local.detail);
    }

    // TODAY: provider-agnostic open balances straight from synced data.
    if (isToday) {
      return await openInvoicesFromSyncedData(orgId, asOf);
    }

    // HISTORICAL: QBO native report, else the local event-sourced engine.
    if (await orgHasQbo(orgId)) {
      try {
        const qbo = await fetchQboAging(orgId, asOf);
        return qbo.detail.filter(d => Math.abs(d.openBalance) >= 0.005).map(d => qboRowToInvoiceShape(d, asOf));
      } catch { /* fall through to local engine */ }
    }
    const local = await computeArAging(orgId, asOf, false);
    return localDetailToRows(local.detail);
  } catch (e) {
    console.error("[ar-snapshot] per-org failed", orgId, e);
    return [];
  }
}

/** Whether this org has a QuickBooks connection (for choosing a historical source). */
async function orgHasQbo(orgId: string): Promise<boolean> {
  const [tok] = await db
    .select({ realmId: qboTokens.realmId })
    .from(qboTokens)
    .where(eq(qboTokens.orgId, orgId))
    .limit(1);
  return !!tok;
}

/**
 * TODAY's open receivables, computed identically for every provider from the
 * synced invoices table. Each row's open amount is the provider's authoritative
 * balance; rows are bucketed downstream by their (provider) dueDate.
 */
async function openInvoicesFromSyncedData(orgId: string, _asOf: string) {
  // NOTE: this is the AS-OF-TODAY path only (the caller gates on isToday). Every
  // invoice with a live open balance is receivable right now regardless of its
  // invoice date, so we must NOT filter by invoiceDate here — a post-dated open
  // invoice (or one whose date sits a day ahead of the UTC `asOf` boundary) is
  // still owed and QBO's current A/R counts it. Filtering it out silently
  // under-counted Total Open AR. Historical as-of dates use a different path.
  const rows = await db.select({
    id:               invoices.id,
    customerId:       invoices.customerId,
    projectId:        invoices.projectId,
    invoiceNumber:    invoices.invoiceNumber,
    invoiceDate:      invoices.invoiceDate,
    dueDate:          invoices.dueDate,
    currency:         invoices.currency,
    amount:           invoices.amount,
    taxAmount:        invoices.taxAmount,
    total:            invoices.total,
    paid:             invoices.paid,
    paymentStatus:    invoices.paymentStatus,
    collectionStage:  invoices.collectionStage,
    promiseDate:      invoices.promiseDate,
    lastFollowupDate: invoices.lastFollowupDate,
    poNumber:         invoices.poNumber,
    notes:            invoices.notes,
    paidAt:           invoices.paidAt,
    txnType:          invoices.txnType,
    qboId:            invoices.qboId,
    qboBalance:          invoices.qboBalance,
    xeroBalance:         invoices.xeroBalance,
    sageIntacctBalance:  invoices.sageIntacctBalance,
  }).from(invoices).where(eq(invoices.orgId, orgId));

  const out: any[] = [];
  for (const inv of rows) {
    // Written-off debt is not receivable.
    if (inv.paymentStatus === "Written Off") continue;

    const openBalance = openBalanceOf(inv);
    // Keep only rows with a live open balance: positive for invoices, negative
    // for unapplied credits. Fully-paid / fully-applied rows fall out here.
    if (Math.abs(openBalance) < 0.005) continue;

    out.push({
      id:               inv.id,
      customerId:       inv.customerId,
      projectId:        inv.projectId,
      invoiceNumber:    inv.invoiceNumber,
      invoiceDate:      inv.invoiceDate,
      dueDate:          inv.dueDate,
      currency:         inv.currency,
      amount:           inv.amount,
      taxAmount:        inv.taxAmount,
      total:            inv.total,
      paid:             inv.paid,
      // Unified open balance lives on qboBalance so the existing downstream
      // helpers (openBal / invBuckets, which read qboBalance) work unchanged.
      qboBalance:       openBalance,
      paymentStatus:    inv.paymentStatus,
      collectionStage:  inv.collectionStage,
      promiseDate:      inv.promiseDate,
      lastFollowupDate: inv.lastFollowupDate,
      poNumber:         inv.poNumber,
      notes:            inv.notes,
      paidAt:           inv.paidAt,
      qboId:            inv.qboId,
      txnType:          inv.txnType === "CreditMemo" ? "CreditMemo" : "Invoice",
      paymentTerms:     30,
    });
  }
  return out;
}

/** Map local event-sourced engine detail rows to our invoice row shape.
 *  No synthetic unapplied-payment / deposit-credit injection — those do not
 *  appear on a provider's aged-receivables report and previously distorted the
 *  Current bucket. */
function localDetailToRows(detail: DetailRow[]) {
  return detail
    .filter(d => Math.abs(d.openBalance) >= 0.005)
    .map((d) => {
      const isCredit = d.txnType === "Credit Memo" || d.openBalance < 0;
      return {
        id:              d.txnId,
        customerId:      d.customerId,
        projectId:       d.projectId ?? null,
        invoiceNumber:   d.txnNumber,
        invoiceDate:     d.txnDate,
        dueDate:         d.dueDate,
        currency:        d.currency,
        total:           d.openBalance,
        paid:            0,
        qboBalance:      d.openBalance,
        paymentStatus:   "Unpaid",
        collectionStage: "New",
        paidAt:          null,
        qboId:           d.qboId,
        txnType:         isCredit ? "CreditMemo" : "Invoice",
        amount:          d.openBalance,
        taxAmount:       0,
        paymentTerms:    30,
      };
    });
}
