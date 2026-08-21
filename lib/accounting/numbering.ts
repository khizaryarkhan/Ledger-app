/**
 * Document numbering — our own per-type transaction number series.
 *
 * QBO model: every native transaction TYPE has its own auto-incrementing
 * series with an alphanumeric prefix; the number is shown on the form, is
 * user-editable, and when a user overrides it the series continues from the
 * highest value used. Numbers are our system of record — independent of any
 * external (QBO/Xero) id.
 *
 * neon-http has no transactions, so allocation is done atomically with an
 * UPDATE ... RETURNING (row-lock), after lazily seeding the row.
 */

import { db } from "@/db";
import { documentSequences } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { formatDocNumber } from "@/lib/accounting/doc-format";

export { formatDocNumber } from "@/lib/accounting/doc-format";

export type DocType =
  | "Journal" | "Invoice" | "SalesReceipt" | "Payment" | "CreditNote" | "RefundReceipt"
  | "Estimate" | "Bill" | "Expense" | "BillPayment" | "VendorCredit" | "Deposit" | "Transfer"
  | "PurchaseOrder";

// Reserved, NON-editable system series: the global per-org backend Transaction
// ID counter. Every transaction (any type) draws its immutable TXN number here,
// so the id space is shared across the whole company — like QBO's system Id.
const TXN_SERIES = { type: "__txn__", prefix: "TXN-", padding: 6 };

/** The transaction types we number, with their QBO-style defaults. */
export const DOC_TYPES: { type: DocType; label: string; prefix: string; padding: number }[] = [
  { type: "Journal",       label: "Journal Entries",   prefix: "JE-",   padding: 4 },
  { type: "Invoice",       label: "Invoices",          prefix: "INV-",  padding: 4 },
  { type: "SalesReceipt",  label: "Sales Receipts",    prefix: "SR-",   padding: 4 },
  { type: "Payment",       label: "Customer Payments", prefix: "RCP-",  padding: 4 },
  { type: "CreditNote",    label: "Credit Notes",      prefix: "CN-",   padding: 4 },
  { type: "RefundReceipt", label: "Refund Receipts",   prefix: "RFD-",  padding: 4 },
  { type: "Estimate",      label: "Estimates",         prefix: "EST-",  padding: 4 },
  { type: "PurchaseOrder", label: "Purchase Orders",   prefix: "PO-",   padding: 4 },
  { type: "Bill",          label: "Bills",             prefix: "BILL-", padding: 4 },
  { type: "Expense",       label: "Expenses",          prefix: "EXP-",  padding: 4 },
  { type: "BillPayment",   label: "Bill Payments",     prefix: "PMT-",  padding: 4 },
  { type: "VendorCredit",  label: "Supplier Credits",  prefix: "VC-",   padding: 4 },
  { type: "Deposit",       label: "Bank Deposits",     prefix: "DEP-",  padding: 4 },
  { type: "Transfer",      label: "Transfers",         prefix: "TFR-",  padding: 4 },
];

const DEFAULTS = new Map(DOC_TYPES.map(d => [d.type, d]));

/** Split a user-entered number into (prefix, numericPart). "INV-0042" -> {prefix:"INV-", n:42}. */
export function parseDocNumber(value: string): { prefix: string; n: number | null } {
  const m = String(value).match(/^(.*?)(\d+)\s*$/);
  if (!m) return { prefix: value, n: null };
  return { prefix: m[1], n: Number(m[2]) };
}

/** Ensure a sequence row exists for (org, type) with the given defaults. Idempotent. */
async function ensureSequence(orgId: string, type: string, prefix: string, padding: number) {
  await db.insert(documentSequences)
    .values({ orgId, docType: type, prefix, nextNo: 1, padding })
    .onConflictDoNothing({ target: [documentSequences.orgId, documentSequences.docType] });
}

/**
 * Atomically consume the next value of a series. Gap-free and concurrency-safe
 * on neon-http (no transactions): the UPDATE ... RETURNING row-lock serialises
 * concurrent callers. Returns the assigned number plus the series' formatting.
 */
async function allocate(orgId: string, type: string, prefix: string, padding: number): Promise<{ no: number; prefix: string; padding: number }> {
  await ensureSequence(orgId, type, prefix, padding);
  const [row] = await db.update(documentSequences)
    .set({ nextNo: sql`${documentSequences.nextNo} + 1`, updatedAt: new Date() })
    .where(and(eq(documentSequences.orgId, orgId), eq(documentSequences.docType, type)))
    .returning();
  return { no: row.nextNo - 1, prefix: row.prefix, padding: row.padding }; // row reflects the incremented value
}

/** The next document number WITHOUT consuming it — for showing a default on a form. */
export async function peekDocNumber(orgId: string, type: DocType): Promise<string> {
  const d = DEFAULTS.get(type)!;
  await ensureSequence(orgId, type, d.prefix, d.padding);
  const [row] = await db.select().from(documentSequences)
    .where(and(eq(documentSequences.orgId, orgId), eq(documentSequences.docType, type)));
  return formatDocNumber(row.prefix, row.nextNo, row.padding);
}

/** Atomically consume and return the next document number. */
export async function nextDocNumber(orgId: string, type: DocType): Promise<string> {
  const d = DEFAULTS.get(type)!;
  const a = await allocate(orgId, type, d.prefix, d.padding);
  return formatDocNumber(a.prefix, a.no, a.padding);
}

/**
 * Allocate the next global backend Transaction ID for the org — immutable,
 * system-assigned, shared across ALL transaction types (QBO-style system Id).
 * Returns the raw number (stored on the row) and its display form.
 */
export async function nextTransactionId(orgId: string): Promise<{ no: number }> {
  const a = await allocate(orgId, TXN_SERIES.type, TXN_SERIES.prefix, TXN_SERIES.padding);
  return { no: a.no };
}

/**
 * A user overrode the number — record what they used and make the series
 * continue from there (QBO behaviour): nextNo = max(nextNo, entered + 1).
 * `userValue` is the raw string they typed; returns it unchanged.
 */
export async function reconcileUserNumber(orgId: string, type: DocType, userValue: string): Promise<string> {
  const d = DEFAULTS.get(type)!;
  await ensureSequence(orgId, type, d.prefix, d.padding);
  const { n } = parseDocNumber(userValue);
  if (n != null) {
    await db.update(documentSequences)
      .set({ nextNo: sql`GREATEST(${documentSequences.nextNo}, ${n + 1})`, updatedAt: new Date() })
      .where(and(eq(documentSequences.orgId, orgId), eq(documentSequences.docType, type)));
  }
  return userValue;
}

/**
 * Resolve the document number to stamp on a transaction:
 *  - user supplied one  -> use it verbatim and advance the series past it
 *  - none supplied      -> allocate the next from the series
 */
export async function resolveDocNumber(orgId: string, type: DocType, supplied?: string | null): Promise<string> {
  const trimmed = supplied?.trim();
  if (trimmed) return reconcileUserNumber(orgId, type, trimmed);
  return nextDocNumber(orgId, type);
}
