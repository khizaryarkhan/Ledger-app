/**
 * Estimates & Purchase Orders — non-posting trade documents.
 *
 * They record intent (a quote to a customer, an order to a supplier) with no
 * GL impact. "Convert" turns one into the real posting document (Estimate →
 * Invoice, Purchase Order → Bill) through the shared documents engine, so the
 * numbers flow straight into the ledger with one click.
 */

import { db } from "@/db";
import { tradeDocuments, tradeDocumentLines, apTaxRates } from "@/db/schema";
import { and, eq, inArray, desc } from "drizzle-orm";
import { resolveDocNumber, type DocType } from "@/lib/accounting/numbering";
import { postDocument } from "@/lib/accounting/documents";
import { LedgerValidationError } from "@/lib/ledger";

export type TradeKind = "Estimate" | "PurchaseOrder";

export type TradeLineInput = {
  accountId?: string | null;
  itemId?: string | null;
  description?: string | null;
  qty?: number | null;
  rate?: number | null;
  amount: number;
  taxRateId?: string | null;
};
export type TradeDocInput = {
  docNumber?: string | null;
  partyType?: "Customer" | "Vendor" | null;
  partyId?: string | null;
  partyLabel?: string | null;
  issueDate: string;
  expiryDate?: string | null;
  currency?: string | null;
  exchangeRate?: number | null;
  memo?: string | null;
  lines?: TradeLineInput[];
};

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const err = (m: string): never => { throw new LedgerValidationError(m); };

async function priceLines(orgId: string, lines: TradeLineInput[]) {
  const ids = [...new Set(lines.map(l => l.taxRateId).filter(Boolean) as string[])];
  const rates = ids.length
    ? await db.select({ id: apTaxRates.id, rate: apTaxRates.rate }).from(apTaxRates)
        .where(and(eq(apTaxRates.orgId, orgId), inArray(apTaxRates.id, ids)))
    : [];
  const rateById = new Map(rates.map(r => [r.id, Number(r.rate) || 0]));
  return lines.map(l => {
    const net = round2(l.amount);
    const tax = round2(net * (l.taxRateId ? (rateById.get(l.taxRateId) ?? 0) : 0) / 100);
    return { ...l, net, tax };
  });
}

export async function createTradeDoc(orgId: string, kind: TradeKind, input: TradeDocInput, actorId: string | null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.issueDate)) err("A valid date is required.");
  const raw = (input.lines ?? []).filter(l => l.accountId && round2(l.amount) !== 0);
  if (raw.length === 0) err("Add at least one line with an account and amount.");
  if (!input.partyId && !input.partyLabel) err(kind === "Estimate" ? "Select a customer." : "Select a supplier.");

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
    await db.insert(tradeDocumentLines).values(priced.map((l, i) => ({
      orgId, documentId: doc.id, lineNo: i + 1,
      accountId: l.accountId ?? null, itemId: l.itemId ?? null, description: l.description ?? null,
      qty: l.qty != null ? String(l.qty) : null, rate: l.rate != null ? String(l.rate) : null,
      amount: l.net.toFixed(2), taxRateId: l.taxRateId ?? null, taxAmount: l.tax.toFixed(2),
    })));
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
  return rows.map(r => ({
    id: r.id, docNumber: r.docNumber, partyLabel: r.partyLabel,
    issueDate: r.issueDate, expiryDate: r.expiryDate, currency: r.currency,
    total: Number(r.total), status: r.status, convertedEntryId: r.convertedEntryId,
  }));
}

/** Convert an Estimate → Invoice or a Purchase Order → Bill. */
export async function convertTradeDoc(orgId: string, id: string, actorId: string | null) {
  const [doc] = await db.select().from(tradeDocuments)
    .where(and(eq(tradeDocuments.id, id), eq(tradeDocuments.orgId, orgId))).limit(1);
  if (!doc) err("Document not found.");
  if (doc.status === "Converted") err("This document has already been converted.");

  const lines = await db.select().from(tradeDocumentLines)
    .where(and(eq(tradeDocumentLines.documentId, id), eq(tradeDocumentLines.orgId, orgId)))
    .orderBy(tradeDocumentLines.lineNo);

  const targetType: DocType = doc.kind === "Estimate" ? "Invoice" : "Bill";
  const entry = await postDocument(orgId, {
    type: targetType,
    date: new Date().toISOString().slice(0, 10),
    memo: `From ${doc.kind === "Estimate" ? "estimate" : "purchase order"} ${doc.docNumber ?? ""}`.trim(),
    partyType: doc.partyType as any, partyId: doc.partyId, partyLabel: doc.partyLabel,
    currency: doc.currency, exchangeRate: doc.exchangeRate != null ? Number(doc.exchangeRate) : null,
    lines: lines.map(l => ({
      accountId: l.accountId ?? undefined,
      description: l.description, amount: Number(l.amount),
      qty: l.qty != null ? Number(l.qty) : null, rate: l.rate != null ? Number(l.rate) : null,
      taxRateId: l.taxRateId,
    })),
  }, actorId);

  await db.update(tradeDocuments)
    .set({ status: "Converted", convertedEntryId: entry.id, updatedAt: new Date() })
    .where(eq(tradeDocuments.id, id));

  return { convertedTo: targetType, docNumber: entry.docNumber, txnNo: entry.txnNo, entryId: entry.id };
}
