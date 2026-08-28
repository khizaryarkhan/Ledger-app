/**
 * GET /api/documents/payments/available-for-deposit
 *
 * Native Payments not yet swept into a Deposit — feeds the "sweep a payment"
 * picker on the Deposit form (components/new-document-form.tsx). Excludes any
 * Payment already linked via a transaction_links row with relation
 * "deposit_sweep" (see lib/accounting/documents.ts's Deposit branch), so a
 * payment can't be swept into two deposits at once.
 */

import { db } from "@/db";
import { journalEntries, journalLines, transactionLinks } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { and, eq, desc, inArray, notInArray, sql } from "drizzle-orm";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const swept = await db.select({ toId: transactionLinks.toId }).from(transactionLinks)
    .where(and(eq(transactionLinks.orgId, orgId!), eq(transactionLinks.relation, "deposit_sweep")));
  const sweptIds = swept.map(s => s.toId);

  const entries = await db.select().from(journalEntries)
    .where(and(
      eq(journalEntries.orgId, orgId!),
      eq(journalEntries.sourceType, "Payment"),
      eq(journalEntries.status, "Posted"),
      sweptIds.length ? notInArray(journalEntries.id, sweptIds) : sql`true`,
    ))
    .orderBy(desc(journalEntries.entryDate))
    .limit(200);

  const ids = entries.map(e => e.id);
  const sums = ids.length
    ? await db.select({ entryId: journalLines.entryId, total: sql<string>`sum(${journalLines.debit})`, nameLabel: sql<string>`max(${journalLines.nameLabel})` })
        .from(journalLines).where(inArray(journalLines.entryId, ids)).groupBy(journalLines.entryId)
    : [];
  const byEntry = new Map(sums.map(s => [s.entryId, s]));

  return ok({
    payments: entries.map(e => ({
      id: e.id,
      docNumber: e.docNumber ?? `TXN-${e.txnNo ?? e.entryNumber}`,
      date: e.entryDate,
      amount: Number(byEntry.get(e.id)?.total ?? 0),
      party: byEntry.get(e.id)?.nameLabel ?? null,
    })),
  });
}
