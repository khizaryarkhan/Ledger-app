/**
 * Assembles everything a printable business document needs, in one shape, for
 * both ledger documents (Invoice/Bill/…) and trade documents (Quote/PO/SO).
 *
 * Why this exists: the print pages used to reverse-engineer a document from its
 * JOURNAL LINES, which carry only an account and an amount. That is why printed
 * invoices had no quantity, no unit price and no tax breakdown — the data was
 * never in the rows being read. Line-item documents store the original form
 * input in `journal_entries.source_payload`, which does have qty/rate/tax, so
 * that is the source of truth here, with the journal lines as a fallback for
 * older entries posted before payloads were stored.
 */

import { db } from "@/db";
import {
  organisations, journalEntries, journalLines, accounts, apTaxRates, apItems,
  customers, apSuppliers, tradeDocuments, tradeDocumentLines,
} from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { linksFor } from "@/lib/accounting/links";
import { amountInWords } from "@/lib/accounting/amount-in-words";

const num = (v: any) => Number(v ?? 0);
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type PrintParty = {
  name: string | null; addressLines: string[]; taxNumber: string | null;
  email: string | null; phone: string | null;
};
export type PrintLine = {
  name: string | null; description: string | null;
  qty: number | null; uom: string | null; rate: number | null;
  taxLabel: string | null; taxPct: number | null; amount: number;
};
export type PrintDocument = {
  company: any;
  doc: {
    kind: string; label: string; docNumber: string | null; status: string | null;
    date: string; dueDate: string | null; dueLabel: string;
    reference: string | null; memo: string | null; currency: string;
    partyHeading: string; isPurchase: boolean;
    /** Payment terms in days, when the counterparty has them set. */
    termsDays?: number | null;
    /** Whether this document type is signed off before it's acted on. */
    needsSignature?: boolean;
  };
  party: PrintParty;
  lines: PrintLine[];
  totals: {
    subtotal: number; taxes: { label: string; amount: number }[]; taxTotal: number;
    total: number; paid: number; balance: number; inWords: string;
  };
};

/** Label + party heading + due-date wording per document type. */
const DOC_META: Record<string, { label: string; party: string; due: string; purchase?: boolean }> = {
  Invoice:       { label: "INVOICE",         party: "Bill to",  due: "Due" },
  SalesReceipt:  { label: "SALES RECEIPT",   party: "Received from", due: "Due" },
  CreditNote:    { label: "CREDIT NOTE",     party: "Credit to", due: "Due" },
  RefundReceipt: { label: "REFUND RECEIPT",  party: "Refunded to", due: "Due" },
  Bill:          { label: "BILL",            party: "From",     due: "Due", purchase: true },
  Expense:       { label: "EXPENSE",         party: "Paid to",  due: "Due", purchase: true },
  VendorCredit:  { label: "SUPPLIER CREDIT", party: "From",     due: "Due", purchase: true },
  Estimate:      { label: "QUOTE",           party: "For",      due: "Valid until" },
  PurchaseOrder: { label: "PURCHASE ORDER",  party: "Supplier", due: "Deliver by", purchase: true },
  SalesOrder:    { label: "SALES ORDER",     party: "Customer", due: "Required by" },
};

export async function loadCompany(orgId: string) {
  const [o] = await db.select().from(organisations).where(eq(organisations.id, orgId)).limit(1);
  if (!o) return null;
  const addressLines = [
    o.addressStreet, o.addressLine2,
    [o.addressCity, o.addressState, o.addressPostcode].filter(Boolean).join(", ") || null,
    o.addressCountry,
  ].filter(Boolean) as string[];
  return {
    name: o.displayName || o.name, logoUrl: o.logoUrl, addressLines,
    phone: o.phone, email: o.email, website: o.website,
    taxNumber: o.taxNumber, registrationNumber: o.registrationNumber,
    bank: {
      name: o.bankName, accountName: o.bankAccountName, accountNumber: o.bankAccountNumber,
      iban: o.bankIban, swift: o.bankSwift, branch: o.bankBranch,
    },
    terms: o.documentTerms, footer: o.documentFooter,
    accent: o.documentAccentColor || "#1F3A5F", // professional navy default
    currency: o.currency,
  };
}

async function loadParty(orgId: string, partyType: string | null | undefined, partyId: string | null | undefined, fallbackLabel: string | null): Promise<PrintParty> {
  const empty: PrintParty = { name: fallbackLabel, addressLines: [], taxNumber: null, email: null, phone: null };
  if (!partyId) return empty;

  if (partyType === "Vendor") {
    const [s] = await db.select().from(apSuppliers)
      .where(and(eq(apSuppliers.id, partyId), eq(apSuppliers.orgId, orgId))).limit(1);
    if (!s) return empty;
    return {
      name: s.name ?? fallbackLabel,
      addressLines: [s.addressStreet, s.addressLine2,
        [s.addressCity, s.addressState, s.addressPostcode].filter(Boolean).join(", ") || null,
        s.country].filter(Boolean) as string[],
      taxNumber: s.taxNumber ?? null, email: s.email ?? null, phone: s.phone ?? null,
    };
  }

  const [c] = await db.select().from(customers)
    .where(and(eq(customers.id, partyId), eq(customers.orgId, orgId))).limit(1);
  if (!c) return empty;
  return {
    name: c.name ?? fallbackLabel,
    addressLines: [c.addressStreet, c.addressLine2,
      [c.addressCity, c.addressState, c.addressPostcode].filter(Boolean).join(", ") || null,
      c.country].filter(Boolean) as string[],
    taxNumber: c.taxNumber ?? null, email: c.email ?? null, phone: c.phone ?? null,
  };
}

/** Resolve item names + tax percentages for a set of payload lines. */
async function decorateLines(orgId: string, rawLines: any[]): Promise<PrintLine[]> {
  const itemIds = [...new Set(rawLines.map(l => l.itemId).filter(Boolean))] as string[];
  const taxIds = [...new Set(rawLines.map(l => l.taxRateId).filter(Boolean))] as string[];
  const [items, taxes] = await Promise.all([
    itemIds.length ? db.select({ id: apItems.id, name: apItems.name, baseUom: apItems.baseUom })
      .from(apItems).where(and(eq(apItems.orgId, orgId), inArray(apItems.id, itemIds))) : Promise.resolve([]),
    taxIds.length ? db.select({ id: apTaxRates.id, name: apTaxRates.name, rate: apTaxRates.rate })
      .from(apTaxRates).where(and(eq(apTaxRates.orgId, orgId), inArray(apTaxRates.id, taxIds))) : Promise.resolve([]),
  ]);
  const itemById = new Map(items.map(i => [i.id, i]));
  const taxById = new Map(taxes.map(t => [t.id, t]));

  return rawLines.map(l => {
    const it = l.itemId ? itemById.get(l.itemId) : null;
    const tx = l.taxRateId ? taxById.get(l.taxRateId) : null;
    return {
      name: it?.name ?? null,
      description: l.description ?? null,
      qty: l.qty != null && l.qty !== "" ? num(l.qty) : null,
      uom: l.orderUom || it?.baseUom || null,
      rate: l.rate != null && l.rate !== "" ? num(l.rate) : null,
      taxLabel: tx?.name ?? null,
      taxPct: tx ? num(tx.rate) : null,
      amount: round2(num(l.amount)),
    };
  });
}

/** Group per-line tax into one row per rate, the way a tax authority expects. */
function taxBreakdown(lines: PrintLine[]): { label: string; amount: number }[] {
  const byLabel = new Map<string, number>();
  for (const l of lines) {
    if (!l.taxPct) continue;
    const label = l.taxLabel ? `${l.taxLabel} (${l.taxPct}%)` : `Tax (${l.taxPct}%)`;
    byLabel.set(label, round2((byLabel.get(label) ?? 0) + round2(l.amount * l.taxPct / 100)));
  }
  return [...byLabel.entries()].map(([label, amount]) => ({ label, amount }));
}

/** A posted ledger document (Invoice, Bill, Credit note, …). */
export async function loadLedgerDocumentForPrint(orgId: string, entryId: string): Promise<PrintDocument | null> {
  const [entry] = await db.select().from(journalEntries)
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.orgId, orgId))).limit(1);
  if (!entry) return null;

  const company = await loadCompany(orgId);
  const meta = DOC_META[entry.sourceType] ?? { label: (entry.sourceType || "DOCUMENT").toUpperCase(), party: "Party", due: "Due" };
  const payload = (entry.sourcePayload as any) ?? null;

  let lines: PrintLine[];
  if (payload?.lines?.length) {
    lines = await decorateLines(orgId, payload.lines.filter((l: any) => num(l.amount) !== 0));
  } else {
    // Pre-payload entries: fall back to the journal lines, excluding the
    // control/tax/bank postings so only the goods-and-services rows show.
    const rows = await db.select({
      description: journalLines.description, debit: journalLines.debit, credit: journalLines.credit,
      type: accounts.type, subtype: accounts.subtype, accountName: accounts.name,
    }).from(journalLines).innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(and(eq(journalLines.orgId, orgId), eq(journalLines.entryId, entryId)))
      .orderBy(journalLines.lineNo);
    lines = rows
      .filter(r => r.type !== "Accounts Receivable" && r.type !== "Accounts Payable"
        && r.subtype !== "SalesTaxPayable" && r.type !== "Bank" && r.type !== "Credit Card")
      .map(r => ({
        name: null, description: r.description || r.accountName,
        qty: null, uom: null, rate: null, taxLabel: null, taxPct: null,
        amount: round2(num(r.debit) || num(r.credit)),
      }));
  }

  const party = await loadParty(orgId, payload?.partyType, payload?.partyId,
    (await firstNameLabel(orgId, entryId)) ?? payload?.partyLabel ?? null);

  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const taxes = taxBreakdown(lines);
  const taxTotal = round2(taxes.reduce((s, t) => s + t.amount, 0));
  const total = round2(subtotal + taxTotal);

  // What's been settled against this document so far (payments, credits).
  const links = await linksFor(orgId, entry.sourceType, entry.id).catch(() => [] as any[]);
  const paid = round2((links ?? []).reduce((s: number, l: any) => s + num(l.linkedAmount), 0));
  const currency = payload?.currency || company?.currency || "";

  return {
    company,
    doc: {
      kind: entry.sourceType, label: meta.label, docNumber: entry.docNumber, status: entry.status,
      date: entry.entryDate, dueDate: entry.dueDate ?? null, dueLabel: meta.due,
      reference: entry.reference ?? null, memo: entry.memo ?? null, currency,
      partyHeading: meta.party, isPurchase: !!meta.purchase,
    },
    party, lines,
    totals: {
      subtotal, taxes, taxTotal, total,
      paid, balance: round2(total - paid),
      inWords: amountInWords(total, currency),
    },
  };
}

/** The counterparty name recorded on the entry's control line. */
async function firstNameLabel(orgId: string, entryId: string): Promise<string | null> {
  const rows = await db.select({ nameLabel: journalLines.nameLabel })
    .from(journalLines)
    .where(and(eq(journalLines.orgId, orgId), eq(journalLines.entryId, entryId)));
  return rows.find(r => r.nameLabel)?.nameLabel ?? null;
}

/** A trade document (Quote / Purchase Order / Sales Order). */
export async function loadTradeDocumentForPrint(orgId: string, id: string): Promise<PrintDocument | null> {
  const [doc] = await db.select().from(tradeDocuments)
    .where(and(eq(tradeDocuments.id, id), eq(tradeDocuments.orgId, orgId))).limit(1);
  if (!doc) return null;

  const company = await loadCompany(orgId);
  const meta = DOC_META[doc.kind] ?? { label: doc.kind.toUpperCase(), party: "Party", due: "Valid until" };

  const rawLines = await db.select().from(tradeDocumentLines)
    .where(and(eq(tradeDocumentLines.documentId, id), eq(tradeDocumentLines.orgId, orgId)))
    .orderBy(tradeDocumentLines.lineNo);
  const lines = await decorateLines(orgId, rawLines);
  const party = await loadParty(orgId, doc.partyType, doc.partyId, doc.partyLabel);

  const subtotal = round2(num(doc.subtotal)) || round2(lines.reduce((s, l) => s + l.amount, 0));
  const taxes = taxBreakdown(lines);
  const taxTotal = round2(num(doc.taxTotal)) || round2(taxes.reduce((s, t) => s + t.amount, 0));
  const total = round2(num(doc.total)) || round2(subtotal + taxTotal);
  const currency = doc.currency || company?.currency || "";

  return {
    company,
    doc: {
      kind: doc.kind, label: meta.label, docNumber: doc.docNumber, status: doc.status,
      date: doc.issueDate, dueDate: doc.expiryDate ?? null, dueLabel: meta.due,
      reference: null, memo: doc.memo ?? null, currency,
      partyHeading: meta.party, isPurchase: !!meta.purchase,
      needsSignature: doc.kind === "PurchaseOrder" || doc.kind === "Estimate",
    },
    party, lines,
    totals: {
      subtotal, taxes, taxTotal, total,
      paid: 0, balance: total,
      inWords: amountInWords(total, currency),
    },
  };
}
