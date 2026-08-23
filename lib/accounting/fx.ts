/**
 * Currency exposure & FX revaluation (read-only, safe).
 *
 * Every journal line already stores the foreign amount entered (fx_debit/
 * fx_credit) alongside the home-currency debit/credit. This report groups the
 * foreign lines by account + currency to show, per currency, the outstanding
 * foreign balance and its home carrying value. Revaluing the foreign balance at
 * a current rate reveals the UNREALISED FX gain/loss — without touching any
 * posting path.
 */

import { db } from "@/db";
import { accounts, journalEntries, journalLines } from "@/db/schema";
import { and, eq, inArray, lte, isNotNull, ne, sql } from "drizzle-orm";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v: any) => Number(v ?? 0);

export type FxRow = {
  accountId: string; accountName: string; accountType: string; currency: string;
  foreignBalance: number;   // net foreign amount outstanding (fx debit − credit)
  homeCarrying: number;     // net home value it was booked at (debit − credit)
  avgRate: number;          // homeCarrying / foreignBalance
};

/** Foreign-currency positions by account + currency as of a date (home currency excluded). */
export async function fxExposure(orgId: string, asOf: string, home: string): Promise<FxRow[]> {
  const rows = await db.select({
    accountId: journalLines.accountId, currency: journalLines.currency,
    fx: sql<string>`coalesce(sum(coalesce(${journalLines.fxDebit},0) - coalesce(${journalLines.fxCredit},0)),0)`,
    homev: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}),0)`,
  }).from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(
      eq(journalLines.orgId, orgId), inArray(journalEntries.status, ["Posted", "Reversed"]),
      lte(journalEntries.entryDate, asOf), isNotNull(journalLines.currency), ne(journalLines.currency, home),
    ))
    .groupBy(journalLines.accountId, journalLines.currency);

  const ids = [...new Set(rows.map(r => r.accountId))];
  const accts = ids.length ? await db.select({ id: accounts.id, name: accounts.name, type: accounts.type }).from(accounts).where(and(eq(accounts.orgId, orgId), inArray(accounts.id, ids))) : [];
  const byId = new Map(accts.map(a => [a.id, a]));

  return rows.map(r => {
    const foreignBalance = r2(num(r.fx)), homeCarrying = r2(num(r.homev));
    const a = byId.get(r.accountId);
    return {
      accountId: r.accountId, accountName: a?.name ?? "—", accountType: a?.type ?? "",
      currency: r.currency ?? "", foreignBalance, homeCarrying,
      avgRate: foreignBalance !== 0 ? Math.round((homeCarrying / foreignBalance) * 1e6) / 1e6 : 0,
    };
  }).filter(r => Math.abs(r.foreignBalance) > 0.005 || Math.abs(r.homeCarrying) > 0.005)
    .sort((a, b) => a.currency.localeCompare(b.currency) || a.accountName.localeCompare(b.accountName));
}
