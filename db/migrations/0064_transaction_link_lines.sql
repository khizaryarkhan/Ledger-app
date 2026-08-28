-- Line-level targeting for the transaction_links graph (lib/accounting/links.ts).
--
-- Existing links (Estimate->Invoice conversion, Payment->Invoice/Bill
-- application, GR->Bill, Shipment->Invoice) are document-header-to-header
-- only. That's not enough for a Journal Entry with multiple AR/AP lines to
-- different parties, or partial line-level settlement — QBO's own LinkedTxn
-- has exactly this via TxnLineId. from_line_id/to_line_id add that, pointing
-- at a journal_lines.id or trade_document_lines.id row.
--
-- No FK constraint, same as from_id/to_id on this table: the type is
-- polymorphic across trade_document_lines and journal_lines, so a real FK
-- isn't possible without a discriminated schema. Same tradeoff QBO itself
-- accepts with LinkedTxn — documented here rather than worked around.
ALTER TABLE "transaction_links" ADD COLUMN IF NOT EXISTS "from_line_id" uuid;
--> statement-breakpoint
ALTER TABLE "transaction_links" ADD COLUMN IF NOT EXISTS "to_line_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transaction_links_to_line_idx" ON "transaction_links" ("to_line_id") WHERE "to_line_id" IS NOT NULL;
