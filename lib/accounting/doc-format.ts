/**
 * Pure ID/number formatters — no DB, no server-only imports, so both server
 * code (lib/accounting/numbering.ts) and client components can use them.
 */

/** Format prefix + zero-padded number: ("JE-", 7, 4) -> "JE-0007". */
export function formatDocNumber(prefix: string, no: number, padding: number): string {
  const digits = String(Math.max(0, Math.trunc(no)));
  return `${prefix}${padding > 0 ? digits.padStart(padding, "0") : digits}`;
}

/** The readable, immutable backend Transaction ID (QBO-style): 123 -> "TXN-000123". */
export function formatTxnId(no: number | null | undefined): string {
  if (no == null) return "—";
  return `TXN-${String(Math.max(0, Math.trunc(no))).padStart(6, "0")}`;
}

/** Human label for a journal entry's source_type — the "nature" of the posting. */
export const TXN_TYPE_LABEL: Record<string, string> = {
  Manual: "Journal", Reversal: "Reversal", Closing: "Year-end close",
  Invoice: "Invoice", SalesReceipt: "Sales Receipt", CreditNote: "Credit Note",
  RefundReceipt: "Refund", Payment: "Payment", Bill: "Bill", Expense: "Expense",
  BillPayment: "Bill Payment", VendorCredit: "Supplier Credit", Deposit: "Bank Deposit",
  Transfer: "Transfer",
};
export function txnTypeLabel(sourceType: string | null | undefined): string {
  if (!sourceType) return "Journal";
  return TXN_TYPE_LABEL[sourceType] ?? sourceType;
}
