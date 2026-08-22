/**
 * GET /api/inventory/sales-reports?type=open-sos|awaiting-invoicing|open-invoices
 *
 *  open-sos           → sales orders ordered vs shipped, remaining value
 *  awaiting-invoicing → goods shipped but not yet invoiced (sale value)
 *  open-invoices      → posted customer invoices with an unpaid A/R balance
 */

import { db } from "@/db";
import { tradeDocuments, tradeDocumentLines, apItems, salesShipments, accounts, journalEntries, journalLines, transactionLinks } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { and, eq, asc, inArray, sql } from "drizzle-orm";

const num = (v: any) => Number(v ?? 0);
const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const type = new URL(req.url).searchParams.get("type") || "open-sos";

  if (type === "awaiting-invoicing") {
    const ships = await db.select().from(salesShipments)
      .where(and(eq(salesShipments.orgId, orgId!), eq(salesShipments.status, "Posted"))).orderBy(asc(salesShipments.shipmentDate));
    const open = ships.map(s => ({
      id: s.id, shipmentNo: s.shipmentNo, customerLabel: s.customerLabel, shipmentDate: s.shipmentDate,
      saleValue: num(s.saleTotal), invoiced: num(s.invoicedAmount), openAmount: r2(num(s.saleTotal) - num(s.invoicedAmount)),
    })).filter(s => s.openAmount > 0.005);
    return ok({ rows: open, total: r2(open.reduce((a, s) => a + s.openAmount, 0)) });
  }

  if (type === "open-invoices") {
    const rows = await db.select({
      id: journalEntries.id, docNumber: journalEntries.docNumber, entryNumber: journalEntries.entryNumber,
      date: journalEntries.entryDate, dueDate: journalEntries.dueDate, total: journalLines.debit, customer: journalLines.nameLabel,
    }).from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(and(eq(journalLines.orgId, orgId!), eq(journalEntries.sourceType, "Invoice"), eq(journalEntries.status, "Posted"), eq(accounts.type, "Accounts Receivable")));
    const ids = rows.map(r => r.id);
    const applied = ids.length
      ? await db.select({ toId: transactionLinks.toId, amt: sql<string>`sum(${transactionLinks.amount})` }).from(transactionLinks)
          .where(and(eq(transactionLinks.orgId, orgId!), inArray(transactionLinks.toId, ids), inArray(transactionLinks.relation, ["payment", "credit"]))).groupBy(transactionLinks.toId)
      : [];
    const paidById = new Map(applied.map(a => [a.toId, num(a.amt)]));
    const today = new Date().toISOString().slice(0, 10);
    const invoices = rows.map(r => {
      const total = r2(num(r.total)); const open = r2(total - (paidById.get(r.id) ?? 0));
      return { id: r.id, docNumber: r.docNumber ?? `JE-${r.entryNumber}`, customer: r.customer || "—", date: r.date, dueDate: r.dueDate ?? null, total, open, overdue: !!r.dueDate && r.dueDate < today };
    }).filter(b => b.open > 0.005).sort((a, b) => (a.dueDate || a.date || "").localeCompare(b.dueDate || b.date || ""));
    return ok({ rows: invoices, total: r2(invoices.reduce((s, b) => s + b.open, 0)) });
  }

  // open-sos (default)
  const sos = await db.select().from(tradeDocuments)
    .where(and(eq(tradeDocuments.orgId, orgId!), eq(tradeDocuments.kind, "SalesOrder"))).orderBy(asc(tradeDocuments.issueDate));
  if (!sos.length) return ok({ rows: [], total: 0 });
  const lines = await db.select().from(tradeDocumentLines).where(inArray(tradeDocumentLines.documentId, sos.map(s => s.id)));
  const itemIds = [...new Set(lines.map(l => l.itemId).filter(Boolean) as string[])];
  const items = itemIds.length ? await db.select({ id: apItems.id, name: apItems.name, baseUom: apItems.baseUom }).from(apItems).where(and(eq(apItems.orgId, orgId!), inArray(apItems.id, itemIds))) : [];
  const itemById = new Map(items.map(i => [i.id, i]));
  const rows = sos.map(so => {
    const sl = lines.filter(l => l.documentId === so.id);
    const detail = sl.map(l => {
      const ordered = num(l.orderedBaseQty) || num(l.qty) * num(l.unitsPerOrderUnit || 1);
      const shipped = num(l.receivedQty); const remaining = r4(ordered - shipped);
      const it = l.itemId ? itemById.get(l.itemId) : null;
      const perBase = num(l.unitsPerOrderUnit || 1) > 0 ? num(l.rate) / num(l.unitsPerOrderUnit || 1) : num(l.rate);
      return { itemName: it?.name ?? (l.description || "—"), baseUom: it?.baseUom ?? null, ordered, shipped, remaining, remainingValue: r2(remaining * perBase) };
    });
    const remainingValue = r2(detail.reduce((s, d) => s + d.remainingValue, 0));
    const fullyShipped = detail.every(d => d.remaining <= 0.0001);
    return { id: so.id, docNumber: so.docNumber, customer: so.partyLabel, date: so.issueDate, deliveryDate: so.expiryDate, total: num(so.total), remainingValue, status: fullyShipped ? "Shipped" : detail.some(d => d.shipped > 0) ? "Partial" : "Awaiting", detail };
  }).filter(so => so.status !== "Shipped");
  return ok({ rows, total: r2(rows.reduce((s, p) => s + p.remainingValue, 0)) });
}
