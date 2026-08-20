-- Canonical Chart of Accounts: ap_accounts → accounts (first slice of the
-- QBO-shaped accounting core). The GL engine and AP module already treat this
-- as THE chart of accounts; this makes the name honest and adds the QBO-shape
-- columns the ledger reports will need (classification, parent, currency).
--
-- Safety:
--  * The rename is guarded so a neon-http partial-apply re-run can't fail on it.
--  * A compatibility VIEW keeps the old name working during the deploy window
--    (code already live still queries "ap_accounts") and for any raw reference.
--  * All new columns are nullable — no backfill required, nothing breaks.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ap_accounts' AND table_type = 'BASE TABLE')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'accounts') THEN
    EXECUTE 'ALTER TABLE "ap_accounts" RENAME TO "accounts"';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "classification" varchar(32);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "parent_id" uuid;
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "currency" varchar(8);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "sync_token" varchar(32);
--> statement-breakpoint
CREATE OR REPLACE VIEW "ap_accounts" AS SELECT * FROM "accounts";
