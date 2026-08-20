-- Multi-currency foundation (QuickBooks-style).
--   * The company's HOME currency is organisations.currency (already present);
--     multicurrency_enabled turns foreign-currency entry on.
--   * Each Name (Customer / Vendor) carries its own currency, set at first use.
--   * The GENERAL LEDGER is always kept in the HOME currency — debit/credit are
--     home amounts. The foreign amount actually entered, the currency, and the
--     exchange rate to home are stored alongside for display and FX reporting.
-- All additive & nullable — safe.

ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "multicurrency_enabled" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "currency" varchar(8);
--> statement-breakpoint
ALTER TABLE "ap_suppliers" ADD COLUMN IF NOT EXISTS "currency" varchar(8);
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "currency" varchar(8);
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "exchange_rate" numeric(18, 6);
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "fx_debit" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "fx_credit" numeric(14, 2);
