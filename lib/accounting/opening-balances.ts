/**
 * Opening balances — the one-time setup entry that brings balances over from a
 * prior system. The user enters each account's opening balance as of a date;
 * the net imbalance is posted to Opening Balance Equity so the entry balances.
 * There is a single "Opening" entry per org — re-saving replaces it.
 */

import { db } from "@/db";
import { accounts, journalEntries, journalLines } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { postJournalEntry, LedgerValidationError, type PostLine } from "@/lib/ledger";
import { ensureSystemAccounts, systemAccountId } from "@/lib/accounting/system-accounts";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v: any) => Number(v ?? 0);
const err = (m: string): never => { throw new LedgerValidationError(m); };

/** The current opening-balance entry (if any) as { date, lines: [{accountId, debit, credit}] }. */
export async function getOpeningBalances(orgId: string) {
  const [entry] = await db.select().from(journalEntries)
    .where(and(eq(journalEntries.orgId, orgId), eq(journalEntries.sourceType, "Opening"))).limit(1);
  if (!entry) return { date: null as string | null, entryId: null as string | null, lines: [] as { accountId: string; debit: number; credit: number }[] };
  const lines = await db.select({ accountId: journalLines.accountId, debit: journalLines.debit, credit: journalLines.credit })
    .from(journalLines).where(and(eq(journalLines.orgId, orgId), eq(journalLines.entryId, entry.id)));
  return { date: entry.entryDate, entryId: entry.id, lines: lines.map(l => ({ accountId: l.accountId, debit: num(l.debit), credit: num(l.credit) })) };
}

export type OpeningLine = { accountId: string; debit?: number | null; credit?: number | null };

export async function setOpeningBalances(orgId: string, date: string, entries: OpeningLine[], actorId: string | null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) err("A valid opening date is required.");
  await ensureSystemAccounts(orgId);
  const obeId = await systemAccountId(orgId, "OpeningBalanceEquity");
  if (!obeId) err("No Opening Balance Equity account is set up.");

  // Validate the accounts belong to the org and are active.
  const ids = [...new Set(entries.map(e => e.accountId).filter(Boolean))];
  const valid = ids.length ? await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.orgId, orgId), inArray(accounts.id, ids))) : [];
  const validIds = new Set(valid.map(a => a.id));

  const lines: PostLine[] = [];
  let totDr = 0, totCr = 0;
  for (const e of entries) {
    if (e.accountId === obeId) continue; // OBE is the auto-balancer, not a user line
    if (!validIds.has(e.accountId)) continue;
    const d = r2(num(e.debit)), c = r2(num(e.credit));
    if (d === 0 && c === 0) continue;
    lines.push({ accountId: e.accountId, debit: d || undefined, credit: c || undefined, description: "Opening balance" });
    totDr = r2(totDr + d); totCr = r2(totCr + c);
  }
  if (!lines.length) err("Enter at least one opening balance.");

  // Balance to Opening Balance Equity.
  const diff = r2(totDr - totCr);
  if (diff > 0) lines.push({ accountId: obeId!, credit: diff, description: "Opening balance equity" });
  else if (diff < 0) lines.push({ accountId: obeId!, debit: -diff, description: "Opening balance equity" });

  // Replace any existing opening entry (guard the period lock the same way the
  // ledger does — postJournalEntry will reject a locked date).
  const existing = await getOpeningBalances(orgId);
  if (existing.entryId) {
    await db.delete(journalLines).where(and(eq(journalLines.orgId, orgId), eq(journalLines.entryId, existing.entryId)));
    await db.delete(journalEntries).where(and(eq(journalEntries.id, existing.entryId), eq(journalEntries.orgId, orgId)));
  }

  const entry = await postJournalEntry({
    orgId, entryDate: date, memo: "Opening balances", series: "Opening", sourceType: "Opening", createdBy: actorId, lines,
  });
  return { id: entry.id, docNumber: entry.docNumber, lines: lines.length };
}
