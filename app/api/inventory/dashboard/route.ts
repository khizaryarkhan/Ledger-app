/**
 * GET /api/inventory/dashboard
 *
 * One aggregated snapshot for the Supply Chain workspace home page — same
 * role as /api/payables/dashboard and /api/reports/executive-overview, but
 * for procurement/fulfilment/inventory/manufacturing. Every figure here is
 * summed from the same tables the dedicated reports already read
 * (procurement-reports, sales-reports, inventory/reports, jobwork-reports,
 * alerts) — this route doesn't compute anything new, it just rolls those
 * per-document/per-item lists up into org-wide totals for one dashboard call.
 */

import { db } from "@/db";
import {
  apItems, tradeDocuments, tradeDocumentLines, goodsReceipts, salesShipments,
  accounts, journalEntries, journalLines, transactionLinks,
  jobWorkOrders, manufacturingOrders, supplyChainAlerts, organisations,
} from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq, inArray, isNull, isNotNull } from "drizzle-orm";
import { kindOf } from "@/lib/inventory/item-kinds";

const num = (v: any) => Number(v ?? 0);
const r2 = (n: number) => Math.round((n || 0) * 100) / 100;

/** Remaining (ordered - received/shipped) value per document + per item, for a PO or SO. */
function remainingByDoc(lines: (typeof tradeDocumentLines.$inferSelect)[]) {
  const byDoc = new Map<string, number>();
  const byItem = new Map<string, number>();
  for (const l of lines) {
    const ordered = num(l.orderedBaseQty) || num(l.qty) * num(l.unitsPerOrderUnit || 1);
    const received = num(l.receivedQty);
    const remainingQty = ordered - received;
    if (remainingQty <= 0.0001) continue;
    const perBase = num(l.unitsPerOrderUnit || 1) > 0 ? num(l.rate) / num(l.unitsPerOrderUnit || 1) : num(l.rate);
    byDoc.set(l.documentId, (byDoc.get(l.documentId) ?? 0) + remainingQty * perBase);
    if (l.itemId) byItem.set(l.itemId, (byItem.get(l.itemId) ?? 0) + remainingQty);
  }
  return { byDoc, byItem };
}

/** Open balance of posted Bill/Invoice journal entries, net of transaction_links settlements. */
async function openLedgerDocs(orgId: string, sourceType: "Bill" | "Invoice", acctType: "Accounts Payable" | "Accounts Receivable") {
  const amtCol = sourceType === "Bill" ? journalLines.credit : journalLines.debit;
  const rows = await db.select({ id: journalEntries.id, dueDate: journalEntries.dueDate, total: amtCol })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalLines.orgId, orgId), eq(journalEntries.sourceType, sourceType), eq(journalEntries.status, "Posted"), eq(accounts.type, acctType)));
  const ids = rows.map(r => r.id);
  const applied = ids.length
    ? await db.select({ toId: transactionLinks.toId, amt: transactionLinks.amount }).from(transactionLinks)
        .where(and(eq(transactionLinks.orgId, orgId), inArray(transactionLinks.toId, ids), inArray(transactionLinks.relation, ["payment", "credit"])))
    : [];
  const paidById = new Map<string, number>();
  for (const a of applied) paidById.set(a.toId, (paidById.get(a.toId) ?? 0) + num(a.amt));
  const today = new Date().toISOString().slice(0, 10);
  let total = 0, overdueCount = 0;
  for (const r of rows) {
    const open = num(r.total) - (paidById.get(r.id) ?? 0);
    if (open <= 0.005) continue;
    total += open;
    if (r.dueDate && r.dueDate < today) overdueCount++;
  }
  return { total: r2(total), overdueCount };
}

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);

  const [org, pos, sos, receipts, shipments, items, openJobWork, closedJobWork, moRows, alerts] = await Promise.all([
    db.select({ currency: organisations.currency }).from(organisations).where(eq(organisations.id, orgId!)).limit(1).then(r => r[0]),
    db.select().from(tradeDocuments).where(and(eq(tradeDocuments.orgId, orgId!), eq(tradeDocuments.kind, "PurchaseOrder"))),
    db.select().from(tradeDocuments).where(and(eq(tradeDocuments.orgId, orgId!), eq(tradeDocuments.kind, "SalesOrder"))),
    db.select().from(goodsReceipts).where(and(eq(goodsReceipts.orgId, orgId!), eq(goodsReceipts.status, "Posted"))),
    db.select().from(salesShipments).where(and(eq(salesShipments.orgId, orgId!), eq(salesShipments.status, "Posted"))),
    db.select().from(apItems).where(eq(apItems.orgId, orgId!)),
    db.select().from(jobWorkOrders).where(and(eq(jobWorkOrders.orgId, orgId!), isNull(jobWorkOrders.closedAt))),
    db.select().from(jobWorkOrders).where(and(eq(jobWorkOrders.orgId, orgId!), eq(jobWorkOrders.status, "Closed"), isNotNull(jobWorkOrders.closedAt))),
    db.select().from(manufacturingOrders).where(eq(manufacturingOrders.orgId, orgId!)),
    db.select().from(supplyChainAlerts).where(and(eq(supplyChainAlerts.orgId, orgId!), isNull(supplyChainAlerts.resolvedAt))),
  ]);

  // ── Procurement ──────────────────────────────────────────────────────────
  const poIds = pos.map(p => p.id);
  const poLines = poIds.length ? await db.select().from(tradeDocumentLines).where(inArray(tradeDocumentLines.documentId, poIds)) : [];
  const { byDoc: poRemainingByDoc, byItem: expectedByItem } = remainingByDoc(poLines);
  const openPoValue = r2([...poRemainingByDoc.values()].reduce((s, v) => s + v, 0));
  const openPoCount = poRemainingByDoc.size;

  const expectedBillsValue = r2(receipts.reduce((s, r) => s + Math.max(0, num(r.grirTotal) - num(r.billedAmount)), 0));
  const openBills = await openLedgerDocs(orgId!, "Bill", "Accounts Payable");

  // ── Fulfilment ───────────────────────────────────────────────────────────
  const soIds = sos.map(s => s.id);
  const soLines = soIds.length ? await db.select().from(tradeDocumentLines).where(inArray(tradeDocumentLines.documentId, soIds)) : [];
  const { byDoc: soRemainingByDoc, byItem: committedByItem } = remainingByDoc(soLines);
  const openSoValue = r2([...soRemainingByDoc.values()].reduce((s, v) => s + v, 0));
  const openSoCount = soRemainingByDoc.size;

  const awaitingInvoicingValue = r2(shipments.reduce((s, sh) => s + Math.max(0, num(sh.saleTotal) - num(sh.invoicedAmount)), 0));
  const openInvoices = await openLedgerDocs(orgId!, "Invoice", "Accounts Receivable");

  // ── Inventory ────────────────────────────────────────────────────────────
  const tracked = items.filter(i => kindOf(i.productType).tracked);
  const totalInventoryValue = r2(tracked.reduce((s, i) => s + num(i.invValue), 0));
  let belowMinCount = 0, outOfStockCount = 0;
  for (const i of tracked) {
    const onHand = num(i.onHandQty), min = num(i.minOhQty);
    const available = onHand + (expectedByItem.get(i.id) ?? 0) - (committedByItem.get(i.id) ?? 0);
    if (min > 0 && available < min) belowMinCount++;
    if (onHand <= 0) outOfStockCount++;
  }

  // ── Manufacturing / Job Work ─────────────────────────────────────────────
  const openJobWorkValue = r2(openJobWork.reduce((s, j) => s + num(j.sentAmount), 0));
  let sentSum = 0, receivedSum = 0;
  for (const j of closedJobWork) {
    const sentQty = num(j.sentQty), wastageQty = num(j.wastageQty ?? 0);
    sentSum += sentQty;
    receivedSum += sentQty - wastageQty;
  }
  const avgYieldPct = sentSum > 0 ? r2((receivedSum / sentSum) * 100) : null;

  // ── Alerts ───────────────────────────────────────────────────────────────
  const alertCounts = { critical: alerts.filter(a => a.severity === "critical").length, warning: alerts.filter(a => a.severity === "warning").length };
  const jwIds = alerts.filter(a => a.sourceType === "jobwork").map(a => a.sourceId);
  const poAlertIds = alerts.filter(a => a.sourceType === "po").map(a => a.sourceId);
  const moAlertIds = alerts.filter(a => a.sourceType === "mo").map(a => a.sourceId);
  const docNumberById = new Map<string, string | null>();
  const [jwDocs, poDocs, moDocs] = await Promise.all([
    jwIds.length ? db.select({ id: jobWorkOrders.id, docNumber: jobWorkOrders.docNumber }).from(jobWorkOrders).where(inArray(jobWorkOrders.id, jwIds)) : [],
    poAlertIds.length ? db.select({ id: tradeDocuments.id, docNumber: tradeDocuments.docNumber }).from(tradeDocuments).where(inArray(tradeDocuments.id, poAlertIds)) : [],
    moAlertIds.length ? db.select({ id: manufacturingOrders.id, docNumber: manufacturingOrders.moNo }).from(manufacturingOrders).where(inArray(manufacturingOrders.id, moAlertIds)) : [],
  ]);
  for (const r of [...jwDocs, ...poDocs, ...moDocs]) docNumberById.set(r.id, r.docNumber);
  const recentAlerts = alerts
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1))
    .slice(0, 8)
    .map(a => ({ id: a.id, sourceType: a.sourceType, sourceDocNumber: docNumberById.get(a.sourceId) ?? null, kind: a.kind, severity: a.severity, message: a.message }));

  // ── Activity (7 days) ────────────────────────────────────────────────────
  const activity7d = {
    goodsReceiptsPosted: receipts.filter(r => r.createdAt >= sevenDaysAgo).length,
    shipmentsPosted: shipments.filter(s => s.createdAt >= sevenDaysAgo).length,
    buildsCompleted: moRows.filter(m => m.status === "Completed" && m.updatedAt >= sevenDaysAgo).length,
  };

  return ok({
    asOf: new Date().toISOString().slice(0, 10),
    currency: org?.currency ?? "PKR",
    alertCounts,
    recentAlerts,
    procurement: { openPoValue, openPoCount, expectedBillsValue, openBillsValue: openBills.total, openBillsOverdueCount: openBills.overdueCount },
    fulfilment: { openSoValue, openSoCount, awaitingInvoicingValue, openInvoicesValue: openInvoices.total, openInvoicesOverdueCount: openInvoices.overdueCount },
    inventory: { totalInventoryValue, belowMinCount, outOfStockCount, trackedItemCount: tracked.length },
    manufacturing: { openJobWorkCount: openJobWork.length, openJobWorkValue, avgYieldPct },
    activity7d,
  });
}
