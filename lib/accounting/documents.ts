/**
 * Native transaction documents → General Ledger.
 *
 * Every business document (Invoice, Bill, Payment, …) is posted as a balanced
 * journal entry through lib/ledger.postJournalEntry. This module is the single
 * place the double-entry rules live — the accountant's posting logic — so every
 * form behaves consistently and the GL is always the source of truth.
 *
 * Control accounts (A/R, A/P, Sales Tax) are resolved by the system, never
 * chosen on the form. Tax is computed here from the tax-rate master, never
 * trusted from the client. All amounts are home currency for now.
 *
 * Posting rules (Dr = debit, Cr = credit):
 *   Invoice        Dr A/R (customer)         Cr Income (lines)   Cr Sales Tax
 *   Sales receipt  Dr Bank                   Cr Income (lines)   Cr Sales Tax
 *   Credit note    Dr Income  Dr Sales Tax   Cr A/R (customer)
 *   Refund receipt Dr Income  Dr Sales Tax   Cr Bank
 *   Bill           Dr Expense Dr Sales Tax   Cr A/P (vendor)
 *   Expense        Dr Expense Dr Sales Tax   Cr Bank
 *   Supplier credit Dr A/P (vendor)          Cr Expense (lines)  Cr Sales Tax
 *   Receive payment Dr Bank                  Cr A/R (customer)
 *   Pay bills      Dr A/P (vendor)           Cr Bank
 *   Bank deposit   Dr Bank                   Cr (source accounts, lines)
 *   Transfer       Dr Bank (to)              Cr Bank (from)
 */

import { db } from "@/db";
import { accounts, apTaxRates, organisations } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { postJournalEntry, LedgerValidationError, type PostLine } from "@/lib/ledger";
import type { DocType } from "@/lib/accounting/numbering";
import { ensureSystemAccounts } from "@/lib/accounting/system-accounts";
import { createLink } from "@/lib/accounting/links";
import { openDocsForParty } from "@/lib/accounting/payments";

export type DocLineInput = {
  accountId?: string;
  description?: string | null;
  qty?: number | null;
  rate?: number | null;
  amount: number;                 // net line amount (before tax)
  taxRateId?: string | null;
  classId?: string | null;
  locationId?: string | null;
};

export type PostDocInput = {
  type: DocType;
  date: string;                   // YYYY-MM-DD
  docNumber?: string | null;
  memo?: string | null;
  partyType?: "Customer" | "Vendor" | null;
  partyId?: string | null;
  partyLabel?: string | null;
  bankAccountId?: string | null;   // deposit-to / paid-from / transfer source
  toBankAccountId?: string | null; // transfer destination
  amount?: number | null;          // payment / bill payment / transfer amount
  currency?: string | null;        // transaction currency (defaults to home)
  exchangeRate?: number | null;    // 1 {currency} = {rate} {home}; required when foreign
  allocations?: { targetId: string; amount: number }[]; // payment/bill-payment → invoices/bills
  dueDate?: string | null;         // Invoice/Bill: when payable (aging basis)
  termsDays?: number | null;       // if dueDate omitted, due = date + termsDays
  reference?: string | null;       // supplier bill no. / customer PO / free ref
  lines?: DocLineInput[];
};

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const err = (m: string): never => { throw new LedgerValidationError(m); };

/** Add days to a YYYY-MM-DD date (UTC-safe). */
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** Resolve the due date: explicit wins, else date + terms, else null. */
function resolveDueDate(date: string, input: PostDocInput): string | null {
  if (input.dueDate) return input.dueDate;
  if (input.termsDays != null && Number.isFinite(input.termsDays)) return addDays(date, Math.max(0, Math.trunc(input.termsDays)));
  return null;
}
const DATED_TYPES = new Set<DocType>(["Invoice", "Bill"]);

/** Resolve the org's control accounts (A/R, A/P, Sales Tax Payable). */
async function controlAccounts(orgId: string) {
  await ensureSystemAccounts(orgId);
  const rows = await db.select({ id: accounts.id, type: accounts.type, subtype: accounts.subtype, name: accounts.name })
    .from(accounts).where(eq(accounts.orgId, orgId));
  const bySub = (s: string) => rows.find(r => (r.subtype ?? "").toLowerCase() === s.toLowerCase());
  const byType = (t: string) => rows.find(r => (r.type ?? "") === t);
  const ar = bySub("AccountsReceivable") ?? byType("Accounts Receivable");
  const ap = bySub("AccountsPayable") ?? byType("Accounts Payable");
  const tax = bySub("SalesTaxPayable");
  return { arId: ar?.id ?? null, apId: ap?.id ?? null, taxId: tax?.id ?? null };
}

/** Compute per-line tax from the tax-rate master (server-trusted). */
async function withTax(orgId: string, lines: DocLineInput[]) {
  const ids = [...new Set(lines.map(l => l.taxRateId).filter(Boolean) as string[])];
  const rates = ids.length
    ? await db.select({ id: apTaxRates.id, rate: apTaxRates.rate }).from(apTaxRates)
        .where(and(eq(apTaxRates.orgId, orgId), inArray(apTaxRates.id, ids)))
    : [];
  const rateById = new Map(rates.map(r => [r.id, Number(r.rate) || 0]));
  return lines.map(l => {
    const net = round2(l.amount);
    const pct = l.taxRateId ? (rateById.get(l.taxRateId) ?? 0) : 0;
    return { ...l, net, tax: round2(net * pct / 100) };
  });
}

const seriesFor = (t: DocType): DocType => t;

/**
 * Validate a payment's allocations against the live open balances and stage the
 * links to create after posting. Guards: each applied amount ≤ that document's
 * open balance, and total applied ≤ the payment amount. Over-application is
 * structurally impossible.
 */
async function prepareAllocations(
  orgId: string, side: "customer" | "vendor", input: PostDocInput, amt: number,
  pendingLinks: { toType: DocType; toId: string; relation: string; amount: number }[], toType: DocType,
) {
  const allocs = (input.allocations ?? []).filter(a => a.targetId && round2(a.amount) > 0);
  if (allocs.length === 0) return; // lump payment (unapplied) is allowed
  if (!input.partyId) err("To apply a payment to specific documents, pick the party from the list.");
  const open = await openDocsForParty(orgId, side, input.partyId);
  const openById = new Map(open.map(o => [o.id, o.open]));
  let sum = 0;
  for (const a of allocs) {
    const ob = openById.get(a.targetId);
    if (ob == null) err("An applied document was not found or is already settled.");
    if (round2(a.amount) > ob + 0.005) err(`Cannot apply more than the open balance (${ob.toFixed(2)}) of a document.`);
    sum = round2(sum + round2(a.amount));
  }
  if (sum > amt + 0.005) err("The amount applied to documents exceeds the payment amount.");
  for (const a of allocs) pendingLinks.push({ toType, toId: a.targetId, relation: "payment", amount: round2(a.amount) });
}

/**
 * Convert a set of lines (entered in `currency`) to the home currency the GL is
 * kept in. debit/credit become home amounts; the entered foreign amounts and
 * rate are preserved in fx_*. Per-line rounding can leave home debits ≠ credits
 * by a cent, so the largest line on the heavier side is nudged to re-balance.
 */
function toHome(lines: PostLine[], currency: string, rate: number, home: string): PostLine[] {
  if (currency === home || !(rate > 0) || rate === 1) return lines;
  const conv = lines.map(l => {
    const fd = l.debit ?? 0, fc = l.credit ?? 0;
    return {
      ...l,
      debit: fd ? round2(fd * rate) : 0,
      credit: fc ? round2(fc * rate) : 0,
      currency, exchangeRate: rate,
      fxDebit: fd || null, fxCredit: fc || null,
    } as PostLine;
  });
  const td = round2(conv.reduce((s, l) => s + (l.debit ?? 0), 0));
  const tc = round2(conv.reduce((s, l) => s + (l.credit ?? 0), 0));
  const diff = round2(td - tc);
  if (diff !== 0) {
    const side: "debit" | "credit" = diff > 0 ? "debit" : "credit";
    const target = conv.filter(l => (l[side] ?? 0) > 0).sort((a, b) => (b[side] ?? 0) - (a[side] ?? 0))[0];
    if (target) target[side] = round2((target[side] ?? 0) - Math.abs(diff));
  }
  return conv;
}

/**
 * Build lines + post. Returns the created journal entry (with entryNumber,
 * docNumber, txnNo). Throws LedgerValidationError with a clear message.
 */
export async function postDocument(orgId: string, input: PostDocInput, actorId: string | null) {
  const { type, date } = input;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) err("A valid date is required.");

  const [org] = await db.select({ home: organisations.currency, mc: organisations.multicurrencyEnabled })
    .from(organisations).where(eq(organisations.id, orgId)).limit(1);
  const home = org?.home ?? "PKR";
  const currency = (input.currency?.trim() || home).toUpperCase();
  const rate = currency === home ? 1 : (Number(input.exchangeRate) || 0);
  if (currency !== home) {
    if (!org?.mc) err("Enable multi-currency in Settings before entering a foreign-currency transaction.");
    if (!(rate > 0)) err("Enter a valid exchange rate.");
  }

  const lines: PostLine[] = [];
  const pendingLinks: { toType: DocType; toId: string; relation: string; amount: number }[] = [];
  const { arId, apId, taxId } = await controlAccounts(orgId);
  const name = (extra: Partial<PostLine>): Partial<PostLine> =>
    input.partyType && (input.partyId || input.partyLabel)
      ? { nameType: input.partyType, nameId: input.partyId ?? null, nameLabel: input.partyLabel ?? null, ...extra }
      : extra;

  const memo = input.memo?.trim() || null;

  // ── Line-item documents (sales & purchase) ────────────────────────────────
  const SALES = new Set<DocType>(["Invoice", "SalesReceipt", "CreditNote", "RefundReceipt"]);
  const PURCH = new Set<DocType>(["Bill", "Expense", "VendorCredit"]);

  if (SALES.has(type) || PURCH.has(type)) {
    const raw = (input.lines ?? []).filter(l => l.accountId && round2(l.amount) !== 0);
    if (raw.length === 0) err("Add at least one line with an account and amount.");
    const priced = await withTax(orgId, raw);
    const netTotal = round2(priced.reduce((s, l) => s + l.net, 0));
    const taxTotal = round2(priced.reduce((s, l) => s + l.tax, 0));
    const grand = round2(netTotal + taxTotal);
    if (taxTotal !== 0 && !taxId) err("No Sales Tax Payable account is set up.");

    const lineCommon = (l: typeof priced[number]) => ({
      description: l.description ?? null, classId: l.classId ?? null, locationId: l.locationId ?? null,
    });

    if (type === "Invoice" || type === "SalesReceipt") {
      for (const l of priced) lines.push({ accountId: l.accountId!, credit: l.net, ...lineCommon(l) });
      if (taxTotal) lines.push({ accountId: taxId!, credit: taxTotal, description: "Sales tax" });
      if (type === "Invoice") {
        if (!arId) err("No Accounts Receivable account is set up.");
        if (!input.partyId && !input.partyLabel) err("Select a customer.");
        lines.push(name({ accountId: arId!, debit: grand }) as PostLine);
      } else {
        if (!input.bankAccountId) err("Select the account to deposit to.");
        lines.push({ accountId: input.bankAccountId!, debit: grand, description: "Sales receipt" });
      }
    } else if (type === "CreditNote" || type === "RefundReceipt") {
      for (const l of priced) lines.push({ accountId: l.accountId!, debit: l.net, ...lineCommon(l) });
      if (taxTotal) lines.push({ accountId: taxId!, debit: taxTotal, description: "Sales tax" });
      if (type === "CreditNote") {
        if (!arId) err("No Accounts Receivable account is set up.");
        if (!input.partyId && !input.partyLabel) err("Select a customer.");
        lines.push(name({ accountId: arId!, credit: grand }) as PostLine);
      } else {
        if (!input.bankAccountId) err("Select the account to refund from.");
        lines.push({ accountId: input.bankAccountId!, credit: grand, description: "Refund" });
      }
    } else if (type === "Bill" || type === "Expense") {
      for (const l of priced) lines.push({ accountId: l.accountId!, debit: l.net, ...lineCommon(l) });
      if (taxTotal) lines.push({ accountId: taxId!, debit: taxTotal, description: "Input tax" });
      if (type === "Bill") {
        if (!apId) err("No Accounts Payable account is set up.");
        if (!input.partyId && !input.partyLabel) err("Select a supplier.");
        lines.push(name({ accountId: apId!, credit: grand }) as PostLine);
      } else {
        if (!input.bankAccountId) err("Select the account it was paid from.");
        lines.push({ accountId: input.bankAccountId!, credit: grand, description: "Expense" });
      }
    } else { // VendorCredit
      if (!apId) err("No Accounts Payable account is set up.");
      if (!input.partyId && !input.partyLabel) err("Select a supplier.");
      lines.push(name({ accountId: apId!, debit: grand }) as PostLine);
      for (const l of priced) lines.push({ accountId: l.accountId!, credit: l.net, ...lineCommon(l) });
      if (taxTotal) lines.push({ accountId: taxId!, credit: taxTotal, description: "Input tax" });
    }
  }

  // ── Money-movement documents ──────────────────────────────────────────────
  else if (type === "Payment") { // receive payment from a customer
    const amt = round2(input.amount ?? 0);
    if (amt <= 0) err("Enter a payment amount.");
    if (!input.bankAccountId) err("Select the account to deposit to.");
    if (!arId) err("No Accounts Receivable account is set up.");
    if (!input.partyId && !input.partyLabel) err("Select a customer.");
    await prepareAllocations(orgId, "customer", input, amt, pendingLinks, "Invoice");
    lines.push({ accountId: input.bankAccountId!, debit: amt, description: "Payment received" });
    lines.push(name({ accountId: arId!, credit: amt }) as PostLine);
  }
  else if (type === "BillPayment") { // pay a supplier
    const amt = round2(input.amount ?? 0);
    if (amt <= 0) err("Enter a payment amount.");
    if (!input.bankAccountId) err("Select the account it was paid from.");
    if (!apId) err("No Accounts Payable account is set up.");
    if (!input.partyId && !input.partyLabel) err("Select a supplier.");
    await prepareAllocations(orgId, "vendor", input, amt, pendingLinks, "Bill");
    lines.push(name({ accountId: apId!, debit: amt }) as PostLine);
    lines.push({ accountId: input.bankAccountId!, credit: amt, description: "Bill payment" });
  }
  else if (type === "Transfer") {
    const amt = round2(input.amount ?? 0);
    if (amt <= 0) err("Enter an amount to transfer.");
    if (!input.bankAccountId || !input.toBankAccountId) err("Select both the source and destination accounts.");
    if (input.bankAccountId === input.toBankAccountId) err("Source and destination must be different accounts.");
    lines.push({ accountId: input.toBankAccountId!, debit: amt, description: "Transfer in" });
    lines.push({ accountId: input.bankAccountId!, credit: amt, description: "Transfer out" });
  }
  else if (type === "Deposit") {
    const raw = (input.lines ?? []).filter(l => l.accountId && round2(l.amount) !== 0);
    if (raw.length === 0) err("Add at least one line with an account and amount.");
    if (!input.bankAccountId) err("Select the account to deposit to.");
    const total = round2(raw.reduce((s, l) => s + round2(l.amount), 0));
    for (const l of raw) lines.push({ accountId: l.accountId!, credit: round2(l.amount), description: l.description ?? null });
    lines.push({ accountId: input.bankAccountId!, debit: total, description: "Bank deposit" });
  }
  else {
    err(`Unsupported document type: ${type}`);
  }

  const entry = await postJournalEntry({
    orgId,
    entryDate: date,
    memo,
    docNumber: input.docNumber ?? null,
    series: seriesFor(type),
    sourceType: type,
    createdBy: actorId,
    dueDate: DATED_TYPES.has(type) ? resolveDueDate(date, input) : null,
    reference: input.reference?.trim() || null,
    lines: toHome(lines, currency, rate, home),
  });

  // Link the payment to each document it settled (many-to-1).
  for (const pl of pendingLinks) {
    await createLink(orgId, { fromType: type, fromId: entry.id, toType: pl.toType, toId: pl.toId, relation: pl.relation, amount: pl.amount }, actorId)
      .catch(e => console.error("[documents] link creation failed:", e));
  }
  return entry;
}
