-- Transaction links — an explicit relationship graph between any two documents.
--
-- Better than QBO/QBD's implicit LinkedTxn array: it is queryable in BOTH
-- directions, supports 1:1, 1:many and many:1, and carries a per-link `amount`
-- (how much of the source this link consumes) so progress invoicing and
-- payment application can track remaining balances exactly.
--
-- A document's home table is inferred from its type: Estimate / PurchaseOrder
-- live in trade_documents; every posted type (Invoice, Bill, Payment, …) lives
-- in journal_entries.

CREATE TABLE IF NOT EXISTS "transaction_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "from_type" varchar(24) NOT NULL,
  "from_id" uuid NOT NULL,
  "to_type" varchar(24) NOT NULL,
  "to_id" uuid NOT NULL,
  "relation" varchar(24) NOT NULL,          -- progress_invoice | conversion | po_bill | payment | credit
  "amount" numeric(14,2) NOT NULL DEFAULT '0',
  "created_by" uuid,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transaction_links_org_from_idx" ON "transaction_links" ("org_id", "from_type", "from_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transaction_links_org_to_idx" ON "transaction_links" ("org_id", "to_type", "to_id");
--> statement-breakpoint
-- Running net amount of each estimate/PO line already invoiced/billed, so we
-- can compute per-line remaining for progress invoicing.
ALTER TABLE "trade_document_lines" ADD COLUMN IF NOT EXISTS "invoiced_amount" numeric(14,2) NOT NULL DEFAULT '0';
