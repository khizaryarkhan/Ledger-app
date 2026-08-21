/**
 * General Ledger posting engine — the core of native accounting.
 *
 * Invariants enforced here (not in callers):
 *   1. Every entry balances: Σ debits = Σ credits (to the cent).
 *   2. Every line carries exactly one side: debit XOR credit, > 0.
 *   3. Every line's account exists in this org and is Active.
 *   4. Entries are immutable — corrections are posted as reversals, never
 *      edits or deletes.
 *
 * NOTE ON ATOMICITY: the neon-http driver has no transactions. We insert the
 * entry header first, then the lines; if any line insert fails we delete the
 * header (compensating action) so a half-posted entry never survives. The
 * balance validation happens entirely BEFORE any insert, so the only failure
 * mode inside the write window is infrastructure, not business logic.
 */

import { db } from "@/db";
import { journalEntries, journalLines, apAccounts, organisations } from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { resolveDocNumber, nextTransactionId } from "@/lib/accounting/numbering";

export type PostLine = {
  accountId:    string;
  debit?:       number;
  credit?:      number;
  description?: string | null;
  classId?:     string | null;
  locationId?:  string | null;
  costCentreId?: string | null;
  customerId?:  string | null;
  projectId?:   string | null;
  nameType?:    string | null;   // Customer | Vendor | Employee (the line's "Name")
  nameId?:      string | null;
  nameLabel?:   string | null;
  // Multi-currency: debit/credit are ALWAYS home currency. These describe the
  // foreign amount entered + the rate used (null = home currency line).
  currency?:    string | null;
  exchangeRate?: number | null;
  fxDebit?:     number | null;
  fxCredit?:    number | null;
};

export type PostEntryInput = {
  orgId:      string;
  entryDate:  string;              // YYYY-MM-DD
  memo?:      string | null;
  sourceType?: string;             // Manual | Invoice | Payment | Bill | CreditNote | Reversal
  sourceId?:  string | null;
  docNumber?: string | null;       // user-facing number; auto-allocated from the Journal series when omitted
  // When mirroring a transaction that originates in QBO/Xero, keep their id too.
  externalId?: string | null;
  externalSource?: string | null;  // qbo | xero
  externalSyncToken?: string | null;
  createdBy?: string | null;
  lines:      PostLine[];
};

export class LedgerValidationError extends Error {}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Validate an entry's lines. Throws LedgerValidationError with a clear message. */
export async function validateEntry(orgId: string, lines: PostLine[]): Promise<void> {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new LedgerValidationError("A journal entry needs at least two lines.");
  }

  let totalDebit = 0, totalCredit = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const debit  = round2(Number(l.debit  ?? 0));
    const credit = round2(Number(l.credit ?? 0));
    if (debit < 0 || credit < 0) {
      throw new LedgerValidationError(`Line ${i + 1}: amounts cannot be negative — use the opposite column instead.`);
    }
    if ((debit > 0) === (credit > 0)) {
      throw new LedgerValidationError(`Line ${i + 1}: each line must have either a debit or a credit (not both, not neither).`);
    }
    if (!l.accountId) {
      throw new LedgerValidationError(`Line ${i + 1}: an account is required.`);
    }
    totalDebit  += debit;
    totalCredit += credit;
  }

  if (Math.abs(round2(totalDebit) - round2(totalCredit)) > 0.005) {
    throw new LedgerValidationError(
      `Entry does not balance: debits ${round2(totalDebit).toFixed(2)} ≠ credits ${round2(totalCredit).toFixed(2)}.`
    );
  }

  // All accounts must exist in this org and be Active.
  const accountIds = [...new Set(lines.map(l => l.accountId))];
  const accounts = await db
    .select({ id: apAccounts.id, status: apAccounts.status, name: apAccounts.name })
    .from(apAccounts)
    .where(and(eq(apAccounts.orgId, orgId), inArray(apAccounts.id, accountIds)));
  const found = new Map(accounts.map(a => [a.id, a]));
  for (const id of accountIds) {
    const acc = found.get(id);
    if (!acc) throw new LedgerValidationError("One of the selected accounts was not found in this organisation.");
    if (acc.status === "Inactive") throw new LedgerValidationError(`Account "${acc.name}" is inactive — reactivate it before posting to it.`);
  }
}

/** Next sequential entry number for the org. */
async function nextEntryNumber(orgId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${journalEntries.entryNumber}), 0)` })
    .from(journalEntries)
    .where(eq(journalEntries.orgId, orgId));
  return Number(row?.max ?? 0) + 1;
}

/**
 * Post a balanced journal entry. Validates first, writes second.
 * Returns the created entry with its lines.
 */
export async function postJournalEntry(input: PostEntryInput) {
  await validateEntry(input.orgId, input.lines);

  // Period lock: nothing may be posted on/before the book close date, except
  // the system closing entry itself (which is dated the period end).
  if ((input.sourceType ?? "Manual") !== "Closing") {
    const [org] = await db.select({ lock: organisations.bookCloseDate })
      .from(organisations).where(eq(organisations.id, input.orgId)).limit(1);
    if (org?.lock && input.entryDate <= org.lock) {
      throw new LedgerValidationError(`The books are closed through ${org.lock}. Entries on or before that date are locked — reopen the period to post here.`);
    }
  }

  // Allocate the backend Transaction ID and the user-facing document number
  // once (both advance central sequences), before the entry-number retry loop
  // so retries don't burn numbers. txn_no is globally unique per org, so it
  // stays valid across retries (which only re-pick the audit entry_number).
  const { no: txnNo } = await nextTransactionId(input.orgId);
  const docNumber = await resolveDocNumber(input.orgId, "Journal", input.docNumber);

  // Read-max-then-insert can collide under concurrency; the unique index on
  // (orgId, entryNumber) catches it — retry with a fresh number.
  let entry: typeof journalEntries.$inferSelect | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const entryNumber = await nextEntryNumber(input.orgId);
    try {
      [entry] = await db.insert(journalEntries).values({
        orgId:       input.orgId,
        entryNumber,
        txnNo,
        docNumber,
        externalId:        input.externalId ?? null,
        externalSource:    input.externalSource ?? null,
        externalSyncToken: input.externalSyncToken ?? null,
        entryDate:   input.entryDate,
        memo:        input.memo ?? null,
        sourceType:  input.sourceType ?? "Manual",
        sourceId:    input.sourceId ?? null,
        status:      "Posted",
        createdBy:   input.createdBy ?? null,
      }).returning();
      break;
    } catch (e: any) {
      const isUniqueViolation = e?.code === "23505" || /duplicate key/i.test(e?.message ?? "");
      if (!isUniqueViolation || attempt === 2) throw e;
    }
  }
  if (!entry) throw new Error("Failed to allocate a journal entry number");

  try {
    await db.insert(journalLines).values(
      input.lines.map((l, i) => ({
        orgId:        input.orgId,
        entryId:      entry.id,
        lineNo:       i + 1,
        accountId:    l.accountId,
        description:  l.description ?? null,
        // numeric columns take strings — fix the cents at insert time.
        debit:        round2(Number(l.debit  ?? 0)).toFixed(2),
        credit:       round2(Number(l.credit ?? 0)).toFixed(2),
        classId:      l.classId ?? null,
        locationId:   l.locationId ?? null,
        costCentreId: l.costCentreId ?? null,
        // Keep the legacy customerId link populated when the Name is a Customer,
        // so existing AR-subledger drill-down by customerId still works.
        customerId:   l.customerId ?? (l.nameType === "Customer" ? l.nameId ?? null : null),
        projectId:    l.projectId ?? null,
        nameType:     l.nameType ?? null,
        nameId:       l.nameId ?? null,
        nameLabel:    l.nameLabel ?? null,
        currency:     l.currency ?? null,
        exchangeRate: l.exchangeRate != null ? String(l.exchangeRate) : null,
        fxDebit:      l.fxDebit  != null ? round2(Number(l.fxDebit)).toFixed(2)  : null,
        fxCredit:     l.fxCredit != null ? round2(Number(l.fxCredit)).toFixed(2) : null,
      }))
    );
  } catch (e) {
    // Compensating action — never leave a header without balanced lines.
    await db.delete(journalEntries).where(eq(journalEntries.id, entry.id)).catch(delErr => {
      console.error(`[ledger] ORPHAN HEADER: entry ${entry!.id} (JE-${entry!.entryNumber}) has no lines and could not be deleted:`, delErr);
    });
    throw e;
  }

  return entry;
}

/**
 * Reverse a posted entry: posts a new entry with debits/credits swapped and
 * links the two. The original is marked Reversed but never modified beyond
 * that flag — full audit trail preserved.
 */
export async function reverseJournalEntry(orgId: string, entryId: string, actorId: string | null, entryDate?: string) {
  const [orig] = await db.select().from(journalEntries)
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.orgId, orgId))).limit(1);
  if (!orig) throw new LedgerValidationError("Entry not found.");
  if (orig.status === "Reversed") throw new LedgerValidationError(`Entry JE-${orig.entryNumber} has already been reversed.`);
  if (orig.sourceType === "Reversal") throw new LedgerValidationError(`JE-${orig.entryNumber} is itself a reversal — post a new entry instead of un-reversing.`);

  const lines = await db.select().from(journalLines)
    .where(and(eq(journalLines.entryId, entryId), eq(journalLines.orgId, orgId)));

  const reversal = await postJournalEntry({
    orgId,
    entryDate: entryDate ?? new Date().toISOString().slice(0, 10),
    memo: `Reversal of JE-${orig.entryNumber}${orig.memo ? ` — ${orig.memo}` : ""}`,
    sourceType: "Reversal",
    sourceId: orig.id,
    createdBy: actorId,
    lines: lines
      .sort((a, b) => a.lineNo - b.lineNo)
      .map(l => ({
        accountId:    l.accountId,
        debit:        Number(l.credit),   // swapped
        credit:       Number(l.debit),    // swapped
        description:  l.description,
        classId:      l.classId,
        locationId:   l.locationId,
        costCentreId: l.costCentreId,
        customerId:   l.customerId,
        projectId:    l.projectId,
      })),
  });

  // Guarded update: only flip Posted → Reversed. If a concurrent reversal won
  // the race, no row matches — surface it rather than double-reverse silently.
  const flipped: any[] = await db.update(journalEntries)
    .set({ status: "Reversed", reversedByEntryId: reversal.id })
    .where(and(
      eq(journalEntries.id, orig.id),
      eq(journalEntries.orgId, orgId),
      eq(journalEntries.status, "Posted"),
    ))
    .returning() as any;
  if (flipped.length === 0) {
    console.error(`[ledger] Concurrent reversal detected on JE-${orig.entryNumber}; reversal JE-${reversal.entryNumber} may be a duplicate — review and reverse it if so.`);
  }
  await db.update(journalEntries)
    .set({ reversesEntryId: orig.id })
    .where(and(eq(journalEntries.id, reversal.id), eq(journalEntries.orgId, orgId)));

  return reversal;
}

/**
 * Trial balance as of a date: per-account net debit/credit across all
 * Posted+Reversed entries (reversals included — they net out naturally).
 * The grand total MUST be zero; a non-zero TB means the engine is broken.
 */
export async function trialBalance(orgId: string, asOf: string) {
  const rows = await db
    .select({
      accountId: journalLines.accountId,
      debit:  sql<number>`coalesce(sum(${journalLines.debit}), 0)`,
      credit: sql<number>`coalesce(sum(${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(
      eq(journalLines.orgId, orgId),
      sql`${journalEntries.entryDate} <= ${asOf}`,
      // Explicit status allowlist so a future Draft/Void status can't leak in.
      inArray(journalEntries.status, ["Posted", "Reversed"]),
    ))
    .groupBy(journalLines.accountId);

  const accountIds = rows.map(r => r.accountId);
  const accounts = accountIds.length
    ? await db.select({ id: apAccounts.id, name: apAccounts.name, type: apAccounts.type, code: apAccounts.code })
        .from(apAccounts)
        .where(and(eq(apAccounts.orgId, orgId), inArray(apAccounts.id, accountIds)))
    : [];
  const accMap = new Map(accounts.map(a => [a.id, a]));

  const lines = rows.map(r => {
    const acc = accMap.get(r.accountId);
    const net = round2(Number(r.debit) - Number(r.credit));
    return {
      accountId: r.accountId,
      name:  acc?.name ?? "Unknown account",
      code:  acc?.code ?? null,
      type:  acc?.type ?? null,
      debit:  net > 0 ? net : 0,
      credit: net < 0 ? -net : 0,
    };
  }).filter(l => l.debit !== 0 || l.credit !== 0)
    .sort((a, b) => (a.type ?? "").localeCompare(b.type ?? "") || a.name.localeCompare(b.name));

  const totalDebit  = round2(lines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0));

  return { asOf, lines, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.005 };
}
