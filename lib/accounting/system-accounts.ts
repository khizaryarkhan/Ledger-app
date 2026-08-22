/**
 * System accounts — the special accounts QuickBooks (Desktop & Online)
 * auto-creates for every company and never lets you delete, because the books
 * and the year-end close depend on them. We create the same set for every org
 * and flag them is_system so they can't be removed or deactivated.
 *
 * Identified by QBO's canonical AccountSubType, so if the org already synced an
 * equivalent from QBO/Xero we reuse (and protect) it instead of duplicating.
 */

import { db } from "@/db";
import { accounts } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { CoaSeed } from "./standard-coa";

export const SYSTEM_ACCOUNTS: CoaSeed[] = [
  // Control accounts — the subledgers (AR / AP) roll up into these.
  { name: "Accounts Receivable (A/R)", code: "1100", classification: "Asset",     type: "Accounts Receivable",      subtype: "AccountsReceivable" },
  { name: "Accounts Payable (A/P)",    code: "2000", classification: "Liability",  type: "Accounts Payable",         subtype: "AccountsPayable" },
  // Payment holding + tax control.
  { name: "Undeposited Funds",         code: "1150", classification: "Asset",     type: "Other Current Asset",      subtype: "UndepositedFunds" },
  { name: "Sales Tax Payable",         code: "2200", classification: "Liability", type: "Other Current Liability",  subtype: "SalesTaxPayable" },
  // Equity — opening balances + the year-end close target.
  { name: "Opening Balance Equity",    code: "3000", classification: "Equity",    type: "Equity",                   subtype: "OpeningBalanceEquity" },
  { name: "Retained Earnings",         code: "3900", classification: "Equity",    type: "Equity",                   subtype: "RetainedEarnings" },
  // Catch-alls used by opening balances / unmatched transactions.
  { name: "Uncategorised Income",      code: "4999", classification: "Revenue",   type: "Income",                   subtype: "UnappliedCashPaymentIncome" },
  { name: "Uncategorised Expense",     code: "6999", classification: "Expense",   type: "Expense",                  subtype: "OtherMiscellaneousServiceCost" },
  // Multi-currency: realised FX difference on settling foreign transactions.
  { name: "Exchange Gain or Loss",     code: "6950", classification: "Expense",   type: "Other Expense",            subtype: "ExchangeGainOrLoss" },
  // Perpetual inventory — default routing for inventory-tracked items. Purchases
  // capitalise here; sales/consumption relieve to COGS; adjustments to shrinkage.
  { name: "Inventory Asset",           code: "1200", classification: "Asset",     type: "Other Current Asset",      subtype: "Inventory" },
  { name: "Cost of Goods Sold",        code: "5000", classification: "Expense",   type: "Cost of Goods Sold",       subtype: "SuppliesMaterialsCogs" },
  { name: "Inventory Adjustments",     code: "5900", classification: "Expense",   type: "Cost of Goods Sold",       subtype: "OtherCostsOfServiceCos" },
];

/** Look up a system account for an org by its canonical subtype (case-insensitive). */
export async function systemAccountId(orgId: string, subtype: string): Promise<string | null> {
  const rows = await db.select({ id: accounts.id, subtype: accounts.subtype })
    .from(accounts).where(eq(accounts.orgId, orgId));
  const hit = rows.find(r => (r.subtype ?? "").toLowerCase() === subtype.toLowerCase());
  return hit?.id ?? null;
}

/** Canonical subtypes for the inventory system accounts (lookup keys). */
export const INV_SUBTYPE = { asset: "Inventory", cogs: "SuppliesMaterialsCogs", shrinkage: "OtherCostsOfServiceCos" } as const;

const SYSTEM_SUBTYPES = SYSTEM_ACCOUNTS.map(a => a.subtype!).filter(Boolean);

/**
 * Guarantee the org has all system accounts and that any matching account
 * (native OR synced) is flagged is_system. Idempotent — safe to call often.
 * Matches an existing account by canonical subtype OR by name so we never
 * duplicate a Retained Earnings that QBO/Xero already synced.
 */
export async function ensureSystemAccounts(orgId: string): Promise<void> {
  const existing = await db
    .select({ id: accounts.id, name: accounts.name, subtype: accounts.subtype, isSystem: accounts.isSystem })
    .from(accounts)
    .where(eq(accounts.orgId, orgId));

  // 1. Protect any existing account that IS a system account (by subtype).
  const toProtect = existing.filter(a => a.subtype && SYSTEM_SUBTYPES.includes(a.subtype) && !a.isSystem).map(a => a.id);
  if (toProtect.length) {
    await db.update(accounts).set({ isSystem: true }).where(and(eq(accounts.orgId, orgId), inArray(accounts.id, toProtect)));
  }

  // 2. Insert any system account the org doesn't have yet (match by subtype or name).
  const haveSub = new Set(existing.map(a => (a.subtype ?? "").toLowerCase()).filter(Boolean));
  const haveName = new Set(existing.map(a => a.name.trim().toLowerCase()));
  const missing = SYSTEM_ACCOUNTS.filter(a => !haveSub.has((a.subtype ?? "").toLowerCase()) && !haveName.has(a.name.toLowerCase()));
  if (missing.length) {
    await db.insert(accounts).values(missing.map(a => ({
      orgId, source: "native", name: a.name, code: a.code,
      classification: a.classification, type: a.type, subtype: a.subtype ?? null,
      status: "Active", isSystem: true,
    })));
  }
}
