/** GET /api/ledger/journal/[id] — one posted transaction with its lines + links. */

import { db } from "@/db";
import { journalEntries, journalLines, accounts } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq } from "drizzle-orm";
import { linksFor } from "@/lib/accounting/links";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [entry] = await db.select().from(journalEntries)
    .where(and(eq(journalEntries.id, params.id), eq(journalEntries.orgId, orgId!))).limit(1);
  if (!entry) return bad("Transaction not found", 404);

  const rows = await db.select({
    id: journalLines.id, lineNo: journalLines.lineNo,
    accountName: accounts.name, accountCode: accounts.code,
    description: journalLines.description, nameLabel: journalLines.nameLabel, nameType: journalLines.nameType,
    debit: journalLines.debit, credit: journalLines.credit,
    currency: journalLines.currency, fxDebit: journalLines.fxDebit, fxCredit: journalLines.fxCredit,
    classId: journalLines.classId, locationId: journalLines.locationId,
  }).from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalLines.orgId, orgId!), eq(journalLines.entryId, params.id)))
    .orderBy(journalLines.lineNo);

  const links = await linksFor(orgId!, entry.sourceType, entry.id);
  const total = rows.reduce((s, l) => s + Number(l.debit || 0), 0);

  return ok({
    entry: {
      id: entry.id, entryNumber: entry.entryNumber, txnNo: entry.txnNo, docNumber: entry.docNumber,
      sourceType: entry.sourceType, entryDate: entry.entryDate, dueDate: entry.dueDate,
      reference: entry.reference, memo: entry.memo, status: entry.status,
      reversedByEntryId: entry.reversedByEntryId, reversesEntryId: entry.reversesEntryId,
    },
    lines: rows.map(l => ({
      lineNo: l.lineNo, account: l.accountCode ? `${l.accountCode} · ${l.accountName}` : l.accountName,
      name: l.nameLabel ?? null, description: l.description ?? null,
      debit: Number(l.debit || 0), credit: Number(l.credit || 0),
      currency: l.currency ?? null, fxDebit: l.fxDebit != null ? Number(l.fxDebit) : null, fxCredit: l.fxCredit != null ? Number(l.fxCredit) : null,
    })),
    links, total: Math.round(total * 100) / 100,
  });
}
