-- Trade documents: Estimates (quotes) and Purchase Orders. NON-posting — they
-- have no GL impact until converted to an Invoice / Bill. One shared shape
-- (kind distinguishes them). Lines mirror the posting-document line editor.

CREATE TABLE IF NOT EXISTS "trade_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "kind" varchar(16) NOT NULL,                 -- Estimate | PurchaseOrder
  "doc_number" varchar(64),
  "party_type" varchar(16),                    -- Customer | Vendor
  "party_id" uuid,
  "party_label" varchar(255),
  "issue_date" varchar(16) NOT NULL,
  "expiry_date" varchar(16),                   -- valid-until (estimate) / delivery (PO)
  "currency" varchar(8),
  "exchange_rate" numeric(18,6),
  "status" varchar(16) NOT NULL DEFAULT 'Open',-- Open | Accepted | Converted | Closed
  "memo" text,
  "subtotal" numeric(14,2) NOT NULL DEFAULT '0',
  "tax_total" numeric(14,2) NOT NULL DEFAULT '0',
  "total" numeric(14,2) NOT NULL DEFAULT '0',
  "converted_entry_id" uuid,
  "created_by" uuid,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trade_documents_org_kind_idx" ON "trade_documents" ("org_id", "kind");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trade_document_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "account_id" uuid,
  "item_id" uuid,
  "description" text,
  "qty" numeric(14,4),
  "rate" numeric(14,4),
  "amount" numeric(14,2) NOT NULL DEFAULT '0',
  "tax_rate_id" uuid,
  "tax_amount" numeric(14,2) NOT NULL DEFAULT '0'
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trade_document_lines_doc_idx" ON "trade_document_lines" ("document_id");
