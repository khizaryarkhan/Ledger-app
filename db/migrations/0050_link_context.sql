-- The transaction that CREATED a link (e.g. the payment that applied a credit
-- to an invoice). Lets us cleanly undo/replace everything a payment did when it
-- is edited or reversed — including credit applications, whose link is
-- from the credit source, not the payment itself.

ALTER TABLE "transaction_links" ADD COLUMN IF NOT EXISTS "context_entry_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transaction_links_context_idx" ON "transaction_links" ("context_entry_id");
