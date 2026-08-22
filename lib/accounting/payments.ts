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

export type OpenDoc = { id: string; docNumber: string; date: string; dueDate: string | null; total: number; open: number };

export async function openDocsForParty(orgId: string, side: "customer" | "vendor", partyId: string, excludeContext?: string): Promise<OpenDoc[]> {
  const isCust = side === "customer";
  const srcType = isCust ? "Invoice" : "Bill";
  const acctType = isCust ? "Accounts Receivable" : "Accounts Payable";
  const amtCol = isCust ? journalLines.debit : journalLines.credit;   // AR sits as a debit; AP as a credit

  const rows = await db.select({
    id: journalEntries.id, docNumber: journalEntries.docNumber, entryNumber: journalEntries.entryNumber,
    date: journalEntries.entryDate, dueDate: journalEntries.dueDate, total: amtCol,
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
        .where(and(
          eq(transactionLinks.orgId, orgId), inArray(transactionLinks.toId, ids), inArray(transactionLinks.relation, ["payment", "credit"]),
          ...(excludeContext ? [sql`${transactionLinks.contextEntryId} is distinct from ${excludeContext}`] : []),
        ))
        .groupBy(transactionLinks.toId)
    : [];
  const appliedById = new Map(applied.map(a => [a.toId, Number(a.amt ?? 0)]));

  return rows.map(r => {
    const total = round2(Number(r.total ?? 0));
    const open = round2(total - (appliedById.get(r.id) ?? 0));
    return { id: r.id, docNumber: r.docNumber ?? `JE-${r.entryNumber}`, date: r.date, dueDate: r.dueDate ?? null, total, open };
  }).filter(r => r.open > 0.005).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}

export type CreditDoc = { id: string; sourceType: string; label: string; docNumber: string; date: string; total: number; open: number };

/**
 * A party's UNAPPLIED credits available to draw down on a payment: overpaid /
 * unapplied payments and credit notes (customer), or unapplied bill payments
 * and supplier credits (vendor). remaining = the credit's control-account
 * amount minus everything already applied FROM it via the links graph.
 */
export async function availableCreditsForParty(orgId: string, side: "customer" | "vendor", partyId: string, excludeContext?: string): Promise<CreditDoc[]> {
  const isCust = side === "customer";
  const acctType = isCust ? "Accounts Receivable" : "Accounts Payable";
  const nameType = isCust ? "Customer" : "Vendor";
  const srcTypes = isCust ? ["Payment", "CreditNote"] : ["BillPayment", "VendorCredit"];
  const amtCol = isCust ? journalLines.credit : journalLines.debit; // credit sits opposite to an open item

  const rows = await db.select({
    id: journalEntries.id, sourceType: journalEntries.sourceType, docNumber: journalEntries.docNumber,
    entryNumber: journalEntries.entryNumber, date: journalEntries.entryDate, amt: amtCol,
  }).from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(
      eq(journalLines.orgId, orgId), eq(journalLines.nameType, nameType), eq(journalLines.nameId, partyId),
      inArray(journalEntries.sourceType, srcTypes), eq(journalEntries.status, "Posted"), eq(accounts.type, acctType),
    ));

  const ids = rows.map(r => r.id);
  const used = ids.length
    ? await db.select({ fromId: transactionLinks.fromId, amt: sql<string>`sum(${transactionLinks.amount})` })
        .from(transactionLinks).where(and(
          eq(transactionLinks.orgId, orgId), inArray(transactionLinks.fromId, ids),
          ...(excludeContext ? [sql`${transactionLinks.contextEntryId} is distinct from ${excludeContext}`] : []),
        )).groupBy(transactionLinks.fromId)
    : [];
  const usedById = new Map(used.map(u => [u.fromId, Number(u.amt ?? 0)]));

  return rows.map(r => {
    const total = round2(Number(r.amt ?? 0));
    const open = round2(total - (usedById.get(r.id) ?? 0));
    const label = (r.sourceType === "Payment" || r.sourceType === "BillPayment") ? "Unapplied payment"
      : r.sourceType === "CreditNote" ? "Credit note" : "Supplier credit";
    return { id: r.id, sourceType: r.sourceType, label, docNumber: r.docNumber ?? `JE-${r.entryNumber}`, date: r.date, total, open };
  }).filter(r => r.open > 0.05).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}
