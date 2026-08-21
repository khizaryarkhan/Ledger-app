-- Backend Transaction ID + external-system linkage on journal_entries.
--
-- txn_no: our own immutable, system-assigned transaction number (QBO-style),
--   global per org across ALL transaction types, displayed as TXN-000123.
--   Distinct from the editable doc_number and the internal audit entry_number.
--   NULLs are allowed for pre-existing rows (Postgres treats NULLs as distinct
--   in a unique index, so multiple un-numbered rows coexist fine).
-- external_*: when a transaction is synced from / mirrored to QBO or Xero, we
--   keep BOTH our id and theirs so it round-trips.

ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "txn_no" integer;
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "external_id" varchar(64);
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "external_source" varchar(16);
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "external_sync_token" varchar(64);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "journal_entries_org_txn_no_unique" ON "journal_entries" ("org_id", "txn_no");
