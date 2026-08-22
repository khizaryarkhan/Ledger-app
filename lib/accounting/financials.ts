/**
 * Financial statement engine — builds the Trial Balance, Profit & Loss and
 * Balance Sheet straight from the general ledger (journal_lines of Posted
 * entries), grouped into IFRS sections via the account-type taxonomy.
 *
 * Money is stored as numeric(14,2) → strings in Drizzle; coerced with Number().
 * Only Posted entries count (reversals net themselves out because the reversal
 * is a separate Posted entry with the opposite sides).
 *
 * Net income & closing: with no period close yet, income/expense accounts hold
 * all-time balances, so the Balance Sheet's equity carries a computed
 * "Profit for the period" line = all-time (Income − Expense) to the report
 * date. That is exactly what makes A = E + L balance, and it splits into
 * Retained Earnings (closed years) + current-year profit once period close
 * ships. Fiscal-year handling is calendar-year for now (configurable later).
 */

import { db } from "@/db";
import { journalLines, journalEntries, accounts } from "@/db/schema";
import { and, eq, ne, inArray, gte, lte, sql } from "drizzle-orm";
import { typeDef, type Classification, type Statement } from "./account-types";

export type AccountBalance = {
  accountId: string; name: string; code: string | null;
  type: string | null; classification: string | null;
  debit: number; credit: number;   // period movements
};

type Placed = { statement: Statement; section: string; normal: "debit" | "credit" };

export function place(type: string | null, classification: string | null): Placed {
  const def = typeDef(type);
  if (def) return { statement: def.statement, section: def.section, normal: def.normalBalance };
  switch (classification as Classification) {
    case "Asset":     return { statement: "balance_sheet", section: "Current Assets", normal: "debit" };
    case "Liability": return { statement: "balance_sheet", section: "Current Liabilities", normal: "credit" };
    case "Equity":    return { statement: "balance_sheet", section: "Equity", normal: "credit" };
    case "Revenue":   return { statement: "profit_loss", section: "Revenue", normal: "credit" };
    case "Expense":   return { statement: "profit_loss", section: "Operating Expenses", normal: "debit" };
    default:          return { statement: "balance_sheet", section: "Current Assets", normal: "debit" };
  }
}

/** Signed balance in the account's natural direction (positive = normal side). */
function natural(b: AccountBalance): number {
  const { normal } = place(b.type, b.classification);
  const n = normal === "debit" ? b.debit - b.credit : b.credit - b.debit;
  return Math.round(n * 100) / 100;
}

async function balances(orgIds: string[], opts: { from?: string; to?: string; excludeClosing?: boolean } = {}): Promise<AccountBalance[]> {
  if (orgIds.length === 0) return [];
  const conds = [inArray(journalLines.orgId, orgIds), eq(journalEntries.status, "Posted")];
  if (opts.from) conds.push(gte(journalEntries.entryDate, opts.from));
  if (opts.to)   conds.push(lte(journalEntries.entryDate, opts.to));
  // Year-end closing entries move P&L to Retained Earnings; excluding them keeps
  // the P&L report showing real trading activity (the Balance Sheet includes them).
  if (opts.excludeClosing) conds.push(ne(journalEntries.sourceType, "Closing"));

  const rows = await db
    .select({
      accountId: journalLines.accountId,
      name: accounts.name, code: accounts.code, type: accounts.type, classification: accounts.classification,
      debit: sql<string>`sum(${journalLines.debit})`, credit: sql<string>`sum(${journalLines.credit})`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(...conds))
    .groupBy(journalLines.accountId, accounts.name, accounts.code, accounts.type, accounts.classification);

  return rows.map((r) => ({
    accountId: r.accountId, name: r.name, code: r.code, type: r.type, classification: r.classification,
    debit: Number(r.debit ?? 0), credit: Number(r.credit ?? 0),
  }));
}

const round = (n: number) => Math.round(n * 100) / 100;

// ── Trial Balance ─────────────────────────────────────────────────────────────
export async function trialBalance(orgIds: string[], asOf?: string) {
  const bs = await balances(orgIds, { to: asOf });
  const rows = bs
    .map((b) => {
      const net = round(b.debit - b.credit);
      return { name: b.name, code: b.code, type: b.type, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
    })
    .filter((r) => r.debit !== 0 || r.credit !== 0)
    .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? "") || a.name.localeCompare(b.name));
  const totalDebit = round(rows.reduce((s, r) => s + r.debit, 0));
  const totalCredit = round(rows.reduce((s, r) => s + r.credit, 0));
  return { asOf: asOf ?? null, rows, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01 };
}

// ── Profit & Loss ──────────────────────────────────────────────────────────────
type PlLine = { name: string; code: string | null; amount: number };
export async function profitAndLoss(orgIds: string[], from?: string, to?: string) {
  const bs = (await balances(orgIds, { from, to, excludeClosing: true })).filter((b) => place(b.type, b.classification).statement === "profit_loss");
  const bySection = (section: string): PlLine[] =>
    bs.filter((b) => place(b.type, b.classification).section === section)
      .map((b) => ({ name: b.name, code: b.code, amount: natural(b) }))
      .filter((l) => l.amount !== 0)
      .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""));
  const sum = (ls: PlLine[]) => round(ls.reduce((s, l) => s + l.amount, 0));

  const revenue = bySection("Revenue");
  const costOfSales = bySection("Cost of Sales");
  const otherIncome = bySection("Other Income");
  const opex = bySection("Operating Expenses");
  const finance = bySection("Finance Costs");
  const tax = bySection("Taxation");

  const revenueTotal = sum(revenue), cosTotal = sum(costOfSales), otherIncomeTotal = sum(otherIncome);
  const opexTotal = sum(opex), financeTotal = sum(finance), taxTotal = sum(tax);
  const grossProfit = round(revenueTotal - cosTotal);
  const profitBeforeTax = round(grossProfit + otherIncomeTotal - opexTotal - financeTotal);
  const netProfit = round(profitBeforeTax - taxTotal);

  return {
    from: from ?? null, to: to ?? null,
    sections: [
      { section: "Revenue", lines: revenue, total: revenueTotal },
      { section: "Cost of Sales", lines: costOfSales, total: cosTotal },
    ],
    grossProfit,
    otherIncome: { lines: otherIncome, total: otherIncomeTotal },
    operatingExpenses: { lines: opex, total: opexTotal },
    financeCosts: { lines: finance, total: financeTotal },
    profitBeforeTax,
    taxation: { lines: tax, total: taxTotal },
    netProfit,
  };
}

// ── Balance Sheet ────────────────────────────────────────────────────────────
type BsLine = { name: string; code: string | null; amount: number };

/** First day of the fiscal year on or before `dateStr`, given the FY start month (1-12). */
function fyStartOnOrBefore(dateStr: string, m: number): string {
  const [y, mm] = dateStr.split("-").map(Number);
  const year = mm < m ? y - 1 : y;
  return `${year}-${String(m).padStart(2, "0")}-01`;
}
function dayBefore(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function balanceSheet(orgIds: string[], asOf?: string, fyStartMonth = 1) {
  const all = await balances(orgIds, { to: asOf });
  const bsAccts = all.filter((b) => place(b.type, b.classification).statement === "balance_sheet");
  const bySection = (section: string): BsLine[] =>
    bsAccts.filter((b) => place(b.type, b.classification).section === section)
      .map((b) => ({ name: b.name, code: b.code, amount: natural(b) }))
      .filter((l) => l.amount !== 0)
      .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""));
  const sum = (ls: BsLine[]) => round(ls.reduce((s, l) => s + l.amount, 0));

  const ncAssets = bySection("Non-current Assets");
  const cAssets = bySection("Current Assets");
  const equity = bySection("Equity");
  const ncLiab = bySection("Non-current Liabilities");
  const cLiab = bySection("Current Liabilities");

  // Net income, split by fiscal year. PRIOR fiscal years roll into Retained
  // Earnings automatically the moment a new year starts (QBO/QBD behaviour — no
  // manual entry needed); the CURRENT fiscal year shows as Profit for the
  // period. Explicit closing entries, if used, are already in these balances,
  // so this can't double count either way.
  const plNet = (bs: AccountBalance[]) => round(bs
    .filter((b) => place(b.type, b.classification).statement === "profit_loss")
    .reduce((s, b) => { const p = place(b.type, b.classification); return s + (p.normal === "credit" ? b.credit - b.debit : -(b.debit - b.credit)); }, 0));

  const refDate = asOf ?? new Date().toISOString().slice(0, 10);
  const fyStart = fyStartOnOrBefore(refDate, fyStartMonth);
  const priorEarnings = plNet(await balances(orgIds, { to: dayBefore(fyStart) }));
  const currentProfit = plNet(await balances(orgIds, { from: fyStart, to: asOf }));

  const totalAssets = round(sum(ncAssets) + sum(cAssets));
  const equityWithProfit = [
    ...equity,
    ...(priorEarnings !== 0 ? [{ name: "Retained Earnings", code: null, amount: priorEarnings }] : []),
    { name: "Profit for the period", code: null, amount: currentProfit },
  ];
  const totalEquity = round(sum(equity) + priorEarnings + currentProfit);
  const totalLiabilities = round(sum(ncLiab) + sum(cLiab));

  return {
    asOf: asOf ?? null,
    assets: { nonCurrent: ncAssets, current: cAssets, total: totalAssets },
    equity: { lines: equityWithProfit, total: totalEquity },
    liabilities: { nonCurrent: ncLiab, current: cLiab, total: totalLiabilities },
    totalEquityAndLiabilities: round(totalEquity + totalLiabilities),
    balanced: Math.abs(totalAssets - (totalEquity + totalLiabilities)) < 0.01,
  };
}

// ── General Ledger ───────────────────────────────────────────────────────────
// Per-account transaction listing with a running balance — the classic ledger
// where every line shows the NATURE of the posting (Invoice, Bill, Payment…),
// its document number and backend TXN id. This is what a CA "opens the ledger"
// to see. Optionally scoped to one account and/or a date window.
export async function generalLedger(orgIds: string[], opts: { accountId?: string; from?: string; to?: string } = {}) {
  if (orgIds.length === 0) return { accounts: [] as any[] };

  // Accounts in scope (single, or all that have movement).
  const acctRows = await db.select({ id: accounts.id, name: accounts.name, code: accounts.code, type: accounts.type, classification: accounts.classification })
    .from(accounts)
    .where(opts.accountId ? and(inArray(accounts.orgId, orgIds), eq(accounts.id, opts.accountId)) : inArray(accounts.orgId, orgIds));
  const acctById = new Map(acctRows.map(a => [a.id, a]));

  const conds = [inArray(journalLines.orgId, orgIds), eq(journalEntries.status, "Posted")];
  if (opts.accountId) conds.push(eq(journalLines.accountId, opts.accountId));
  if (opts.to) conds.push(lte(journalEntries.entryDate, opts.to));

  const rows = await db.select({
    accountId: journalLines.accountId,
    date: journalEntries.entryDate,
    sourceType: journalEntries.sourceType,
    docNumber: journalEntries.docNumber,
    entryNumber: journalEntries.entryNumber,
    txnNo: journalEntries.txnNo,
    memo: journalEntries.memo,
    description: journalLines.description,
    nameLabel: journalLines.nameLabel,
    lineNo: journalLines.lineNo,
    debit: journalLines.debit,
    credit: journalLines.credit,
  }).from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(...conds))
    .orderBy(journalEntries.entryDate, journalEntries.entryNumber, journalLines.lineNo);

  // Group per account; opening balance = movement strictly before `from`.
  const byAccount = new Map<string, typeof rows>();
  for (const r of rows) {
    if (opts.accountId && r.accountId !== opts.accountId) continue;
    let arr = byAccount.get(r.accountId);
    if (!arr) { arr = []; byAccount.set(r.accountId, arr); }
    arr.push(r);
  }

  const out = [...byAccount.entries()].map(([accountId, list]) => {
    const acct = acctById.get(accountId);
    let opening = 0;
    const ledgerRows: any[] = [];
    let balance = 0;
    for (const r of list) {
      const d = Number(r.debit ?? 0), c = Number(r.credit ?? 0);
      if (opts.from && r.date < opts.from) { opening = round(opening + d - c); continue; }
      balance = round((ledgerRows.length ? balance : opening) + d - c);
      ledgerRows.push({
        date: r.date, sourceType: r.sourceType, docNumber: r.docNumber ?? `JE-${r.entryNumber}`, txnNo: r.txnNo,
        name: r.nameLabel ?? null, memo: r.description || r.memo || null,
        debit: round(d), credit: round(c), balance,
      });
    }
    if (ledgerRows.length === 0 && opening === 0) return null;
    return {
      account: acct ? { id: acct.id, name: acct.name, code: acct.code, type: acct.type } : { id: accountId, name: "—", code: null, type: null },
      opening: round(opening), rows: ledgerRows, closing: round(ledgerRows.length ? balance : opening),
    };
  }).filter(Boolean)
    .sort((a: any, b: any) => (a.account.code ?? "").localeCompare(b.account.code ?? "") || a.account.name.localeCompare(b.account.name));

  return { accounts: out };
}
