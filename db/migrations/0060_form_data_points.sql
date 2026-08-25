-- Data points that entry forms collect but had nowhere to save (audit fix).
-- All additive + nullable — safe on existing rows.

-- Customer "Payment method" (CustomerModal collects it; had no column).
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "payment_method" varchar(64);
--> statement-breakpoint

-- Payment / Bill-payment "Payment method" (was being stuffed into the memo string).
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "payment_method" varchar(32);
--> statement-breakpoint

-- Class / Location on Estimate / PO / Sales-order lines (the form shows the
-- dimension pickers but trade_document_lines had nowhere to store them).
ALTER TABLE "trade_document_lines" ADD COLUMN IF NOT EXISTS "class_id" uuid;
--> statement-breakpoint
ALTER TABLE "trade_document_lines" ADD COLUMN IF NOT EXISTS "location_id" uuid;
