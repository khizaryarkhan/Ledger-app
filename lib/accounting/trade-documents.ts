/**
 * Estimates & Purchase Orders — non-posting trade documents, plus progress
 * invoicing.
 *
 * A trade document records intent (a quote / an order) with no GL impact.
 * Converting it creates the real posting document (Estimate → Invoice, PO →
 * Bill) through the shared documents engine. Crucially this supports PROGRESS
 * invoicing: a single estimate can be invoiced in stages — in full, by a
 * percentage, or line-by-line — as many times as needed. Each line tracks how
 * much has been invoiced (invoiced_amount) so remaining is always exact and can
 * never be over-invoiced, and every invoice is linked back to the estimate.
 */

import { db } from "@/db";
import { tradeDocuments, tradeDocumentLines, apTaxRates } from "@/db/schema";
import { and, eq, inArray, desc, sql } from "drizzle-orm";
import { resolveDocNumber, type DocType } from "@/lib/accounting/numbering";
import { postDocument } from "@/lib/accounting/documents";
import { createLink } from "@/lib/accounting/links";
import { LedgerValidationError } from "@/lib/ledger";

export type TradeKind = "Estimate" | "PurchaseOrder" | "SalesOrder";

export type TradeLineInput = {
  accountId?: string | null; itemId?: string | null; description?: string | null;
  qty?: number | null; rate?: number | null; amount: number; taxRateId?: string | null;
  // Pack-level ordering: qty/rate are at this level; unitsPerOrderUnit converts
  // one order unit to the item's base UoM (for receiving & stock).
  orderUom?: string | null; packLevel?: string | null; unitsPerOrderUnit?: number | null; supplierSkuId?: string | null;
};
export type TradeDocInput = {
  docNumber?: string | null;
  partyType?: "Customer" | "Vendor" | null; partyId?: string | null; partyLabel?: string | null;
  issueDate: string; expiryDate?: string | null;
  currency?: string | null; exchangeRate?: number | null;
  memo?: string | null; lines?: TradeLineInput[];
};
/** How much of the estimate/PO to invoice now. */
export type InvoicePlan = { full?: boolean; percent?: number; lines?: { lineId: string; amount: number }[] };

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const err = (m: string): never => { throw new LedgerValidationError(m); };

async function priceLines(orgId: string, lines: { amount: number; taxRateId?: string | null }[]) {
  const ids = [...new Set(lines.map(l => l.taxRateId).filter(Boolean) as string[])];
  const rates = ids.length
    ? await db.select({ id: apTaxRates.id, rate: apTaxRates.rate }).from(apTaxRates)
        .where(and(eq(apTaxRates.orgId, orgId), inArray(apTaxRates.id, ids)))
    : [];
  const rateById = new Map(rates.map(r => [r.id, Number(r.rate) || 0]));
  return lines.map(l => {
    const net = round2(l.amount);
    const tax = round2(net * (l.taxRateId ? (rateById.get(l.taxRateId) ?? 0) : 0) / 100);
    return { net, tax };
  });
}

export async function createTradeDoc(orgId: string, kind: TradeKind, input: TradeDocInput, actorId: string | null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.issueDate)) err("A valid date is required.");
  const raw = (input.lines ?? []).filter(l => l.accountId && round2(l.amount) !== 0);
  if (raw.length === 0) err("Add at least one line with an account and amount.");
  if (!input.partyId && !input.partyLabel) err(kind === "PurchaseOrder" ? "Select a supplier." : "Select a customer.");

  const priced = await priceLines(orgId, raw);
  const subtotal = round2(priced.reduce((s, l) => s + l.net, 0));
  const taxTotal = round2(priced.reduce((s, l) => s + l.tax, 0));
  const total = round2(subtotal + taxTotal);
  const docNumber = await resolveDocNumber(orgId, kind as DocType, input.docNumber);

  const [doc] = await db.insert(tradeDocuments).values({
    orgId, kind, docNumber,
    partyType: input.partyType ?? null, partyId: input.partyId ?? null, partyLabel: input.partyLabel ?? null,
    issueDate: input.issueDate, expiryDate: input.expiryDate ?? null,
    currency: input.currency ?? null, exchangeRate: input.exchangeRate != null ? String(input.exchangeRate) : null,
    status: "Open", memo: input.memo?.trim() || null,
    subtotal: subtotal.toFixed(2), taxTotal: taxTotal.toFixed(2), total: total.toFixed(2),
    createdBy: actorId,
  }).returning();

  try {
    await db.insert(tradeDocumentLines).values(raw.map((l, i) => {
      const upo = l.unitsPerOrderUnit != null && Number(l.unitsPerOrderUnit) > 0 ? Number(l.unitsPerOrderUnit) : 1;
      const orderedBase = round2((Number(l.qty) || 0) * upo);
      return {
        orgId, documentId: doc.id, lineNo: i + 1,
        accountId: l.accountId ?? null, itemId: l.itemId ?? null, description: l.description ?? null,
        qty: l.qty != null ? String(l.qty) : null, rate: l.rate != null ? String(l.rate) : null,
        amount: priced[i].net.toFixed(2), taxRateId: l.taxRateId ?? null, taxAmount: priced[i].tax.toFixed(2),
        orderUom: l.orderUom ?? null, packLevel: l.packLevel ?? null,
        unitsPerOrderUnit: String(upo), supplierSkuId: l.supplierSkuId ?? null,
        orderedBaseQty: String(orderedBase),
      };
    }));
  } catch (e) {
    await db.delete(tradeDocuments).where(eq(tradeDocuments.id, doc.id)).catch(delErr =>
      console.error(`[trade-documents] ORPHAN header ${doc.id} could not be removed:`, delErr));
    throw e;
  }
  return { id: doc.id, docNumber, total };
}

export async function listTradeDocs(orgId: string, kind: TradeKind) {
  const rows = await db.select().from(tradeDocuments)
    .where(and(eq(tradeDocuments.orgId, orgId), eq(tradeDocuments.kind, kind)))
    .orderBy(desc(tradeDocuments.createdAt));
  const ids = rows.map(r => r.id);
  const agg = ids.length
    ? await db.select({
        documentId: tradeDocumentLines.documentId,
        net: sql<string>`sum(${tradeDocumentLines.amount})`,
        invoiced: sql<string>`sum(${tradeDocumentLines.invoicedAmount})`,
      }).from(tradeDocumentLines).where(inArray(tradeDocumentLines.documentId, ids)).groupBy(tradeDocumentLines.documentId)
    : [];
  const aggById = new Map(agg.map(a => [a.documentId, { net: Number(a.net ?? 0), invoiced: Number(a.invoiced ?? 0) }]));
  return rows.map(r => {
    const a = aggById.get(r.id) ?? { net: Number(r.subtotal), invoiced: 0 };
    const remaining = round2(a.net - a.invoiced);
    return {
      id: r.id, docNumber: r.docNumber, partyLabel: r.partyLabel,
      issueDate: r.issueDate, expiryDate: r.expiryDate, currency: r.currency,
      total: Number(r.total), status: r.status,
      invoicedNet: round2(a.invoiced), netTotal: round2(a.net), remainingNet: remaining,
      pct: a.net > 0 ? Math.round((a.invoiced / a.net) * 100) : 0,
    };
  });
}

/** The lines of a trade document with per-line remaining (for the progress dialog). */
export async function tradeDocLines(orgId: string, id: string) {
  const lines = await db.select().from(tradeDocumentLines)
    .where(and(eq(tradeDocumentLines.documentId, id), eq(tradeDocumentLines.orgId, orgId)))
    .orderBy(tradeDocumentLines.lineNo);
  return lines.map(l => ({
    id: l.id, description: l.description, amount: Number(l.amount),
    invoiced: Number(l.invoicedAmount), remaining: round2(Number(l.amount) - Number(l.invoicedAmount)),
    taxRateId: l.taxRateId,
  }));
}

/**
 * Convert / progress-invoice a trade document. `plan` decides how much of each
 * line to invoice now (full, a percentage of remaining, or explicit per-line
 * amounts). Repeatable until nothing remains.
 */
export async function convertTradeDoc(orgId: string, id: string, actorId: string | null, plan: InvoicePlan = { full: true }) {
  const [doc] = await db.select().from(tradeDocuments)
    .where(and(eq(tradeDocuments.id, id), eq(tradeDocuments.orgId, orgId))).limit(1);
  if (!doc) err("Document not found.");
  if (doc.kind === "SalesOrder") err("Sales Orders are fulfilled via Shipping, then invoiced from the shipment — not converted directly.");
  if (doc.status === "Closed") err("This document is already fully invoiced.");

  const lines = await db.select().from(tradeDocumentLines)
    .where(and(eq(tradeDocumentLines.documentId, id), eq(tradeDocumentLines.orgId, orgId)))
    .orderBy(tradeDocumentLines.lineNo);

  const byId = plan.lines ? new Map(plan.lines.map(p => [p.lineId, round2(p.amount)])) : null;
  const pct = plan.percent != null ? Math.max(0, Math.min(100, plan.percent)) : null;

  const take = lines.map(l => {
    const remaining = round2(Number(l.amount) - Number(l.invoicedAmount));
    let net: number;
    if (byId) net = round2(Math.min(byId.get(l.id) ?? 0, remaining));
    else if (pct != null) net = round2(remaining * pct / 100);
    else net = remaining; // full
    if (net > remaining + 0.005) err("Cannot invoice more than the remaining amount on a line.");
    return { line: l, net: Math.max(0, net), remaining };
  }).filter(t => t.net > 0);

  if (take.length === 0) err("Nothing left to invoice on this document.");

  const targetType: DocType = doc.kind === "Estimate" ? "Invoice" : "Bill";
  const entry = await postDocument(orgId, {
    type: targetType,
    date: new Date().toISOString().slice(0, 10),
    memo: `From ${doc.kind === "Estimate" ? "estimate" : "purchase order"} ${doc.docNumber ?? ""}`.trim(),
    partyType: doc.partyType as any, partyId: doc.partyId, partyLabel: doc.partyLabel,
    currency: doc.currency, exchangeRate: doc.exchangeRate != null ? Number(doc.exchangeRate) : null,
    lines: take.map(t => ({ accountId: t.line.accountId ?? undefined, description: t.line.description, amount: t.net, taxRateId: t.line.taxRateId })),
  }, actorId);

  // Advance each line's invoiced amount.
  for (const t of take) {
    await db.update(tradeDocumentLines)
      .set({ invoicedAmount: round2(Number(t.line.invoicedAmount) + t.net).toFixed(2) })
      .where(eq(tradeDocumentLines.id, t.line.id));
  }

  // Recompute document status from the fresh totals.
  const totalNet = round2(lines.reduce((s, l) => s + Number(l.amount), 0));
  const invoicedNet = round2(lines.reduce((s, l) => s + Number(l.invoicedAmount), 0) + take.reduce((s, t) => s + t.net, 0));
  const status = invoicedNet >= totalNet - 0.005 ? "Closed" : invoicedNet > 0.005 ? "Partial" : "Open";
  await db.update(tradeDocuments)
    .set({ status, convertedEntryId: doc.convertedEntryId ?? entry.id, updatedAt: new Date() })
    .where(eq(tradeDocuments.id, id));

  // Link the trade document → the posted document.
  const priced = await priceLines(orgId, take.map(t => ({ amount: t.net, taxRateId: t.line.taxRateId })));
  const linkedAmount = round2(priced.reduce((s, p) => s + p.net + p.tax, 0));
  await createLink(orgId, {
    fromType: doc.kind, fromId: id, toType: targetType, toId: entry.id,
    relation: doc.kind === "Estimate" ? "progress_invoice" : "po_bill", amount: linkedAmount,
  }, actorId);

  return { convertedTo: targetType, docNumber: entry.docNumber, txnNo: entry.txnNo, entryId: entry.id, status, invoicedNet, remainingNet: round2(totalNet - invoicedNet) };
}
