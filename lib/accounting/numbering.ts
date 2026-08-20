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

export type DocType = "Journal" | "Invoice" | "Bill" | "Payment" | "CreditNote" | "Estimate" | "VendorCredit";

/** The transaction types we number, with their QBO-style defaults. */
export const DOC_TYPES: { type: DocType; label: string; prefix: string; padding: number }[] = [
  { type: "Journal",     label: "Journal Entries", prefix: "JE-",   padding: 4 },
  { type: "Invoice",     label: "Invoices",        prefix: "INV-",  padding: 4 },
  { type: "Bill",        label: "Bills",           prefix: "BILL-", padding: 4 },
  { type: "Payment",     label: "Payments",        prefix: "PMT-",  padding: 4 },
  { type: "CreditNote",  label: "Credit Notes",    prefix: "CN-",   padding: 4 },
  { type: "Estimate",    label: "Estimates",       prefix: "EST-",  padding: 4 },
  { type: "VendorCredit",label: "Vendor Credits",  prefix: "VC-",   padding: 4 },
];

const DEFAULTS = new Map(DOC_TYPES.map(d => [d.type, d]));

/** Format prefix + zero-padded number: ("JE-", 7, 4) -> "JE-0007". */
export function formatDocNumber(prefix: string, no: number, padding: number): string {
  const digits = String(Math.max(0, Math.trunc(no)));
  return `${prefix}${padding > 0 ? digits.padStart(padding, "0") : digits}`;
}

/** Split a user-entered number into (prefix, numericPart). "INV-0042" -> {prefix:"INV-", n:42}. */
export function parseDocNumber(value: string): { prefix: string; n: number | null } {
  const m = String(value).match(/^(.*?)(\d+)\s*$/);
  if (!m) return { prefix: value, n: null };
  return { prefix: m[1], n: Number(m[2]) };
}

/** Ensure a sequence row exists for (org, type). Idempotent. */
async function ensureSequence(orgId: string, type: DocType) {
  const d = DEFAULTS.get(type)!;
  await db.insert(documentSequences)
    .values({ orgId, docType: type, prefix: d.prefix, nextNo: 1, padding: d.padding })
    .onConflictDoNothing({ target: [documentSequences.orgId, documentSequences.docType] });
}

/** The next number WITHOUT consuming it — for showing a default on a form. */
export async function peekDocNumber(orgId: string, type: DocType): Promise<string> {
  await ensureSequence(orgId, type);
  const [row] = await db.select().from(documentSequences)
    .where(and(eq(documentSequences.orgId, orgId), eq(documentSequences.docType, type)));
  return formatDocNumber(row.prefix, row.nextNo, row.padding);
}

/** Atomically consume and return the next number. Gap-free, concurrency-safe. */
export async function nextDocNumber(orgId: string, type: DocType): Promise<string> {
  await ensureSequence(orgId, type);
  const [row] = await db.update(documentSequences)
    .set({ nextNo: sql`${documentSequences.nextNo} + 1`, updatedAt: new Date() })
    .where(and(eq(documentSequences.orgId, orgId), eq(documentSequences.docType, type)))
    .returning();
  // row now reflects the incremented value; the assigned number is nextNo - 1.
  return formatDocNumber(row.prefix, row.nextNo - 1, row.padding);
}

/**
 * A user overrode the number — record what they used and make the series
 * continue from there (QBO behaviour): nextNo = max(nextNo, entered + 1).
 * `userValue` is the raw string they typed; returns it unchanged.
 */
export async function reconcileUserNumber(orgId: string, type: DocType, userValue: string): Promise<string> {
  await ensureSequence(orgId, type);
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
