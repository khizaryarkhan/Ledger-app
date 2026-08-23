/**
 * Financial period / year-end close.
 *
 * Closing a period posts a system "Closing" journal entry dated the period end
 * that zeroes every P&L (income & expense) account and moves the net result to
 * Retained Earnings — the classic year-end closing entry a CA expects, with a
 * full audit trail (period_closes). It then sets the book close (lock) date so
 * nothing can be back-dated into the closed period.
 *
 * The P&L report excludes Closing entries (see financials.balances) so it still
 * shows real trading activity; the Balance Sheet and Trial Balance include them,
 * so Retained Earnings carries the closed profit and P&L accounts read zero
 * cumulatively — exactly how a closed set of books should look.
 */

import { db } from "@/db";
import { accounts, journalEntries, journalLines, organisations, periodCloses } from "@/db/schema";
import { and, eq, gte, lte, ne, inArray, sql, desc } from "drizzle-orm";
import { ensureSystemAccounts } from "./system-accounts";
import { place } from "./financials";
import { postJournalEntry, reverseJournalEntry, LedgerValidationError } from "@/lib/ledger";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const pad2 = (n: number) => String(n).padStart(2, "0");
const round2 = (n: number) => Math.round(n * 100) / 100;

/** First day of the fiscal year on or before `dateStr`, given the FY start month (1-12). */
export function fiscalYearStartOnOrBefore(dateStr: string, startMonth: number): string {
  const [y, m] = dateStr.split("-").map(Number);
  const year = m < startMonth ? y - 1 : y;
  return `${year}-${pad2(startMonth)}-01`;
}

/** The fiscal year that ends on/contains `dateStr`: e.g. startMonth 7 -> Jul 1 … Jun 30. */
export function fiscalYearBounds(dateStr: string, startMonth: number): { start: string; end: string; label: string } {
  const start = fiscalYearStartOnOrBefore(dateStr, startMonth);
  const [sy] = start.split("-").map(Number);
  // end = day before the next FY start
  const endDate = new Date(Date.UTC(sy + 1, startMonth - 1, 1));
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  const end = endDate.toISOString().slice(0, 10);
  const [ey] = end.split("-").map(Number);
  const label = startMonth === 1 ? `FY ${sy}` : `FY ${sy}/${String(ey).slice(-2)}`;
  return { start, end, label };
}

function dayAfter(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Current fiscal-period status + close history for an org. */
export async function periodStatus(orgId: string) {
  const [org] = await db.select({ fym: organisations.fiscalYearStartMonth, lock: organisations.bookCloseDate })
    .from(organisations).where(eq(organisations.id, orgId)).limit(1);
  const startMonth = org?.fym ?? 1;
  const closes = await db.select().from(periodCloses).where(eq(periodCloses.orgId, orgId)).orderBy(desc(periodCloses.periodEnd));
  return {
    fiscalYearStartMonth: startMonth,
    fiscalYearStartLabel: MONTHS[startMonth - 1],
    bookCloseDate: org?.lock ?? null,
    closes: closes.map(c => ({
      id: c.id, periodStart: c.periodStart, periodEnd: c.periodEnd,
      netProfit: Number(c.netProfit), status: c.status,
      closedAt: c.closedAt?.toISOString() ?? null,
    })),
  };
}

/**
 * Close the fiscal period ending on `periodEnd`. Posts the closing entry to
 * Retained Earnings and locks the books to `periodEnd`.
 */
export async function closePeriod(orgId: string, periodEnd: string, actorId: string | null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) throw new LedgerValidationError("Invalid period end date.");

  const [org] = await db.select({ fym: organisations.fiscalYearStartMonth, lock: organisations.bookCloseDate })
    .from(organisations).where(eq(organisations.id, orgId)).limit(1);
  const startMonth = org?.fym ?? 1;

  if (org?.lock && periodEnd <= org.lock) {
    throw new LedgerValidationError(`The books are already closed through ${org.lock}.`);
  }

  await ensureSystemAccounts(orgId);
  const [re] = await db.select({ id: accounts.id }).from(accounts)
    .where(and(eq(accounts.orgId, orgId), eq(accounts.subtype, "RetainedEarnings"))).limit(1);
  if (!re) throw new LedgerValidationError("No Retained Earnings account found — set up the chart of accounts first.");

  // Period start: after the last closed period if there is one, else the FY start.
  const [lastClose] = await db.select({ end: periodCloses.periodEnd }).from(periodCloses)
    .where(and(eq(periodCloses.orgId, orgId), eq(periodCloses.status, "Closed")))
    .orderBy(desc(periodCloses.periodEnd)).limit(1);
  const fyStart = fiscalYearStartOnOrBefore(periodEnd, startMonth);
  const periodStart = lastClose?.end && lastClose.end >= fyStart ? dayAfter(lastClose.end) : fyStart;

  // Sum P&L account movements over the period (excluding prior closing entries).
  const rows = await db.select({
    accountId: journalLines.accountId,
    type: accounts.type, classification: accounts.classification,
    debit: sql<string>`sum(${journalLines.debit})`, credit: sql<string>`sum(${journalLines.credit})`,
  }).from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(
      eq(journalLines.orgId, orgId), inArray(journalEntries.status, ["Posted", "Reversed"]),
      gte(journalEntries.entryDate, periodStart), lte(journalEntries.entryDate, periodEnd),
      ne(journalEntries.sourceType, "Closing"),
    ))
    .groupBy(journalLines.accountId, accounts.type, accounts.classification);

  const plRows = rows.filter(r => place(r.type, r.classification).statement === "profit_loss");

  // Each P&L account is zeroed by posting the opposite of its net movement.
  const lines: { accountId: string; debit?: number; credit?: number; description?: string }[] = [];
  let totalDebit = 0, totalCredit = 0;
  for (const r of plRows) {
    const net = round2(Number(r.debit ?? 0) - Number(r.credit ?? 0)); // + = debit balance (expense), - = credit balance (income)
    if (net === 0) continue;
    if (net > 0) { lines.push({ accountId: r.accountId, credit: net, description: "Year-end close" }); totalCredit += net; }
    else         { lines.push({ accountId: r.accountId, debit: -net, description: "Year-end close" }); totalDebit += -net; }
  }

  if (lines.length === 0) {
    throw new LedgerValidationError("There is no profit or loss to close in this period.");
  }

  // Balance to Retained Earnings. netProfit > 0 = profit (credited to RE).
  const netProfit = round2(totalDebit - totalCredit); // debits come from income, credits from expenses -> I − E
  if (netProfit > 0)      lines.push({ accountId: re.id, credit: netProfit, description: "Net profit to Retained Earnings" });
  else if (netProfit < 0) lines.push({ accountId: re.id, debit: -netProfit, description: "Net loss to Retained Earnings" });

  const { start, end, label } = fiscalYearBounds(periodEnd, startMonth);
  const entry = await postJournalEntry({
    orgId,
    entryDate: periodEnd,
    memo: `Year-end close ${label} — net ${netProfit >= 0 ? "profit" : "loss"} ${Math.abs(netProfit).toFixed(2)} to Retained Earnings`,
    sourceType: "Closing",
    createdBy: actorId,
    lines: lines as any,
  });

  const [rowClose] = await db.insert(periodCloses).values({
    orgId, periodStart, periodEnd,
    netProfit: netProfit.toFixed(2),
    retainedEarningsAccountId: re.id,
    closingEntryId: entry.id,
    status: "Closed",
    closedBy: actorId,
  }).returning();

  // Advance the lock date (string compare is valid for YYYY-MM-DD).
  if (!org?.lock || periodEnd > org.lock) {
    await db.update(organisations).set({ bookCloseDate: periodEnd, updatedAt: new Date() }).where(eq(organisations.id, orgId));
  }

  return { id: rowClose.id, periodStart, periodEnd, netProfit, closingEntryId: entry.id, txnNo: entry.txnNo };
}

/** Reopen a closed period: lower the lock date, then reverse the closing entry. */
export async function reopenPeriod(orgId: string, closeId: string, actorId: string | null) {
  const [row] = await db.select().from(periodCloses)
    .where(and(eq(periodCloses.id, closeId), eq(periodCloses.orgId, orgId))).limit(1);
  if (!row) throw new LedgerValidationError("Close record not found.");
  if (row.status !== "Closed") throw new LedgerValidationError("This period is already reopened.");

  // Lower the lock to the latest OTHER still-closed period end (or clear it),
  // BEFORE reversing so the reversal isn't itself blocked by the lock.
  const others = await db.select({ end: periodCloses.periodEnd }).from(periodCloses)
    .where(and(eq(periodCloses.orgId, orgId), eq(periodCloses.status, "Closed"), ne(periodCloses.id, closeId)))
    .orderBy(desc(periodCloses.periodEnd)).limit(1);
  await db.update(organisations).set({ bookCloseDate: others[0]?.end ?? null, updatedAt: new Date() }).where(eq(organisations.id, orgId));

  if (row.closingEntryId) {
    await reverseJournalEntry(orgId, row.closingEntryId, actorId);
  }
  await db.update(periodCloses).set({ status: "Reopened", reopenedAt: new Date() }).where(eq(periodCloses.id, closeId));

  return { id: closeId, reopened: true };
}
