/**
 * GET /api/inventory/procurement-reports?type=open-pos|expected-bills|open-bills
 *
 *  open-pos       → purchase orders with qty ordered vs received vs remaining
 *  expected-bills → goods received but not yet billed (open GR/IR) by supplier
 *  open-bills     → posted supplier bills with an unpaid A/P balance
 */

import { db } from "@/db";
import { tradeDocuments, tradeDocumentLines, apItems, goodsReceipts, accounts, journalEntries, journalLines, transactionLinks } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { and, eq, asc, inArray, sql } from "drizzle-orm";

const num = (v: any) => Number(v ?? 0);
const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const type = new URL(req.url).searchParams.get("type") || "open-pos";

  if (type === "expected-bills") {
    const receipts = await db.select().from(goodsReceipts)
      .where(and(eq(goodsReceipts.orgId, orgId!), eq(goodsReceipts.status, "Posted")))
      .orderBy(asc(goodsReceipts.receiptDate));
    const open = receipts.map(r => ({
      id: r.id, receiptNo: r.receiptNo, supplierLabel: r.supplierLabel, receiptDate: r.receiptDate,
      received: num(r.grirTotal), billed: num(r.billedAmount), openAmount: r2(num(r.grirTotal) - num(r.billedAmount)),
    })).filter(r => r.openAmount > 0.005);
    return ok({ rows: open, total: r2(open.reduce((s, r) => s + r.openAmount, 0)) });
  }

  if (type === "open-bills") {
    const rows = await db.select({
      id: journalEntries.id, docNumber: journalEntries.docNumber, entryNumber: journalEntries.entryNumber,
      date: journalEntries.entryDate, dueDate: journalEntries.dueDate, total: journalLines.credit,
      supplier: journalLines.nameLabel,
    }).from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(and(eq(journalLines.orgId, orgId!), eq(journalEntries.sourceType, "Bill"), eq(journalEntries.status, "Posted"), eq(accounts.type, "Accounts Payable")));
    const ids = rows.map(r => r.id);
    const applied = ids.length
      ? await db.select({ toId: transactionLinks.toId, amt: sql<string>`sum(${transactionLinks.amount})` }).from(transactionLinks)
          .where(and(eq(transactionLinks.orgId, orgId!), inArray(transactionLinks.toId, ids), inArray(transactionLinks.relation, ["payment", "credit"]))).groupBy(transactionLinks.toId)
      : [];
    const paidById = new Map(applied.map(a => [a.toId, num(a.amt)]));
    const today = new Date().toISOString().slice(0, 10);
    const bills = rows.map(r => {
      const total = r2(num(r.total)); const open = r2(total - (paidById.get(r.id) ?? 0));
      return { id: r.id, docNumber: r.docNumber ?? `JE-${r.entryNumber}`, supplier: r.supplier || "—", date: r.date, dueDate: r.dueDate ?? null, total, open, overdue: !!r.dueDate && r.dueDate < today };
    }).filter(b => b.open > 0.005).sort((a, b) => (a.dueDate || a.date || "").localeCompare(b.dueDate || b.date || ""));
    return ok({ rows: bills, total: r2(bills.reduce((s, b) => s + b.open, 0)) });
  }

  // open-pos (default)
  const pos = await db.select().from(tradeDocuments)
    .where(and(eq(tradeDocuments.orgId, orgId!), eq(tradeDocuments.kind, "PurchaseOrder")))
    .orderBy(asc(tradeDocuments.issueDate));
  if (!pos.length) return ok({ rows: [], total: 0 });
  const lines = await db.select().from(tradeDocumentLines).where(inArray(tradeDocumentLines.documentId, pos.map(p => p.id)));
  const itemIds = [...new Set(lines.map(l => l.itemId).filter(Boolean) as string[])];
  const items = itemIds.length ? await db.select({ id: apItems.id, name: apItems.name, baseUom: apItems.baseUom }).from(apItems).where(and(eq(apItems.orgId, orgId!), inArray(apItems.id, itemIds))) : [];
  const itemById = new Map(items.map(i => [i.id, i]));
  const rows = pos.map(po => {
    const pl = lines.filter(l => l.documentId === po.id);
    const detail = pl.map(l => {
      const ordered = num(l.orderedBaseQty) || num(l.qty) * num(l.unitsPerOrderUnit || 1);
      const received = num(l.receivedQty); const remaining = r4(ordered - received);
      const it = l.itemId ? itemById.get(l.itemId) : null;
      return { itemName: it?.name ?? (l.description || "—"), baseUom: it?.baseUom ?? null, ordered, received, remaining, remainingValue: r2(remaining * (num(l.unitsPerOrderUnit || 1) > 0 ? num(l.rate) / num(l.unitsPerOrderUnit || 1) : num(l.rate))) };
    });
    const remainingValue = r2(detail.reduce((s, d) => s + d.remainingValue, 0));
    const fullyReceived = detail.every(d => d.remaining <= 0.0001);
    return { id: po.id, docNumber: po.docNumber, supplier: po.partyLabel, date: po.issueDate, deliveryDate: po.expiryDate, total: num(po.total), remainingValue, status: fullyReceived ? "Received" : detail.some(d => d.received > 0) ? "Partial" : "Awaiting", detail };
  }).filter(po => po.status !== "Received");
  return ok({ rows, total: r2(rows.reduce((s, p) => s + p.remainingValue, 0)) });
}
