-- Transaction terms & reference on posted documents.
--
-- due_date: when an Invoice/Bill is payable — the basis for A/R & A/P aging and
--   overdue tracking. Derived from payment terms (Net 30, etc.) but editable.
-- reference: a free reference — a supplier's own bill/invoice number, or a
--   customer PO — for matching and audit.

ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "due_date" varchar(16);
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "reference" varchar(64);
