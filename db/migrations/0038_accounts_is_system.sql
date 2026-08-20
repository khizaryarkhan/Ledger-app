-- System accounts: the special accounts QuickBooks auto-creates and never lets
-- you delete (Retained Earnings, Opening Balance Equity, Undeposited Funds,
-- Uncategorised Income/Expense, A/R & A/P control accounts, Sales Tax Payable).
-- is_system marks them so the API can refuse deletion/deactivation and the UI
-- can badge them. Additive, nullable-with-default — safe.

ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "is_system" boolean NOT NULL DEFAULT false;
