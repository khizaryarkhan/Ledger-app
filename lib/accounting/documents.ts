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
import { accounts, apTaxRates, organisations, journalEntries, journalLines, transactionLinks, invoices, customers, apSuppliers, apBills, apBillLines } from "@/db/schema";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { postJournalEntry, validateEntry, LedgerValidationError, type PostLine } from "@/lib/ledger";
import type { DocType } from "@/lib/accounting/numbering";
import { ensureSystemAccounts } from "@/lib/accounting/system-accounts";
import { createLink, deleteLinksByContext } from "@/lib/accounting/links";
import { openDocsForParty, availableCreditsForParty } from "@/lib/accounting/payments";
import { loadItemCostInfo, planIssue, commitReceipt, commitIssue, reverseInventoryByEntry, type ItemCostInfo, type IssuePlan } from "@/lib/inventory/valuation";

export type DocLineInput = {
  accountId?: string;
  itemId?: string | null;          // inventory item (drives asset/COGS routing & lots)
  // Deliberately post this line somewhere other than the item's configured
  // account. Ignored for tracked purchases, where asset routing is mandatory.
  accountOverride?: boolean | null;
  description?: string | null;
  qty?: number | null;
  rate?: number | null;
  amount: number;                 // net line amount (before tax)
  taxRateId?: string | null;
  classId?: string | null;
  locationId?: string | null;
  lotNo?: string | null;           // purchase receipts: supplier lot/batch no.
  expiryDate?: string | null;      // purchase receipts: lot expiry
};

export type PostDocInput = {
  type: DocType;
  date: string;                   // YYYY-MM-DD
  docNumber?: string | null;
  memo?: string | null;
  paymentMethod?: string | null;  // Payment / BillPayment method (structured)
  partyType?: "Customer" | "Vendor" | null;
  partyId?: string | null;
  partyLabel?: string | null;
  bankAccountId?: string | null;   // deposit-to / paid-from / transfer source
  toBankAccountId?: string | null; // transfer destination
  amount?: number | null;          // payment / bill payment / transfer amount
  currency?: string | null;        // transaction currency (defaults to home)
  exchangeRate?: number | null;    // 1 {currency} = {rate} {home}; required when foreign
  allocations?: { targetId: string; amount: number }[]; // payment/bill-payment → invoices/bills
  creditApplications?: { sourceType?: string; sourceId: string; amount: number }[]; // draw down unapplied credits
  dueDate?: string | null;         // Invoice/Bill: when payable (aging basis)
  termsDays?: number | null;       // if dueDate omitted, due = date + termsDays
  reference?: string | null;       // supplier bill no. / customer PO / free ref
  lines?: DocLineInput[];
  sweptPaymentIds?: string[];      // Deposit: native Payment entry ids being swept into this deposit
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
  const invAsset = bySub("Inventory");
  const invCogs = bySub("SuppliesMaterialsCogs") ?? byType("Cost of Goods Sold");
  const fx = bySub("ExchangeGainOrLoss");
  return { arId: ar?.id ?? null, apId: ap?.id ?? null, taxId: tax?.id ?? null, invAssetId: invAsset?.id ?? null, invCogsId: invCogs?.id ?? null, fxId: fx?.id ?? null };
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

/** Line-item document types that can be edited in place. */
export const EDITABLE_TYPES = new Set<DocType>(["Invoice", "SalesReceipt", "CreditNote", "RefundReceipt", "Bill", "Expense", "VendorCredit"]);
/** Payments can also be edited — reallocated / amount corrected. */
export const PAYMENT_TYPES = new Set<DocType>(["Payment", "BillPayment"]);
/** Types whose form input we persist so they can be reopened for editing. */
export const EDIT_PAYLOAD_TYPES = new Set<DocType>([...EDITABLE_TYPES, ...PAYMENT_TYPES]);

/**
 * Build the double-entry lines for a sales/purchase document from its form
 * input. Shared by create (postDocument) and edit (updateDocument) so both
 * apply identical accounting rules. Returns transaction-currency lines.
 */
async function buildSalesPurchaseLines(orgId: string, type: DocType, input: PostDocInput, arId: string | null, apId: string | null, taxId: string | null, itemMap?: Map<string, ItemCostInfo>, invAssetId?: string | null): Promise<PostLine[]> {
  const lines: PostLine[] = [];
  const name = (extra: Partial<PostLine>): Partial<PostLine> =>
    input.partyType && (input.partyId || input.partyLabel)
      ? { nameType: input.partyType, nameId: input.partyId ?? null, nameLabel: input.partyLabel ?? null, ...extra }
      : extra;
  // ── The account a line posts to is DERIVED FROM ITS ITEM, not from the
  // client ────────────────────────────────────────────────────────────────
  // An item carries the accounts it is defined to post through (revenue on
  // sale, expense or inventory asset on purchase). When a line names an item,
  // those accounts ARE the answer — a caller must not be able to redirect an
  // item's postings to an arbitrary account, whether by editing a dropdown or
  // by POSTing a hand-built payload. Letting that through silently corrupts
  // per-item revenue/COGS reporting and, for tracked items, breaks the
  // inventory subledger ↔ GL tie-out (stock moves one way, money another).
  //
  // Only when the item has no account configured for this direction do we fall
  // back to the account the caller supplied, so items that predate this rule
  // (or that were never fully set up) still post rather than hard-failing.
  // An override IS allowed, but only deliberately (`accountOverride`), never by
  // silently sending a different account — a real chart sometimes needs one
  // item posted somewhere else for a single document.
  const isSale = type === "Invoice" || type === "SalesReceipt" || type === "CreditNote" || type === "RefundReceipt";
  const accountFor = (l: DocLineInput): string | undefined => {
    const it = l.itemId && itemMap ? itemMap.get(l.itemId) : undefined;
    if (!it) return l.accountId;                       // no item → caller's account stands
    // NOT overridable: buying a stock-tracked item capitalises to its inventory
    // asset because a FIFO lot is created against that account. Sending the
    // debit elsewhere would raise stock in the subledger with no matching
    // movement in the GL — a break that never self-corrects.
    if (!isSale && it.tracked) return it.assetAccountId ?? invAssetId ?? l.accountId;
    if (l.accountOverride && l.accountId) return l.accountId;
    return (isSale ? it.incomeAccountId : it.expenseAccountId) ?? l.accountId;
  };
  // Resolve first, THEN drop empty lines — so a line that names an item but no
  // account still posts (it previously vanished from the entry in silence).
  const raw = (input.lines ?? [])
    .map(l => ({ ...l, accountId: accountFor(l) }))
    .filter(l => l.accountId && round2(l.amount) !== 0);
  if (raw.length === 0) err("Add at least one line with an account and amount.");
  const priced = await withTax(orgId, raw);
  const netTotal = round2(priced.reduce((s, l) => s + l.net, 0));
  const taxTotal = round2(priced.reduce((s, l) => s + l.tax, 0));
  const grand = round2(netTotal + taxTotal);
  if (taxTotal !== 0 && !taxId) err("No Sales Tax Payable account is set up.");
  const lineCommon = (l: typeof priced[number]) => ({ description: l.description ?? null, classId: l.classId ?? null, locationId: l.locationId ?? null });

  if (type === "Invoice" || type === "SalesReceipt") {
    for (const l of priced) lines.push({ accountId: l.accountId!, credit: l.net, ...lineCommon(l) });
    if (taxTotal) lines.push({ accountId: taxId!, credit: taxTotal, description: "Sales tax" });
    if (type === "Invoice") {
      if (!arId) err("No Accounts Receivable account is set up.");
      // An invoice needs a REAL customer, not just a typed name. QBO mandates
      // CustomerRef on an Invoice for the same reason: a receivable you can't
      // attribute to a customer record can't be aged, chased or collected.
      // It also used to post to A/R while bridgeNativeInvoice silently skipped
      // it (that bridge returns early without a partyId), leaving the amount
      // in the ledger and invisible to collections — see the "posted-but-
      // unbridged" check in scripts/reconcile-foundation.ts.
      if (!input.partyId) err("Choose the customer from the list — an invoice must be linked to a customer record so it can be collected.");
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
  return lines;
}

// ── Perpetual inventory (FIFO) for sales & purchases ──────────────────────────
// Sales relieve stock to COGS at exact lot cost (extra home-currency GL lines);
// purchases create receipt lots (the Dr Inventory is already in the base lines).

const SALES_STOCK = new Set<DocType>(["Invoice", "SalesReceipt"]);
const PURCH_STOCK = new Set<DocType>(["Bill", "Expense"]);

type InvPlan = {
  extraHomeLines: PostLine[];
  issues: { line: DocLineInput; item: ItemCostInfo; plan: IssuePlan }[];
  receipts: { line: DocLineInput; item: ItemCostInfo; unitCost: number }[];
};

/** Build item map for a document's lines (costing metadata). */
async function itemMapForInput(orgId: string, input: PostDocInput): Promise<Map<string, ItemCostInfo>> {
  return loadItemCostInfo(orgId, (input.lines ?? []).map(l => l.itemId ?? "").filter(Boolean) as string[]);
}

/**
 * Plan the inventory side of a sales/purchase document (read-only). For sales,
 * returns the COGS/Inventory GL lines to append (home currency) plus the lot
 * issues to commit. For purchases, returns the receipt lots to create.
 */
async function planDocumentInventory(orgId: string, type: DocType, input: PostDocInput, itemMap: Map<string, ItemCostInfo>, invAssetId: string | null, invCogsId: string | null, rate: number): Promise<InvPlan> {
  const plan: InvPlan = { extraHomeLines: [], issues: [], receipts: [] };
  const stockLines = (input.lines ?? []).filter(l => l.itemId && itemMap.get(l.itemId)?.tracked && Math.abs(Number(l.qty) || 0) > 0);

  if (SALES_STOCK.has(type)) {
    for (const l of stockLines) {
      const item = itemMap.get(l.itemId!)!;
      const issue = await planIssue(orgId, item, Number(l.qty) || 0);
      if (issue.totalCost <= 0) continue;
      const cogsAcct = item.cogsAccountId ?? invCogsId;
      const assetAcct = item.assetAccountId ?? invAssetId;
      if (!cogsAcct || !assetAcct) continue; // no routing — skip cost relief rather than mispost
      // Lot costs are already in home currency, so COGS/relief are home amounts.
      plan.extraHomeLines.push({ accountId: cogsAcct, debit: round2(issue.totalCost), description: `Cost of goods sold — ${item.name}` });
      plan.extraHomeLines.push({ accountId: assetAcct, credit: round2(issue.totalCost), description: `Inventory relief — ${item.name}` });
      plan.issues.push({ line: l, item, plan: issue });
    }
  } else if (PURCH_STOCK.has(type)) {
    for (const l of stockLines) {
      const item = itemMap.get(l.itemId!)!;
      // Only capitalise (create a lot) when the GL debit was actually routed to
      // an inventory asset account — matches buildSalesPurchaseLines' fallback.
      const assetAcct = item.assetAccountId ?? invAssetId;
      if (!assetAcct) continue;
      const qty = Math.abs(Number(l.qty) || 0);
      // Store the lot cost in HOME currency to match the home-currency GL debit
      // (l.amount is transaction currency; rate converts to home).
      const unitCost = qty > 0 ? (round2(l.amount) * rate) / qty : 0;
      plan.receipts.push({ line: l, item, unitCost });
    }
  }
  return plan;
}

/** Commit the planned inventory movements once the journal entry exists. */
async function commitDocumentInventory(orgId: string, type: DocType, plan: InvPlan, entryId: string, refId: string, date: string, input: PostDocInput, actorId: string | null) {
  for (const r of plan.receipts) {
    await commitReceipt(orgId, {
      itemId: r.item.id, qty: Math.abs(Number(r.line.qty) || 0), unitCost: r.unitCost,
      productType: r.item.productType, lotNo: r.line.lotNo ?? null, expiryDate: r.line.expiryDate ?? null,
      supplierId: input.partyType === "Vendor" ? input.partyId ?? null : null,
      sourceType: "purchase", receivedDate: date, refType: type, refId, entryId, createdBy: actorId,
      note: r.line.description ?? null,
    }).catch(e => console.error("[inventory receipt]", e));
  }
  for (const iss of plan.issues) {
    await commitIssue(orgId, {
      itemId: iss.item.id, plan: iss.plan, movementType: "issue_sale",
      refType: type, refId, entryId, date, createdBy: actorId, note: iss.item.name,
    }).catch(e => console.error("[inventory issue]", e));
  }
}


/**
 * A customer/supplier's currency is set once (from its first transaction) and
 * then permanent — matches the same rule already shown in party-drawer.tsx for
 * the party record itself. Returns null if the party has no currency yet (or
 * no party was given), in which case any currency is still allowed.
 *
 * customers.currency/apSuppliers.currency are NOT NULL columns (a pre-existing
 * default of "EUR" — see db/schema.ts), so "not yet set" is represented as ""
 * (an explicit empty string), not `null` — the party-creation routes
 * (app/api/parties/[type], app/api/customers, app/api/payables/suppliers)
 * all write "" rather than leaving the column to its own default whenever
 * multi-currency is on. `|| null` (not `??`) below treats both the same.
 */
async function resolvePartyCurrency(orgId: string, partyType: "Customer" | "Vendor" | null | undefined, partyId: string | null | undefined): Promise<string | null> {
  if (!partyType || !partyId) return null;
  if (partyType === "Customer") {
    const [row] = await db.select({ currency: customers.currency }).from(customers).where(and(eq(customers.id, partyId), eq(customers.orgId, orgId))).limit(1);
    return row?.currency || null;
  }
  const [row] = await db.select({ currency: apSuppliers.currency }).from(apSuppliers).where(and(eq(apSuppliers.id, partyId), eq(apSuppliers.orgId, orgId))).limit(1);
  return row?.currency || null;
}

/** First transaction in a foreign currency assigns the party's currency — never overwrites one already set. */
async function lockPartyCurrency(orgId: string, partyType: "Customer" | "Vendor" | null | undefined, partyId: string | null | undefined, currency: string): Promise<void> {
  if (!partyType || !partyId) return;
  if (partyType === "Customer") {
    await db.update(customers).set({ currency }).where(and(eq(customers.id, partyId), eq(customers.orgId, orgId), sql`(${customers.currency} is null or ${customers.currency} = '')`));
  } else {
    await db.update(apSuppliers).set({ currency }).where(and(eq(apSuppliers.id, partyId), eq(apSuppliers.orgId, orgId), sql`(${apSuppliers.currency} is null or ${apSuppliers.currency} = '')`));
  }
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

type PendingLink = { fromType?: string; fromId?: string; toType: string; toId: string; relation: string; amount: number };

/**
 * Validate and plan a payment / bill payment: check open balances and credits,
 * then distribute each settled document (credits first, then cash) into links,
 * and build the cash entry lines. Shared by create and edit. `excludeContext`
 * ignores links created BY a given transaction when reading open balances — so
 * editing a payment sees the documents it currently settles as available again.
 *
 * Realized FX gain/loss: when an allocation settles a foreign-currency
 * invoice/bill, the control account (AR/AP) must clear at exactly the
 * invoice's OWN original rate (`homeAtOrig`), not this payment's rate —
 * otherwise it never nets to zero. The difference between that and what the
 * payment's own rate implies (`homeAtPay`) is the realized gain/loss, netted
 * across all allocations into one line on `ExchangeGainOrLoss` (already a
 * seeded system account — see controlAccounts' `fxId`). Credit-note/
 * overpayment application against a foreign invoice is deliberately out of
 * scope for now (a credit carries its own independent rate — its own FX
 * event, not solved here) — guarded by rejecting the combination outright
 * rather than silently computing a wrong number.
 */
async function settlePayment(orgId: string, type: DocType, input: PostDocInput, currency: string, rate: number, arId: string | null, apId: string | null, fxId: string | null, excludeContext?: string):
  Promise<{ amt: number; cashLines: PostLine[]; pendingLinks: PendingLink[]; extraHomeLines: PostLine[] }> {
  const isCust = type === "Payment";
  const side = isCust ? "customer" : "vendor";
  const invoiceType = isCust ? "Invoice" : "Bill";
  const controlId = isCust ? arId : apId;
  const amt = round2(input.amount ?? 0); // in `currency` (the party's currency when locked, else home)
  if (!controlId) err(`No ${isCust ? "Accounts Receivable" : "Accounts Payable"} account is set up.`);
  if (!input.partyId && !input.partyLabel) err(isCust ? "Select a customer." : "Select a supplier.");
  if (amt > 0 && !input.bankAccountId) err(isCust ? "Select the account to deposit to." : "Select the account it was paid from.");

  const allocs = (input.allocations ?? []).filter(a => a.targetId && round2(a.amount) > 0);
  const creditApps = (input.creditApplications ?? []).filter(c => c.sourceId && round2(c.amount) > 0);

  let allocatedForeignSum = 0; // sum of allocs' entered amounts, in `currency`
  // Home-currency equivalent of each allocation (at ITS OWN invoice's original
  // rate) — kept in a side map rather than overwriting `a.amount`, since
  // `input` (allocations included) is stored verbatim as sourcePayload for
  // editing later; mutating it would show the wrong (home, not foreign)
  // amount if this payment is ever reopened for edit.
  const homeAllocById = new Map<string, number>();
  if (allocs.length) {
    if (!input.partyId) err("Pick the party from the list to apply to specific documents.");
    const openRows = await openDocsForParty(orgId, side, input.partyId, excludeContext);
    const openById = new Map(openRows.map(o => [o.id, o]));
    const anyForeign = allocs.some(a => openById.get(a.targetId)?.origCurrency);
    if (anyForeign && creditApps.length) err("Applying an existing credit alongside a foreign-currency settlement isn't supported yet — settle this one by cash only.");
    for (const a of allocs) {
      const o = openById.get(a.targetId);
      if (!o) err("An applied document was not found or is already settled.");
      if (o!.origCurrency && o!.origCurrency !== currency) err(`This ${invoiceType.toLowerCase()} was raised in ${o!.origCurrency} — settle it with a payment entered in ${o!.origCurrency}.`);
      const foreignAmt = round2(a.amount);
      if (foreignAmt > o!.openFx + 0.005) err(`Cannot apply more than the open balance (${o!.openFx.toFixed(2)}) of a document.`);
      allocatedForeignSum = round2(allocatedForeignSum + foreignAmt);
      homeAllocById.set(a.targetId, round2(foreignAmt * o!.origRate));
    }
  }
  if (creditApps.length) {
    if (!input.partyId) err("Pick the party from the list to apply credits.");
    const byId = new Map((await availableCreditsForParty(orgId, side, input.partyId, excludeContext)).map(c => [c.id, c]));
    for (const c of creditApps) {
      const src = byId.get(c.sourceId);
      if (!src) err("A selected credit is no longer available.");
      if (round2(c.amount) > src!.open + 0.005) err(`Cannot apply more than a credit's remaining amount (${src!.open.toFixed(2)}).`);
      c.sourceType = src!.sourceType;
    }
  }

  const totalAlloc = round2([...homeAllocById.values()].reduce((s, v) => s + v, 0)); // home currency
  const totalCredit = round2(creditApps.reduce((s, c) => s + round2(c.amount), 0)); // home currency, unchanged
  if (totalCredit > totalAlloc + 0.005) err("Credits applied exceed the amount being settled.");
  const cashNeeded = round2(totalAlloc - totalCredit); // home currency
  const amtHome = round2(amt * rate);
  if (amtHome + 0.005 < cashNeeded) err("Amount received is less than the amount being settled after credits.");
  if (amt <= 0 && creditApps.length === 0) err("Enter an amount received.");

  const pendingLinks: PendingLink[] = [];
  const queue = creditApps.map(c => ({ sourceType: c.sourceType!, sourceId: c.sourceId, left: round2(c.amount) }));
  for (const a of allocs) {
    let need = homeAllocById.get(a.targetId)!; // home currency
    for (const q of queue) {
      if (need <= 0.005) break;
      const take = round2(Math.min(need, q.left));
      if (take > 0) { pendingLinks.push({ fromType: q.sourceType, fromId: q.sourceId, toType: invoiceType, toId: a.targetId, relation: "credit", amount: take }); q.left = round2(q.left - take); need = round2(need - take); }
    }
    if (need > 0.005) pendingLinks.push({ toType: invoiceType, toId: a.targetId, relation: "payment", amount: need });
  }

  const nm = (extra: Partial<PostLine>): Partial<PostLine> =>
    input.partyType && (input.partyId || input.partyLabel)
      ? { nameType: input.partyType, nameId: input.partyId ?? null, nameLabel: input.partyLabel ?? null, ...extra } : extra;

  // Everything here is already home currency and bypasses toHome() entirely
  // (cashLines is always empty — see the note below on why the bank leg
  // can't go through toHome() either, once the control/FX legs live outside
  // of it): toHome()'s own rebalancer assumes it's converting a COMPLETE,
  // already-balanced set of lines, and "fixes" any imbalance by nudging the
  // largest line — feeding it just the bank leg on its own reads as a huge
  // imbalance and zeroes that line out. So the bank leg converts directly
  // here too, using the exact same round2(amt*rate) toHome() would have
  // produced (amtHome, already computed below).
  const cashLines: PostLine[] = [];
  const extraHomeLines: PostLine[] = [];
  if (amt > 0) {
    if (isCust) extraHomeLines.push({ accountId: input.bankAccountId!, debit: amtHome, description: "Payment received" });
    else extraHomeLines.push({ accountId: input.bankAccountId!, credit: amtHome, description: "Bill payment" });
    // Cash beyond what's tied to a specific invoice (over-receipt/on-account)
    // has no "original rate" to honour — it converts at the payment's own rate.
    const unallocatedForeign = round2(amt - allocatedForeignSum);
    const unallocatedHome = round2(unallocatedForeign * rate);
    const controlHome = round2(totalAlloc + unallocatedHome);
    if (Math.abs(controlHome) > 0.005) {
      extraHomeLines.push(nm(isCust ? { accountId: controlId!, credit: controlHome } : { accountId: controlId!, debit: controlHome }) as PostLine);
    }
    // The FX line is whatever's left to balance the bank + control legs
    // already pushed above. This single "residue" *is* the realized gain/
    // loss (algebraically: bank + control nets to exactly the FX effect, for
    // both allocated-at-original-rate and unallocated cash) — and it also
    // absorbs any stray sub-cent rounding, the same nudge-the-plug-line
    // technique toHome() itself uses.
    if (fxId) {
      const currentSigned = extraHomeLines.reduce((s, l) => s + (l.debit ?? 0) - (l.credit ?? 0), 0);
      const residue = round2(-currentSigned);
      if (Math.abs(residue) > 0.005) {
        extraHomeLines.push(nm(residue > 0
          ? { accountId: fxId, debit: residue, description: "Realized exchange gain/loss" }
          : { accountId: fxId, credit: -residue, description: "Realized exchange gain/loss" }) as PostLine);
      }
    }
  }
  return { amt, cashLines, pendingLinks, extraHomeLines };
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
  const partyCcy = await resolvePartyCurrency(orgId, input.partyType, input.partyId);
  if (partyCcy && partyCcy !== currency) {
    err(`This ${input.partyType === "Vendor" ? "supplier's" : "customer's"} currency is ${partyCcy} — transactions for them must be entered in ${partyCcy}.`);
  }
  if (currency !== home) {
    if (!org?.mc) err("Enable multi-currency in Settings before entering a foreign-currency transaction.");
    if (!(rate > 0)) err("Enter a valid exchange rate.");
  }

  const lines: PostLine[] = [];
  // Links to create after posting. fromType/fromId default to the new entry
  // (cash payment); credit applications set them to the credit source instead.
  const pendingLinks: { fromType?: string; fromId?: string; toType: string; toId: string; relation: string; amount: number }[] = [];
  const { arId, apId, taxId, invAssetId, invCogsId, fxId } = await controlAccounts(orgId);
  const memo = input.memo?.trim() || null;
  let invPlan: InvPlan | null = null;
  let paymentExtraLines: PostLine[] = [];

  // ── Line-item documents (sales & purchase) ────────────────────────────────
  const SALES = new Set<DocType>(["Invoice", "SalesReceipt", "CreditNote", "RefundReceipt"]);
  const PURCH = new Set<DocType>(["Bill", "Expense", "VendorCredit"]);

  if (SALES.has(type) || PURCH.has(type)) {
    const itemMap = await itemMapForInput(orgId, input);
    lines.push(...await buildSalesPurchaseLines(orgId, type, input, arId, apId, taxId, itemMap, invAssetId));
    invPlan = await planDocumentInventory(orgId, type, input, itemMap, invAssetId, invCogsId, rate);
  }

  // ── Money-movement documents ──────────────────────────────────────────────
  else if (type === "Payment" || type === "BillPayment") {
    const s = await settlePayment(orgId, type, input, currency, rate, arId, apId, fxId);
    lines.push(...s.cashLines);
    pendingLinks.push(...s.pendingLinks);
    paymentExtraLines = s.extraHomeLines;
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

    // Sweeping a Payment into this deposit is a TRACEABILITY link only — it
    // does not alter either side's postings. Native Payments already post Dr
    // Bank/Cr A(R) directly (there is no Undeposited Funds clearing account in
    // the native model, unlike QBO), so this simply records "this deposit
    // physically bundled these already-posted payments" for audit/navigation,
    // the same way QBO's LinkedTxn lets you jump from a Deposit to the Payment
    // it swept. The swept amount is read from the payment's own posting, never
    // trusted from the client.
    for (const paymentId of new Set(input.sweptPaymentIds ?? [])) {
      const [payEntry] = await db.select().from(journalEntries)
        .where(and(eq(journalEntries.id, paymentId), eq(journalEntries.orgId, orgId), eq(journalEntries.sourceType, "Payment")))
        .limit(1);
      if (!payEntry) err("A selected payment to sweep was not found.");
      const [sum] = await db.select({ total: sql<string>`sum(${journalLines.debit})` })
        .from(journalLines).where(eq(journalLines.entryId, paymentId));
      const amount = round2(Number(sum?.total ?? 0));
      if (amount > 0) pendingLinks.push({ toType: "Payment", toId: paymentId, relation: "deposit_sweep", amount });
    }
  }
  else {
    err(`Unsupported document type: ${type}`);
  }

  // A pure credit application (payment with no cash) posts no journal entry —
  // it's a re-allocation of existing AR/AP credits, recorded via links only.
  // (Payment/BillPayment's cash+control+FX lines all live in
  // paymentExtraLines now, not `lines` — see settlePayment.)
  let entry: Awaited<ReturnType<typeof postJournalEntry>> | null = null;
  if (lines.length > 0 || paymentExtraLines.length > 0) {
    // Inventory cost lines (COGS/relief) are already home currency — append them
    // after FX conversion so the rate isn't applied to them a second time.
    const homeLines = toHome(lines, currency, rate, home);
    if (invPlan) homeLines.push(...invPlan.extraHomeLines);
    homeLines.push(...paymentExtraLines);
    entry = await postJournalEntry({
      orgId,
      entryDate: date,
      memo,
      docNumber: input.docNumber ?? null,
      series: seriesFor(type),
      sourceType: type,
      createdBy: actorId,
      dueDate: DATED_TYPES.has(type) ? resolveDueDate(date, input) : null,
      reference: input.reference?.trim() || null,
      paymentMethod: PAYMENT_TYPES.has(type) ? (input.paymentMethod?.trim() || null) : null,
      sourcePayload: EDIT_PAYLOAD_TYPES.has(type) ? input : null,
      lines: homeLines,
    });
  }

  // Commit the FIFO lot movements now the entry id exists.
  if (invPlan && entry) await commitDocumentInventory(orgId, type, invPlan, entry.id, entry.id, date, input, actorId);

  // Create the settlement links (cash from the new entry, credits from their
  // source documents) — everything the open balances are derived from.
  for (const pl of pendingLinks) {
    const fromId = pl.fromId ?? entry?.id;
    if (!fromId) continue;
    await createLink(orgId, { fromType: pl.fromType ?? type, fromId, toType: pl.toType, toId: pl.toId, relation: pl.relation, amount: pl.amount, contextEntryId: entry?.id ?? fromId }, actorId)
      .catch(e => console.error("[documents] link creation failed:", e));
  }

  // First transaction for a party assigns its currency going forward.
  if (entry && org?.mc && !partyCcy) await lockPartyCurrency(orgId, input.partyType, input.partyId, currency).catch(e => console.error("[lock party currency]", e));

  // Mirror native invoices into the Receivable module and native bills into the
  // Payables module, and keep any invoices a payment just settled in sync.
  if (entry && type === "Invoice") await bridgeNativeInvoice(orgId, entry.id, entry.docNumber, input, home).catch(e => console.error("[bridge invoice]", e));
  if (entry && type === "Bill") await bridgeNativeBill(orgId, entry.id, entry.docNumber, input, home).catch(e => console.error("[bridge bill]", e));
  if (entry && type === "Payment") {
    for (const id of [...new Set(pendingLinks.filter(pl => pl.toType === "Invoice").map(pl => pl.toId))]) await syncNativeInvoicePaid(orgId, id).catch(() => {});
  }
  return entry ?? ({ id: null, docNumber: null, txnNo: null } as any);
}

/**
 * Edit a posted line-item document IN PLACE (Invoice/Bill/Credit note/…). The
 * ledger stays consistent: we rebuild the double-entry from the new form input
 * and replace the entry's lines, keeping its identity (id, TXN no, entry no,
 * type). Guarded — a document that is reversed, in a closed period, or already
 * linked to payments/credits can't be silently edited (reverse it instead).
 */
export async function updateDocument(orgId: string, entryId: string, input: PostDocInput, actorId: string | null) {
  const [entry] = await db.select().from(journalEntries)
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.orgId, orgId))).limit(1);
  if (!entry) err("Transaction not found.");
  const type = entry.sourceType as DocType;
  const isPayment = PAYMENT_TYPES.has(type);
  if (!EDITABLE_TYPES.has(type) && !isPayment) err("This transaction type can't be edited in place — reverse it and re-enter instead.");
  if (entry.status === "Reversed") err("This transaction has been reversed and can't be edited.");

  const date = input.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) err("A valid date is required.");
  const [org] = await db.select({ home: organisations.currency, mc: organisations.multicurrencyEnabled, lock: organisations.bookCloseDate })
    .from(organisations).where(eq(organisations.id, orgId)).limit(1);
  const lock = org?.lock ?? null;
  if (lock && (entry.entryDate <= lock || date <= lock)) err(`The books are closed through ${lock}. Reopen the period to edit here.`);

  const home = org?.home ?? "PKR";
  const currency = (input.currency?.trim() || home).toUpperCase();
  const rate = currency === home ? 1 : (Number(input.exchangeRate) || 0);
  const partyCcy = await resolvePartyCurrency(orgId, input.partyType, input.partyId);
  if (partyCcy && partyCcy !== currency) {
    err(`This ${input.partyType === "Vendor" ? "supplier's" : "customer's"} currency is ${partyCcy} — transactions for them must be entered in ${partyCcy}.`);
  }
  if (currency !== home) {
    if (!org?.mc) err("Enable multi-currency before entering a foreign-currency transaction.");
    if (!(rate > 0)) err("Enter a valid exchange rate.");
  }
  const { arId, apId, taxId, invAssetId, invCogsId, fxId } = await controlAccounts(orgId);

  let built: PostLine[];
  let pendingLinks: PendingLink[] = [];
  let invPlan: InvPlan | null = null;

  if (isPayment) {
    // The payment's unapplied credit must not have been used elsewhere.
    const foreign = await db.select({ id: transactionLinks.id }).from(transactionLinks)
      .where(and(eq(transactionLinks.orgId, orgId), eq(transactionLinks.fromId, entryId), sql`${transactionLinks.contextEntryId} is distinct from ${entryId}`)).limit(1);
    if (foreign.length) err("This payment's credit has been applied to another transaction — undo that first, or reverse this payment.");
    // Plan the new settlement, ignoring this payment's own current links.
    const s = await settlePayment(orgId, type, input, currency, rate, arId, apId, fxId, entryId);
    if (s.amt <= 0) err("A payment needs an amount received — to remove it entirely, reverse it instead.");
    built = toHome(s.cashLines, currency, rate, home);
    built.push(...s.extraHomeLines);
    pendingLinks = s.pendingLinks;
    await validateEntry(orgId, built); // payment: balance + account checks before we touch stored data
  } else {
    // Line-item document: block if anything downstream references it.
    const [link] = await db.select({ id: transactionLinks.id }).from(transactionLinks)
      .where(and(eq(transactionLinks.orgId, orgId), or(eq(transactionLinks.fromId, entryId), eq(transactionLinks.toId, entryId)))).limit(1);
    if (link) err("This document has payments or credits applied to it — remove those first, or reverse it.");
    const itemMap = await itemMapForInput(orgId, input);
    built = toHome(await buildSalesPurchaseLines(orgId, type, input, arId, apId, taxId, itemMap, invAssetId), currency, rate, home);
    // Validate the base entry (balance + accounts) BEFORE mutating inventory —
    // a bad edit (missing customer, zero lines) must not strand the lots.
    await validateEntry(orgId, built);
    // Now safe to unwind this document's prior inventory (blocked if the stock
    // has since been consumed) and re-plan against the restored FIFO lots.
    try { await reverseInventoryByEntry(orgId, entryId); }
    catch (e: any) { err(e?.message || "Inventory from this document has already been used — reverse it instead of editing."); }
    invPlan = await planDocumentInventory(orgId, type, input, itemMap, invAssetId, invCogsId, rate);
    if (invPlan) built.push(...invPlan.extraHomeLines); // balanced Dr/Cr pairs — entry stays balanced
  }

  await db.update(journalEntries).set({
    entryDate: date,
    memo: input.memo?.trim() || null,
    docNumber: input.docNumber?.trim() || entry.docNumber,
    dueDate: DATED_TYPES.has(type) ? resolveDueDate(date, input) : null,
    reference: input.reference?.trim() || null,
    sourcePayload: input,
  }).where(eq(journalEntries.id, entryId));

  await db.delete(journalLines).where(and(eq(journalLines.orgId, orgId), eq(journalLines.entryId, entryId)));
  await db.insert(journalLines).values(built.map((l, i) => ({
    orgId, entryId, lineNo: i + 1, accountId: l.accountId,
    description: l.description ?? null,
    debit: round2(Number(l.debit ?? 0)).toFixed(2), credit: round2(Number(l.credit ?? 0)).toFixed(2),
    classId: l.classId ?? null, locationId: l.locationId ?? null,
    customerId: l.customerId ?? (l.nameType === "Customer" ? l.nameId ?? null : null),
    nameType: l.nameType ?? null, nameId: l.nameId ?? null, nameLabel: l.nameLabel ?? null,
    currency: l.currency ?? null, exchangeRate: l.exchangeRate != null ? String(l.exchangeRate) : null,
    fxDebit: l.fxDebit != null ? round2(Number(l.fxDebit)).toFixed(2) : null,
    fxCredit: l.fxCredit != null ? round2(Number(l.fxCredit)).toFixed(2) : null,
  })));

  // For payments: replace the settlement links (cash + credit) with the new plan.
  if (isPayment) {
    // Invoices this payment used to touch (to re-sync after reallocation).
    const oldTargets = await db.select({ toId: transactionLinks.toId, toType: transactionLinks.toType }).from(transactionLinks)
      .where(and(eq(transactionLinks.orgId, orgId), eq(transactionLinks.contextEntryId, entryId)));
    await deleteLinksByContext(orgId, entryId);
    for (const pl of pendingLinks) {
      await createLink(orgId, { fromType: pl.fromType ?? type, fromId: pl.fromId ?? entryId, toType: pl.toType, toId: pl.toId, relation: pl.relation, amount: pl.amount, contextEntryId: entryId }, actorId)
        .catch(e => console.error("[documents] link (edit) failed:", e));
    }
    const affected = new Set<string>([
      ...oldTargets.filter(t => t.toType === "Invoice").map(t => t.toId),
      ...pendingLinks.filter(pl => pl.toType === "Invoice").map(pl => pl.toId),
    ]);
    for (const id of affected) await syncNativeInvoicePaid(orgId, id).catch(() => {});
  } else if (type === "Invoice") {
    await bridgeNativeInvoice(orgId, entryId, input.docNumber?.trim() || entry.docNumber, input, home).catch(e => console.error("[bridge invoice edit]", e));
  } else if (type === "Bill") {
    await bridgeNativeBill(orgId, entryId, input.docNumber?.trim() || entry.docNumber, input, home).catch(e => console.error("[bridge bill edit]", e));
  }

  // Re-apply the inventory lot movements for the edited document.
  if (invPlan) await commitDocumentInventory(orgId, type, invPlan, entryId, entryId, date, input, actorId);

  return { id: entryId, docNumber: input.docNumber?.trim() || entry.docNumber, txnNo: entry.txnNo, edited: true };
}

// ── Receivable bridge ─────────────────────────────────────────────────────────
// A native Invoice is a receivable, so it must also appear in the Receivable /
// collections module (the `invoices` table). We upsert a linked row keyed by the
// GL entry id, and keep its paid status in sync from the links graph.

/** Create or update the collections `invoices` row for a native Invoice entry. */
async function bridgeNativeInvoice(orgId: string, entryId: string, docNumber: string | null, input: PostDocInput, home: string) {
  // Invoice posting now requires a picked customer (see buildLines), so this
  // can only be reached with one. Kept as a loud guard rather than a silent
  // return: skipping quietly is what left an 800k invoice in the A/R control
  // account with no receivable row and no way to notice.
  if (!input.partyId) {
    console.error(`[bridge invoice] entry ${entryId} has no partyId — receivable NOT mirrored into collections`);
    return;
  }
  // Count the same lines the GL entry posted. A line carrying an item but no
  // explicit account still posts (its account is derived from the item), so
  // filtering on accountId alone would understate the receivable against the
  // journal entry it mirrors.
  const priced = await withTax(orgId, (input.lines ?? []).filter(l => (l.accountId || l.itemId) && round2(l.amount) !== 0));
  const net = round2(priced.reduce((s, l) => s + l.net, 0));
  const tax = round2(priced.reduce((s, l) => s + l.tax, 0));
  const total = round2(net + tax);
  const dueDate = resolveDueDate(input.date, input) ?? input.date;
  const [existing] = await db.select({ id: invoices.id, paid: invoices.paid }).from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.journalEntryId, entryId))).limit(1);
  const common = {
    customerId: input.partyId, invoiceNumber: docNumber ?? "", invoiceDate: input.date, dueDate,
    currency: (input.currency?.trim() || home) as any, amount: net, taxAmount: tax, total,
    poNumber: input.reference?.trim() || null, txnType: "Invoice", source: "native", updatedAt: new Date(),
  };
  if (existing) {
    const paid = Number(existing.paid) || 0;
    await db.update(invoices).set({ ...common, paymentStatus: paid <= 0.005 ? "Unpaid" : paid >= total - 0.005 ? "Paid" : "Partially Paid" }).where(eq(invoices.id, existing.id));
  } else {
    await db.insert(invoices).values({ orgId, journalEntryId: entryId, paid: 0, paymentStatus: "Unpaid", ...common } as any);
  }
}

// ── Payable bridge ────────────────────────────────────────────────────────────
// The mirror of the receivable bridge above. A native Bill is a payable, so it
// must also appear in the Payables workflow module (`ap_bills`) — otherwise a
// bill posted through the accounting form is invisible to approvals, payment
// runs and the AP dashboard, which was the case until this bridge existed.
//
// Only source='native' bills are bridged this way. A bill mirrored from
// QBO/Xero/Sage already has its own `ap_bills` row written by the sync, and
// its ledger lives in the provider — posting or re-bridging those here would
// double-count the liability.

/** Create or update the Payables `ap_bills` row (+ lines) for a native Bill entry. */
async function bridgeNativeBill(orgId: string, entryId: string, docNumber: string | null, input: PostDocInput, home: string) {
  // Same line filter the GL entry used — a line carrying an item but no
  // explicit account still posts (its account comes from the item), so
  // filtering on accountId alone would understate the payable.
  const priced = await withTax(orgId, (input.lines ?? []).filter(l => (l.accountId || l.itemId) && round2(l.amount) !== 0));
  const net = round2(priced.reduce((s, l) => s + l.net, 0));
  const tax = round2(priced.reduce((s, l) => s + l.tax, 0));
  const total = round2(net + tax);
  const dueDate = resolveDueDate(input.date, input) ?? input.date;

  const [existing] = await db.select({ id: apBills.id, amountPaid: apBills.amountPaid }).from(apBills)
    .where(and(eq(apBills.orgId, orgId), eq(apBills.entryId, entryId))).limit(1);

  const paid = Number(existing?.amountPaid) || 0;
  const common = {
    supplierId: input.partyId ?? null,
    billNumber: docNumber ?? "",
    reference: input.reference?.trim() || null,
    billDate: input.date,
    dueDate,
    currency: (input.currency?.trim() || home) as any,
    subtotal: net, taxTotal: tax, total,
    balance: round2(total - paid),
    accountingPaymentStatus: paid <= 0.005 ? "Unpaid" : paid >= total - 0.005 ? "Paid" : "Partially Paid",
    source: "native",
    updatedAt: new Date(),
  };

  const billId = existing?.id ?? (await db.insert(apBills).values({
    orgId, entryId, amountPaid: 0,
    // Posted straight from the accounting form, so it has already been
    // "entered" by someone with posting rights — it joins the workflow at
    // Pending Review rather than as an unreviewed import.
    workflowStatus: "Pending Review",
    ...common,
  } as any).returning({ id: apBills.id }))[0].id;

  if (existing) await db.update(apBills).set(common as any).where(eq(apBills.id, billId));

  // Lines are a projection of the posted entry — rewrite them wholesale so an
  // edited bill can't leave stale lines behind (same delete+reinsert the GL
  // itself uses in updateDocument).
  await db.delete(apBillLines).where(and(eq(apBillLines.orgId, orgId), eq(apBillLines.billId, billId)));
  if (priced.length) {
    await db.insert(apBillLines).values(priced.map((l, i) => ({
      orgId, billId, lineNumber: i + 1,
      itemId: l.itemId ?? null,
      description: l.description ?? null,
      quantity: l.qty ?? 1,
      unitPrice: l.rate ?? l.net,
      accountId: l.accountId ?? null,
      taxRateId: l.taxRateId ?? null,
      classId: l.classId ?? null,
      departmentId: l.locationId ?? null,
      lineSubtotal: l.net, lineTax: l.tax, lineTotal: round2(l.net + l.tax),
    })) as any);
  }
}

/** Remove the bridged Payables row when its GL entry is deleted or reversed. */
async function unbridgeNativeBill(orgId: string, entryId: string) {
  await db.delete(apBills).where(and(eq(apBills.orgId, orgId), eq(apBills.entryId, entryId))); // lines cascade
}

/** Recompute a native invoice's paid/status from the links applied to its GL entry. */
export async function syncNativeInvoicePaid(orgId: string, invoiceEntryId: string) {
  const [inv] = await db.select({ id: invoices.id, total: invoices.total, collectionStage: invoices.collectionStage }).from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.journalEntryId, invoiceEntryId))).limit(1);
  if (!inv) return;
  // Sum what's applied, and take the date of the LATEST settling document.
  // paidAt must be the date the money actually moved, not the moment this
  // recompute happened — a back-dated payment previously stamped today, which
  // then made every historical-dated AR aging run wrong for this invoice.
  const [applied] = await db.select({
    amt: sql<string>`coalesce(sum(${transactionLinks.amount}),0)`,
    lastSettledOn: sql<string | null>`max(${journalEntries.entryDate})`,
  }).from(transactionLinks)
    .leftJoin(journalEntries, eq(journalEntries.id, transactionLinks.fromId))
    .where(and(eq(transactionLinks.orgId, orgId), eq(transactionLinks.toId, invoiceEntryId), inArray(transactionLinks.relation, ["payment", "credit"])));
  const total = Number(inv.total) || 0;
  const paid = round2(Math.min(Number(applied?.amt ?? 0), total));
  const fullyPaid = paid >= total - 0.005;
  // Settling an invoice in full takes it off the collections Board, the same
  // way the provider syncs do (lib/qbo-sync.ts). Only the terminal stage is
  // touched — a user's own stage choice is never overwritten — and it's undone
  // if the settlement is later removed, so a deleted payment reopens the case.
  const stage =
    fullyPaid && paid > 0.005 ? "Closed"
    : !fullyPaid && inv.collectionStage === "Closed" ? "New"
    : undefined;
  await db.update(invoices).set({
    paid,
    paymentStatus: paid <= 0.005 ? "Unpaid" : fullyPaid ? "Paid" : "Partially Paid",
    paidAt: paid > 0.005 ? (applied?.lastSettledOn ?? null) : null,
    ...(stage ? { collectionStage: stage } : {}),
    updatedAt: new Date(),
  }).where(eq(invoices.id, inv.id));
}

/**
 * Permanently delete a transaction (harder than Reverse — no audit trail).
 * Guarded: system entries (Reversal/Closing), reversed entries, closed periods,
 * and anything with payments/credits applied to it can't be deleted.
 */
export async function deleteDocument(orgId: string, entryId: string, _actorId: string | null) {
  const [entry] = await db.select().from(journalEntries)
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.orgId, orgId))).limit(1);
  if (!entry) err("Transaction not found.");
  if (entry.sourceType === "Reversal" || entry.sourceType === "Closing") err("System entries can't be deleted.");
  if (entry.status === "Reversed") err("This transaction has been reversed — it can't be deleted.");

  const [org] = await db.select({ lock: organisations.bookCloseDate }).from(organisations).where(eq(organisations.id, orgId)).limit(1);
  if (org?.lock && entry.entryDate <= org.lock) err(`The books are closed through ${org.lock}. Reopen the period to delete here.`);

  // Something applied TO this entry (a payment/credit) — don't orphan it.
  const [inbound] = await db.select({ id: transactionLinks.id }).from(transactionLinks)
    .where(and(eq(transactionLinks.orgId, orgId), eq(transactionLinks.toId, entryId), inArray(transactionLinks.relation, ["payment", "credit"]))).limit(1);
  if (inbound) err("This document has payments or credits applied to it — remove those or reverse it instead.");
  // This entry's unapplied credit is in use elsewhere.
  const [outUsed] = await db.select({ id: transactionLinks.id }).from(transactionLinks)
    .where(and(eq(transactionLinks.orgId, orgId), eq(transactionLinks.fromId, entryId), sql`${transactionLinks.contextEntryId} is distinct from ${entryId}`)).limit(1);
  if (outUsed) err("This transaction's credit has been applied elsewhere — undo that first, or reverse it.");

  // Which invoices this (payment) settled, to re-open after deletion.
  const settled = await db.select({ toId: transactionLinks.toId, toType: transactionLinks.toType }).from(transactionLinks)
    .where(and(eq(transactionLinks.orgId, orgId), eq(transactionLinks.contextEntryId, entryId)));

  // Unwind inventory lots/movements first — blocks if stock has been used on.
  try { await reverseInventoryByEntry(orgId, entryId); }
  catch (e: any) { err(e?.message || "Inventory from this document has already been used — reverse the later transactions first."); }

  await db.delete(transactionLinks).where(and(eq(transactionLinks.orgId, orgId), or(eq(transactionLinks.contextEntryId, entryId), eq(transactionLinks.fromId, entryId), eq(transactionLinks.toId, entryId))));
  await db.delete(invoices).where(and(eq(invoices.orgId, orgId), eq(invoices.journalEntryId, entryId)));
  await unbridgeNativeBill(orgId, entryId);
  await db.delete(journalLines).where(and(eq(journalLines.orgId, orgId), eq(journalLines.entryId, entryId)));
  await db.delete(journalEntries).where(and(eq(journalEntries.id, entryId), eq(journalEntries.orgId, orgId)));

  for (const t of settled) if (t.toType === "Invoice") await syncNativeInvoicePaid(orgId, t.toId).catch(() => {});
  return { id: entryId, deleted: true };
}

/** Keep the Receivable/Payable bridges consistent after an entry is reversed. */
export async function onEntryReversed(orgId: string, entryId: string) {
  const [e] = await db.select({ sourceType: journalEntries.sourceType }).from(journalEntries)
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.orgId, orgId))).limit(1);
  if (!e) return;
  // Restore FIFO lots this document moved. Best-effort — the GL reversal has
  // already posted, so a divergence (stock consumed downstream) is logged, not
  // thrown, for manual correction.
  await reverseInventoryByEntry(orgId, entryId).catch(e => console.error("[inventory reverse]", e));
  if (e.sourceType === "Invoice") {
    await db.delete(invoices).where(and(eq(invoices.orgId, orgId), eq(invoices.journalEntryId, entryId)));
  } else if (e.sourceType === "Bill") {
    await unbridgeNativeBill(orgId, entryId);
  } else if (e.sourceType === "Payment") {
    const targets = await db.select({ toId: transactionLinks.toId, toType: transactionLinks.toType }).from(transactionLinks)
      .where(and(eq(transactionLinks.orgId, orgId), eq(transactionLinks.contextEntryId, entryId)));
    await deleteLinksByContext(orgId, entryId);
    for (const t of targets) if (t.toType === "Invoice") await syncNativeInvoicePaid(orgId, t.toId).catch(() => {});
  }
}

/**
 * Reconstruct a line-item document's form input from its GL lines, for docs
 * posted before form payloads were stored. Lossless for account/amount/party/
 * dates; tax rate is matched back from the tax amount (best effort). qty/rate
 * and item aren't recoverable — the net amount stands in.
 */
async function reconstructLineItemPayload(orgId: string, entry: any): Promise<PostDocInput | null> {
  const type = entry.sourceType as DocType;
  if (!EDITABLE_TYPES.has(type)) return null;
  const rows = await db.select({
    accountId: journalLines.accountId, type: accounts.type, subtype: accounts.subtype,
    description: journalLines.description, nameType: journalLines.nameType, nameId: journalLines.nameId, nameLabel: journalLines.nameLabel,
    debit: journalLines.debit, credit: journalLines.credit, currency: journalLines.currency, exchangeRate: journalLines.exchangeRate,
    fxDebit: journalLines.fxDebit, fxCredit: journalLines.fxCredit, classId: journalLines.classId, locationId: journalLines.locationId,
  }).from(journalLines).innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalLines.orgId, orgId), eq(journalLines.entryId, entry.id)));

  const foreign = rows.some(r => r.currency);
  const rate = Number(rows.find(r => r.exchangeRate)?.exchangeRate ?? 1) || 1;
  const val = (r: any, side: "debit" | "credit") => foreign ? Number((side === "debit" ? r.fxDebit : r.fxCredit) ?? 0) : Number((side === "debit" ? r.debit : r.credit) ?? 0);
  const sales = type === "Invoice" || type === "SalesReceipt";
  const salesReverse = type === "CreditNote" || type === "RefundReceipt";
  const lineSide: "debit" | "credit" = sales ? "credit" : salesReverse ? "debit" : type === "VendorCredit" ? "credit" : "debit";
  const isCtrl = (r: any) => r.type === "Accounts Receivable" || r.type === "Accounts Payable";
  const isTax = (r: any) => r.subtype === "SalesTaxPayable";
  const isBank = (r: any) => r.type === "Bank" || r.type === "Credit Card";

  const lineRows = rows.filter(r => !isCtrl(r) && !isTax(r) && !isBank(r));
  const taxRow = rows.find(isTax);
  const bankRow = rows.find(isBank);
  const ctrlRow = rows.find(isCtrl);
  const net = round2(lineRows.reduce((s, r) => s + val(r, lineSide), 0));
  const taxAmt = taxRow ? round2(val(taxRow, lineSide)) : 0;

  // Match a single tax rate back from the amount.
  let taxRateId: string | null = null;
  if (taxAmt > 0 && net > 0) {
    const pct = round2(taxAmt / net * 100);
    const rates = await db.select({ id: apTaxRates.id, rate: apTaxRates.rate }).from(apTaxRates).where(eq(apTaxRates.orgId, orgId));
    taxRateId = rates.find(x => Math.abs((Number(x.rate) || 0) - pct) < 0.1)?.id ?? null;
  }

  return {
    type, date: entry.entryDate, docNumber: entry.docNumber, memo: entry.memo ?? null,
    reference: entry.reference ?? null, dueDate: entry.dueDate ?? null,
    partyType: (ctrlRow?.nameType as any) ?? (sales || salesReverse ? "Customer" : "Vendor"),
    partyId: ctrlRow?.nameId ?? null, partyLabel: ctrlRow?.nameLabel ?? null,
    bankAccountId: bankRow?.accountId ?? null,
    currency: foreign ? (rows.find(r => r.currency)?.currency ?? null) : null,
    exchangeRate: foreign ? rate : null,
    lines: lineRows.map(r => ({ accountId: r.accountId, description: r.description ?? null, amount: round2(val(r, lineSide)), taxRateId, classId: r.classId ?? null, locationId: r.locationId ?? null })),
  };
}

/** The form payload for reopening a document to edit (stored, or reconstructed). */
export async function documentPayload(orgId: string, entryId: string) {
  const [entry] = await db.select().from(journalEntries)
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.orgId, orgId))).limit(1);
  if (!entry) return null;
  const type = entry.sourceType as DocType;
  let payload: any = entry.sourcePayload ?? null;
  if (!payload && EDITABLE_TYPES.has(type)) payload = await reconstructLineItemPayload(orgId, entry).catch(() => null);
  const editable = EDIT_PAYLOAD_TYPES.has(type) && !!payload;
  return { sourceType: entry.sourceType, docNumber: entry.docNumber, status: entry.status, editable, payload };
}
