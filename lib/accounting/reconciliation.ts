/**
 * Bank reconciliation — match a bank / credit-card account's GL lines to a
 * statement. Lines carry a reconciliation_id once cleared; the beginning
 * balance of a new reconciliation is the sum of everything already cleared, so
 * (beginning + newly-cleared) must equal the statement's ending balance.
 */

import { db } from "@/db";
import { accounts, journalEntries, journalLines, bankReconciliations } from "@/db/schema";
import { and, eq, inArray, isNull, isNotNull, desc, sql } from "drizzle-orm";
import { LedgerValidationError } from "@/lib/ledger";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v: any) => Number(v ?? 0);
const err = (m: string): never => { throw new LedgerValidationError(m); };

/** Bank & credit-card accounts with their current GL balance. */
export async function bankAccounts(orgId: string) {
  const accts = await db.select({ id: accounts.id, name: accounts.name, code: accounts.code, type: accounts.type })
    .from(accounts).where(and(eq(accounts.orgId, orgId), inArray(accounts.type, ["Bank", "Credit Card"])));
  if (!accts.length) return [];
  const bals = await db.select({ accountId: journalLines.accountId, bal: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}),0)` })
    .from(journalLines).innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalLines.orgId, orgId), inArray(journalEntries.status, ["Posted", "Reversed"]), inArray(journalLines.accountId, accts.map(a => a.id))))
    .groupBy(journalLines.accountId);
  const balBy = new Map(bals.map(b => [b.accountId, num(b.bal)]));
  return accts.map(a => ({ ...a, balance: r2(balBy.get(a.id) ?? 0) }));
}

/** Reconciliation working view for one account: cleared opening + uncleared lines + history. */
export async function reconcileView(orgId: string, accountId: string) {
  const [opening] = await db.select({ v: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}),0)` })
    .from(journalLines).where(and(eq(journalLines.orgId, orgId), eq(journalLines.accountId, accountId), isNotNull(journalLines.reconciliationId)));
  const beginningBalance = r2(num(opening?.v));

  const lines = await db.select({
    lineId: journalLines.id, entryId: journalLines.entryId, debit: journalLines.debit, credit: journalLines.credit,
    description: journalLines.description, date: journalEntries.entryDate, docNumber: journalEntries.docNumber,
    sourceType: journalEntries.sourceType, name: journalLines.nameLabel,
  }).from(journalLines).innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalLines.orgId, orgId), eq(journalLines.accountId, accountId), isNull(journalLines.reconciliationId), inArray(journalEntries.status, ["Posted", "Reversed"])))
    .orderBy(journalEntries.entryDate);

  const history = await db.select().from(bankReconciliations)
    .where(and(eq(bankReconciliations.orgId, orgId), eq(bankReconciliations.accountId, accountId)))
    .orderBy(desc(bankReconciliations.statementDate)).limit(24);

  return {
    beginningBalance,
    lines: lines.map(l => ({
      lineId: l.lineId, entryId: l.entryId, date: l.date, docNumber: l.docNumber, sourceType: l.sourceType,
      description: l.description || l.name || l.sourceType, amount: r2(num(l.debit) - num(l.credit)),
    })),
    history: history.map(h => ({ ...h, statementBalance: num(h.statementBalance), clearedBalance: num(h.clearedBalance), beginningBalance: num(h.beginningBalance) })),
  };
}

export type FinalizeInput = { accountId: string; statementDate: string; statementBalance: number; lineIds: string[] };

export async function finalizeReconciliation(orgId: string, input: FinalizeInput, actorId: string | null) {
  if (!input.accountId) err("Select an account.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.statementDate)) err("A valid statement date is required.");
  const ids = [...new Set((input.lineIds ?? []).filter(Boolean))];
  if (!ids.length) err("Tick the lines that appear on the statement.");

  const [opening] = await db.select({ v: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}),0)` })
    .from(journalLines).where(and(eq(journalLines.orgId, orgId), eq(journalLines.accountId, input.accountId), isNotNull(journalLines.reconciliationId)));
  const beginning = r2(num(opening?.v));

  // Sum only genuinely-uncleared selected lines on this account.
  const sel = await db.select({ id: journalLines.id, debit: journalLines.debit, credit: journalLines.credit })
    .from(journalLines).where(and(eq(journalLines.orgId, orgId), eq(journalLines.accountId, input.accountId), isNull(journalLines.reconciliationId), inArray(journalLines.id, ids)));
  const clearedSum = r2(sel.reduce((s, l) => s + (num(l.debit) - num(l.credit)), 0));
  const reconciled = r2(beginning + clearedSum);
  const diff = r2(reconciled - num(input.statementBalance));
  if (Math.abs(diff) > 0.005) err(`Off by ${diff.toLocaleString(undefined, { minimumFractionDigits: 2 })}. Cleared balance ${reconciled.toLocaleString()} must equal the statement's ${num(input.statementBalance).toLocaleString()}.`);

  const [rec] = await db.insert(bankReconciliations).values({
    orgId, accountId: input.accountId, statementDate: input.statementDate,
    beginningBalance: beginning.toFixed(2), statementBalance: num(input.statementBalance).toFixed(2),
    clearedBalance: reconciled.toFixed(2), status: "Reconciled", reconciledBy: actorId,
  } as any).returning({ id: bankReconciliations.id });

  await db.update(journalLines).set({ reconciliationId: rec.id })
    .where(and(eq(journalLines.orgId, orgId), eq(journalLines.accountId, input.accountId), isNull(journalLines.reconciliationId), inArray(journalLines.id, sel.map(s => s.id))));
  return { id: rec.id, clearedBalance: reconciled, count: sel.length };
}

/** Undo a reconciliation — un-clear its lines and remove the record. */
export async function unreconcile(orgId: string, recId: string) {
  await db.update(journalLines).set({ reconciliationId: null }).where(and(eq(journalLines.orgId, orgId), eq(journalLines.reconciliationId, recId)));
  await db.delete(bankReconciliations).where(and(eq(bankReconciliations.id, recId), eq(bankReconciliations.orgId, orgId)));
  return { id: recId, undone: true };
}
