/**
 * Standard starter Chart of Accounts for a NATIVE org (no QBO/Xero sync),
 * modelled on the default chart QuickBooks/Xero create for a new company.
 *
 * `classification` is the 5-way grouping reports key on (Balance Sheet =
 * Asset/Liability/Equity, P&L = Revenue/Expense). `type` mirrors QBO's
 * AccountType; `subtype` mirrors QBO's AccountSubType — and for the SPECIAL
 * system accounts the subtype is how they're identified downstream (QBO does
 * the same): RetainedEarnings, AccountsReceivable, AccountsPayable, etc.
 *
 * On Net Income / "profit for the period" — QBO does NOT keep this as a real
 * account you can post to. It's a CALCULATED line = (Income − Expense) for the
 * fiscal year, shown at the bottom of the P&L and as an equity line on the
 * Balance Sheet. At year-end the prior year's net income rolls into Retained
 * Earnings automatically. So we seed Retained Earnings (a real account) here;
 * "Net Income (current year)" is computed by the Balance Sheet report and the
 * year-end roll-forward is the period-close step — both land in the Reports
 * phase. This seed makes sure the roll-forward has a target account to land in.
 */

export type CoaSeed = {
  name: string;
  code: string;
  classification: "Asset" | "Liability" | "Equity" | "Revenue" | "Expense";
  type: string;      // QBO AccountType
  subtype?: string;  // QBO AccountSubType (identifies special/system accounts)
};

export const STANDARD_COA: CoaSeed[] = [
  // ── Assets ────────────────────────────────────────────────────────────────
  { name: "Business Bank Account", code: "1000", classification: "Asset", type: "Bank", subtype: "Checking" },
  { name: "Cash on Hand",          code: "1010", classification: "Asset", type: "Bank", subtype: "CashOnHand" },
  { name: "Accounts Receivable (A/R)", code: "1100", classification: "Asset", type: "Accounts Receivable", subtype: "AccountsReceivable" },
  { name: "Undeposited Funds",     code: "1150", classification: "Asset", type: "Other Current Asset", subtype: "UndepositedFunds" },
  { name: "Inventory Asset",       code: "1200", classification: "Asset", type: "Other Current Asset", subtype: "Inventory" },
  { name: "Prepaid Expenses",      code: "1400", classification: "Asset", type: "Other Current Asset", subtype: "PrepaidExpenses" },
  { name: "Fixed Assets",          code: "1500", classification: "Asset", type: "Fixed Asset", subtype: "MachineryAndEquipment" },
  { name: "Accumulated Depreciation", code: "1510", classification: "Asset", type: "Fixed Asset", subtype: "AccumulatedDepreciation" },

  // ── Liabilities ─────────────────────────────────────────────────────────────
  { name: "Accounts Payable (A/P)", code: "2000", classification: "Liability", type: "Accounts Payable", subtype: "AccountsPayable" },
  { name: "Credit Card",           code: "2100", classification: "Liability", type: "Credit Card", subtype: "CreditCard" },
  { name: "Sales Tax Payable",     code: "2200", classification: "Liability", type: "Other Current Liability", subtype: "SalesTaxPayable" },
  { name: "Payroll Liabilities",   code: "2300", classification: "Liability", type: "Other Current Liability", subtype: "PayrollTaxPayable" },
  { name: "Loan Payable",          code: "2700", classification: "Liability", type: "Long Term Liability", subtype: "NotesPayable" },

  // ── Equity (incl. the special system accounts) ──────────────────────────────
  { name: "Opening Balance Equity", code: "3000", classification: "Equity", type: "Equity", subtype: "OpeningBalanceEquity" },
  { name: "Owner's Equity",        code: "3100", classification: "Equity", type: "Equity", subtype: "OwnersEquity" },
  { name: "Owner's Drawings",      code: "3200", classification: "Equity", type: "Equity", subtype: "PartnerDistributions" },
  { name: "Retained Earnings",     code: "3900", classification: "Equity", type: "Equity", subtype: "RetainedEarnings" },

  // ── Income ──────────────────────────────────────────────────────────────────
  { name: "Sales",                 code: "4000", classification: "Revenue", type: "Income", subtype: "SalesOfProductIncome" },
  { name: "Services",              code: "4100", classification: "Revenue", type: "Income", subtype: "ServiceFeeIncome" },
  { name: "Other Income",          code: "4900", classification: "Revenue", type: "Other Income", subtype: "OtherMiscellaneousIncome" },
  { name: "Uncategorised Income",  code: "4999", classification: "Revenue", type: "Income", subtype: "UnappliedCashPaymentIncome" },

  // ── Cost of Goods Sold ───────────────────────────────────────────────────────
  { name: "Cost of Goods Sold",    code: "5000", classification: "Expense", type: "Cost of Goods Sold", subtype: "SuppliesMaterialsCogs" },

  // ── Expenses ─────────────────────────────────────────────────────────────────
  { name: "Advertising & Marketing", code: "6000", classification: "Expense", type: "Expense", subtype: "AdvertisingPromotional" },
  { name: "Bank Charges & Fees",   code: "6100", classification: "Expense", type: "Expense", subtype: "BankCharges" },
  { name: "Rent & Lease",          code: "6200", classification: "Expense", type: "Expense", subtype: "RentOrLeaseOfBuildings" },
  { name: "Office Supplies",       code: "6300", classification: "Expense", type: "Expense", subtype: "OfficeGeneralAdministrativeExpenses" },
  { name: "Utilities",             code: "6400", classification: "Expense", type: "Expense", subtype: "Utilities" },
  { name: "Travel",                code: "6500", classification: "Expense", type: "Expense", subtype: "Travel" },
  { name: "Meals & Entertainment", code: "6600", classification: "Expense", type: "Expense", subtype: "EntertainmentMeals" },
  { name: "Professional Fees",     code: "6700", classification: "Expense", type: "Expense", subtype: "LegalProfessionalFees" },
  { name: "Payroll Expenses",      code: "6800", classification: "Expense", type: "Expense", subtype: "PayrollExpenses" },
  { name: "Depreciation Expense",  code: "6900", classification: "Expense", type: "Expense", subtype: "Depreciation" },
  { name: "Uncategorised Expense", code: "6999", classification: "Expense", type: "Expense", subtype: "OtherMiscellaneousServiceCost" },
];
