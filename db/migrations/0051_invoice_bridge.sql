-- Bridge native accounting invoices into the Receivable/collections module.
-- A native Invoice posts to the GL (journal_entries, type Invoice); this links
-- the collections `invoices` row back to that GL entry so the two stay in sync
-- (payment status, edits, reversal).

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "journal_entry_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_journal_entry_idx" ON "invoices" ("journal_entry_id");
