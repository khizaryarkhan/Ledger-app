/**
 * Open-item tracking for payment application.
 *
 * A customer's open invoices (or a vendor's open bills) with their exact
 * remaining balance = the control-account line amount minus everything already
 * applied to it through the transaction-links graph (payments + credits). This
 * is what "Receive payment" / "Pay bill" allocate against, and it's the single
 * source of truth for what's still owed — no denormalised paid flag to drift.
 */

import { db } from "@/db";
import { accounts, journalEntries, journalLines, transactionLinks } from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type OpenDoc = { id: string; docNumber: string; date: string; total: number; open: number };

export async function openDocsForParty(orgId: string, side: "customer" | "vendor", partyId: string): Promise<OpenDoc[]> {
  const isCust = side === "customer";
  const srcType = isCust ? "Invoice" : "Bill";
  const acctType = isCust ? "Accounts Receivable" : "Accounts Payable";
  const amtCol = isCust ? journalLines.debit : journalLines.credit;   // AR sits as a debit; AP as a credit

  const rows = await db.select({
    id: journalEntries.id, docNumber: journalEntries.docNumber, entryNumber: journalEntries.entryNumber,
    date: journalEntries.entryDate, total: amtCol,
  }).from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(
      eq(journalLines.orgId, orgId),
      eq(journalLines.nameType, isCust ? "Customer" : "Vendor"),
      eq(journalLines.nameId, partyId),
      eq(journalEntries.sourceType, srcType),
      eq(journalEntries.status, "Posted"),
      eq(accounts.type, acctType),
    ));

  const ids = rows.map(r => r.id);
  const applied = ids.length
    ? await db.select({ toId: transactionLinks.toId, amt: sql<string>`sum(${transactionLinks.amount})` })
        .from(transactionLinks)
        .where(and(eq(transactionLinks.orgId, orgId), inArray(transactionLinks.toId, ids), inArray(transactionLinks.relation, ["payment", "credit"])))
        .groupBy(transactionLinks.toId)
    : [];
  const appliedById = new Map(applied.map(a => [a.toId, Number(a.amt ?? 0)]));

  return rows.map(r => {
    const total = round2(Number(r.total ?? 0));
    const open = round2(total - (appliedById.get(r.id) ?? 0));
    return { id: r.id, docNumber: r.docNumber ?? `JE-${r.entryNumber}`, date: r.date, total, open };
  }).filter(r => r.open > 0.005).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}
