/**
 * Account Type taxonomy — the backbone that turns a chart of accounts into
 * financial statements. Modelled on QuickBooks' AccountType / AccountSubType,
 * but each type also carries where it lands on the statements per IFRS /
 * Pakistan Companies Act 2017 presentation:
 *
 *   - `classification`  : the 5-way GL grouping (Asset/Liability/Equity/Revenue/Expense)
 *   - `statement`       : which primary statement it appears on
 *   - `section`         : the line-item section within that statement (IFRS order)
 *   - `normalBalance`   : debit or credit — the side that increases the account
 *
 * This single table drives the Chart-of-Accounts create form (Type → Subtype
 * dropdowns) AND the report engine (which section each balance rolls into).
 */

export type Classification = "Asset" | "Liability" | "Equity" | "Revenue" | "Expense";
export type Statement = "balance_sheet" | "profit_loss";
export type NormalBalance = "debit" | "credit";

// Balance-sheet sections, in presentation order (Statement of Financial Position).
export type BsSection =
  | "Non-current Assets" | "Current Assets"
  | "Equity"
  | "Non-current Liabilities" | "Current Liabilities";
// P&L sections, in presentation order (Statement of Profit or Loss).
export type PlSection =
  | "Revenue" | "Cost of Sales" | "Other Income"
  | "Operating Expenses" | "Finance Costs" | "Taxation";

export type AccountTypeDef = {
  type: string;                 // QBO AccountType label (shown in the UI)
  classification: Classification;
  statement: Statement;
  section: BsSection | PlSection;
  normalBalance: NormalBalance;
  order: number;                // presentation order across the statement
  subtypes: string[];           // QBO AccountSubType labels
};

export const ACCOUNT_TYPES: AccountTypeDef[] = [
  // ── Balance Sheet · Assets ──────────────────────────────────────────────
  { type: "Fixed Asset", classification: "Asset", statement: "balance_sheet", section: "Non-current Assets", normalBalance: "debit", order: 10,
    subtypes: ["Property", "Buildings", "Land", "Machinery & Equipment", "Vehicles", "Furniture & Fixtures", "Leasehold Improvements", "Accumulated Depreciation"] },
  { type: "Other Asset", classification: "Asset", statement: "balance_sheet", section: "Non-current Assets", normalBalance: "debit", order: 11,
    subtypes: ["Goodwill", "Intangible Assets", "Long-term Investments", "Security Deposits", "Other Long-term Assets"] },
  { type: "Bank", classification: "Asset", statement: "balance_sheet", section: "Current Assets", normalBalance: "debit", order: 20,
    subtypes: ["Checking", "Savings", "Cash on Hand", "Money Market"] },
  { type: "Accounts Receivable", classification: "Asset", statement: "balance_sheet", section: "Current Assets", normalBalance: "debit", order: 21,
    subtypes: ["Accounts Receivable"] },
  { type: "Other Current Asset", classification: "Asset", statement: "balance_sheet", section: "Current Assets", normalBalance: "debit", order: 22,
    subtypes: ["Inventory", "Undeposited Funds", "Prepaid Expenses", "Short-term Investments", "Loans to Others", "Allowance for Bad Debts", "Advance Tax", "Other Current Assets"] },

  // ── Balance Sheet · Equity ──────────────────────────────────────────────
  { type: "Equity", classification: "Equity", statement: "balance_sheet", section: "Equity", normalBalance: "credit", order: 30,
    subtypes: ["Share Capital", "Common Stock", "Paid-in Capital", "Owner's Equity", "Partner Contributions", "Partner Distributions", "Owner's Drawings", "Opening Balance Equity", "Retained Earnings"] },

  // ── Balance Sheet · Liabilities ─────────────────────────────────────────
  { type: "Long Term Liability", classification: "Liability", statement: "balance_sheet", section: "Non-current Liabilities", normalBalance: "credit", order: 40,
    subtypes: ["Notes Payable", "Bank Loans", "Shareholder Notes Payable", "Deferred Tax", "Other Long-term Liabilities"] },
  { type: "Accounts Payable", classification: "Liability", statement: "balance_sheet", section: "Current Liabilities", normalBalance: "credit", order: 50,
    subtypes: ["Accounts Payable"] },
  { type: "Credit Card", classification: "Liability", statement: "balance_sheet", section: "Current Liabilities", normalBalance: "credit", order: 51,
    subtypes: ["Credit Card"] },
  { type: "Other Current Liability", classification: "Liability", statement: "balance_sheet", section: "Current Liabilities", normalBalance: "credit", order: 52,
    subtypes: ["Sales Tax Payable", "Payroll Tax Payable", "Payroll Clearing", "Accrued Liabilities", "Income Tax Payable", "Current Portion of Long-term Liabilities", "Due to Related Parties", "Other Current Liabilities"] },

  // ── Profit & Loss ────────────────────────────────────────────────────────
  { type: "Income", classification: "Revenue", statement: "profit_loss", section: "Revenue", normalBalance: "credit", order: 60,
    subtypes: ["Sales of Product Income", "Service/Fee Income", "Sales - Retail", "Discounts/Refunds Given", "Other Primary Income", "Unapplied Cash Payment Income"] },
  { type: "Cost of Goods Sold", classification: "Expense", statement: "profit_loss", section: "Cost of Sales", normalBalance: "debit", order: 65,
    subtypes: ["Supplies & Materials - COGS", "Cost of Labour - COS", "Equipment Rental - COS", "Shipping, Freight & Delivery - COS", "Other Costs of Services - COS"] },
  { type: "Other Income", classification: "Revenue", statement: "profit_loss", section: "Other Income", normalBalance: "credit", order: 70,
    subtypes: ["Interest Earned", "Dividend Income", "Other Investment Income", "Gain/Loss on Sale of Fixed Assets", "Other Miscellaneous Income"] },
  { type: "Expense", classification: "Expense", statement: "profit_loss", section: "Operating Expenses", normalBalance: "debit", order: 75,
    subtypes: ["Advertising & Marketing", "Bank Charges", "Rent or Lease of Buildings", "Office/General Administrative Expenses", "Utilities", "Travel", "Entertainment & Meals", "Legal & Professional Fees", "Payroll Expenses", "Repairs & Maintenance", "Insurance", "Depreciation", "Supplies", "Taxes & Licenses", "Other Miscellaneous Expense"] },
  { type: "Other Expense", classification: "Expense", statement: "profit_loss", section: "Finance Costs", normalBalance: "debit", order: 80,
    subtypes: ["Interest Paid", "Bank Loan Interest", "Exchange Gain/Loss", "Amortization", "Penalties & Settlements", "Other Expense"] },
];

// ── Lookups ─────────────────────────────────────────────────────────────────
export const ACCOUNT_TYPE_NAMES = ACCOUNT_TYPES.map((t) => t.type);
const BY_TYPE = new Map(ACCOUNT_TYPES.map((t) => [t.type, t]));

export function typeDef(type: string | null | undefined): AccountTypeDef | undefined {
  return type ? BY_TYPE.get(type) : undefined;
}
export function classificationForType(type: string | null | undefined): Classification | null {
  return typeDef(type)?.classification ?? null;
}
export function subtypesForType(type: string | null | undefined): string[] {
  return typeDef(type)?.subtypes ?? [];
}

// Presentation order for statement sections.
export const BS_SECTIONS: BsSection[] = ["Non-current Assets", "Current Assets", "Equity", "Non-current Liabilities", "Current Liabilities"];
export const PL_SECTIONS: PlSection[] = ["Revenue", "Cost of Sales", "Other Income", "Operating Expenses", "Finance Costs", "Taxation"];
