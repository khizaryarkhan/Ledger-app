/**
 * Management analysis built from the native GL: AR/AP aging and sales-tax
 * liability. All derived from journal_lines + the transaction-links graph so
 * they need no QBO/Xero sync and always tie to the ledger.
 */

import { db } from "@/db";
import { accounts, journalEntries, journalLines, transactionLinks } from "@/db/schema";
import { and, eq, inArray, lte, gte, sql } from "drizzle-orm";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v: any) => Number(v ?? 0);
const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

export type AgingRow = {
  id: string; docNumber: string; party: string; date: string; dueDate: string | null;
  total: number; open: number; bucket: "current" | "1-30" | "31-60" | "61-90" | "90+";
};
export type Aging = { rows: AgingRow[]; buckets: Record<string, number>; total: number; asOf: string };

/** Aged open receivables (side=receivable) or payables (side=payable). */
export async function aging(orgId: string, side: "receivable" | "payable", asOf = today()): Promise<Aging> {
  const isAR = side === "receivable";
  const srcType = isAR ? "Invoice" : "Bill";
  const acctType = isAR ? "Accounts Receivable" : "Accounts Payable";
  const amtCol = isAR ? journalLines.debit : journalLines.credit;

  const rows = await db.select({
    id: journalEntries.id, docNumber: journalEntries.docNumber, entryNumber: journalEntries.entryNumber,
    date: journalEntries.entryDate, dueDate: journalEntries.dueDate, total: amtCol, party: journalLines.nameLabel,
  }).from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(
      eq(journalLines.orgId, orgId), eq(journalEntries.sourceType, srcType),
      inArray(journalEntries.status, ["Posted", "Reversed"]), eq(accounts.type, acctType),
      lte(journalEntries.entryDate, asOf),
    ));

  const ids = rows.map(r => r.id);
  const applied = ids.length
    ? await db.select({ toId: transactionLinks.toId, amt: sql<string>`sum(${transactionLinks.amount})` }).from(transactionLinks)
        .where(and(eq(transactionLinks.orgId, orgId), inArray(transactionLinks.toId, ids), inArray(transactionLinks.relation, ["payment", "credit"]))).groupBy(transactionLinks.toId)
    : [];
  const paidById = new Map(applied.map(a => [a.toId, num(a.amt)]));

  const buckets: Record<string, number> = { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  const out: AgingRow[] = [];
  for (const r of rows) {
    const total = r2(num(r.total));
    const open = r2(total - (paidById.get(r.id) ?? 0));
    if (open <= 0.005) continue;
    const overdue = r.dueDate ? daysBetween(asOf, r.dueDate) : 0;
    const bucket: AgingRow["bucket"] = overdue <= 0 ? "current" : overdue <= 30 ? "1-30" : overdue <= 60 ? "31-60" : overdue <= 90 ? "61-90" : "90+";
    buckets[bucket] = r2(buckets[bucket] + open);
    out.push({ id: r.id, docNumber: r.docNumber ?? `JE-${r.entryNumber}`, party: r.party || "—", date: r.date, dueDate: r.dueDate ?? null, total, open, bucket });
  }
  out.sort((a, b) => (a.dueDate || a.date || "").localeCompare(b.dueDate || b.date || ""));
  return { rows: out, buckets, total: r2(out.reduce((s, r) => s + r.open, 0)), asOf };
}

export type TaxLiability = {
  from: string; to: string; outputTax: number; inputTax: number; adjustments: number;
  netLiability: number; openingBalance: number; closingBalance: number;
};

/**
 * Sales-tax (VAT/GST) liability for a period: output tax collected on sales
 * (credits to the Sales Tax Payable control) minus input tax reclaimed on
 * purchases (debits), plus opening/closing balance of the control account.
 */
export async function taxLiability(orgId: string, from: string, to: string): Promise<TaxLiability> {
  const taxAccts = await db.select({ id: accounts.id }).from(accounts)
    .where(and(eq(accounts.orgId, orgId), sql`lower(${accounts.subtype}) = 'salestaxpayable'`));
  const ids = taxAccts.map(a => a.id);
  if (!ids.length) return { from, to, outputTax: 0, inputTax: 0, adjustments: 0, netLiability: 0, openingBalance: 0, closingBalance: 0 };

  // Opening balance (liability = credit − debit) strictly before `from`.
  const [open] = await db.select({ d: sql<string>`coalesce(sum(${journalLines.debit}),0)`, c: sql<string>`coalesce(sum(${journalLines.credit}),0)` })
    .from(journalLines).innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalLines.orgId, orgId), inArray(journalLines.accountId, ids), inArray(journalEntries.status, ["Posted", "Reversed"]), sql`${journalEntries.entryDate} < ${from}`));
  const openingBalance = r2(num(open?.c) - num(open?.d));

  // Period activity, split by whether the entry is a sale or a purchase.
  const periodLines = await db.select({ src: journalEntries.sourceType, debit: journalLines.debit, credit: journalLines.credit })
    .from(journalLines).innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalLines.orgId, orgId), inArray(journalLines.accountId, ids), inArray(journalEntries.status, ["Posted", "Reversed"]),
      gte(journalEntries.entryDate, from), lte(journalEntries.entryDate, to)));
  const SALES = new Set(["Invoice", "SalesReceipt", "CreditNote", "RefundReceipt"]);
  const PURCH = new Set(["Bill", "Expense", "VendorCredit"]);
  let outputTax = 0, inputTax = 0, adjustments = 0;
  for (const l of periodLines) {
    const net = num(l.credit) - num(l.debit); // + = increases liability
    if (SALES.has(l.src ?? "")) outputTax = r2(outputTax + net);
    else if (PURCH.has(l.src ?? "")) inputTax = r2(inputTax - net); // debits on purchases reclaim tax
    else adjustments = r2(adjustments + net); // manual journals / payments to authority
  }
  const netLiability = r2(outputTax - inputTax + adjustments);
  return { from, to, outputTax, inputTax, adjustments, netLiability, openingBalance, closingBalance: r2(openingBalance + netLiability) };
}
