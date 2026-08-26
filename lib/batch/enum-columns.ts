/**
 * Fixed-choice (enum) template columns → their allowed values, so the Excel
 * template can carry a dropdown even when the value isn't a QuickBooks list
 * record (Customer/Item/Account/… — those live in ref-columns.ts).
 *
 * Unlike reference dropdowns, these values are STATIC, so they're added to
 * every template regardless of whether a QBO connection exists — which is the
 * whole point: they help a user prepare valid import data offline.
 *
 * Every value here is authoritative — it matches what the upload parser
 * (lib/batch/builders.ts) accepts, or the QBO enum the builder passes straight
 * through — so a value picked from the dropdown never fails on import:
 *   - booleans → `bool()` accepts yes/no (builders.ts)
 *   - Item "Type" → normalised to Inventory | NonInventory | Service (buildItem)
 *   - "Account Type" → QBO AccountType enum (buildAccount passes it through)
 *   - Estimate/PO status, Billable status, Print/Email status → QBO enums
 */

import { CURRENCIES } from "@/lib/accounting/currencies";

const YES_NO = ["Yes", "No"];
const BILLABLE = ["Billable", "NotBillable", "HasBeenBilled"];
// QBO AccountType enum (the fixed 15 — AccountSubType is deliberately NOT offered:
// it's a large, type-dependent set and a wrong pick would fail the import).
const ACCOUNT_TYPES = [
  "Bank", "Accounts Receivable", "Other Current Asset", "Fixed Asset", "Other Asset",
  "Accounts Payable", "Credit Card", "Other Current Liability", "Long Term Liability",
  "Equity", "Income", "Cost of Goods Sold", "Expense", "Other Income", "Other Expense",
];
const CURRENCY_CODES = CURRENCIES.map((c) => c.code);

// Columns the parser reads through bool() → yes/no.
const BOOLEAN_COLS = new Set([
  "apply tax after discount", "show sub total", "taxable", "customer taxable",
  "expense taxable", "line item taxable", "product/service taxable", "billable time",
]);
const BILLABLE_COLS = new Set([
  "billable status", "expense billable status",
  "line item billable status", "product/service billable status",
]);

/** Allowed values for a fixed-choice column, or null if it isn't one. */
export function enumValuesForColumn(column: string): string[] | null {
  const c = column.trim().toLowerCase();
  if (BOOLEAN_COLS.has(c)) return YES_NO;
  if (BILLABLE_COLS.has(c)) return BILLABLE;
  if (c === "print status") return ["NotSet", "NeedToPrint", "PrintComplete"];
  if (c === "email status") return ["NotSet", "NeedToSend", "EmailSent"];
  if (c === "estimate status") return ["Pending", "Accepted", "Closed", "Rejected"];
  if (c === "purchase order status") return ["Open", "Closed"];
  if (c === "type") return ["Inventory", "NonInventory", "Service"]; // Item template only
  if (c === "account type") return ACCOUNT_TYPES;
  if (c === "currency code") return CURRENCY_CODES;
  return null;
}

export interface EnumColumn { column: string; values: string[]; }

/** Every fixed-choice column of a template, in column order (deduped). */
export function entityEnumColumns(columns: string[]): EnumColumn[] {
  const out: EnumColumn[] = [];
  const seen = new Set<string>();
  for (const col of columns) {
    const c = col.trim();
    if (seen.has(c)) continue;
    seen.add(c);
    const values = enumValuesForColumn(c);
    if (values && values.length) out.push({ column: c, values });
  }
  return out;
}
