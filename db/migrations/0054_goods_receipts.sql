-- Three-way match: goods receipts between PO and Bill. PO lines gain pack-level
-- ordering + received/billed qty tracking; new goods_receipts / _lines hold the
-- receiving step (Dr Inventory / Cr GR/IR clearing).

ALTER TABLE "trade_document_lines" ADD COLUMN IF NOT EXISTS "order_uom" varchar(16);
--> statement-breakpoint
ALTER TABLE "trade_document_lines" ADD COLUMN IF NOT EXISTS "pack_level" varchar(8);
--> statement-breakpoint
ALTER TABLE "trade_document_lines" ADD COLUMN IF NOT EXISTS "units_per_order_unit" numeric(18,6) NOT NULL DEFAULT '1';
--> statement-breakpoint
ALTER TABLE "trade_document_lines" ADD COLUMN IF NOT EXISTS "supplier_sku_id" uuid;
--> statement-breakpoint
ALTER TABLE "trade_document_lines" ADD COLUMN IF NOT EXISTS "ordered_base_qty" numeric(18,4) NOT NULL DEFAULT '0';
--> statement-breakpoint
ALTER TABLE "trade_document_lines" ADD COLUMN IF NOT EXISTS "received_qty" numeric(18,4) NOT NULL DEFAULT '0';
--> statement-breakpoint
ALTER TABLE "trade_document_lines" ADD COLUMN IF NOT EXISTS "billed_qty" numeric(18,4) NOT NULL DEFAULT '0';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "goods_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "receipt_no" varchar(32),
  "supplier_id" uuid,
  "supplier_label" varchar(255),
  "receipt_date" date NOT NULL,
  "currency" varchar(8),
  "exchange_rate" numeric(18,6),
  "status" varchar(16) NOT NULL DEFAULT 'Posted',
  "entry_id" uuid,
  "grir_total" numeric(18,4) NOT NULL DEFAULT '0',
  "billed_amount" numeric(18,4) NOT NULL DEFAULT '0',
  "notes" text,
  "created_by" uuid,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goods_receipts_org_idx" ON "goods_receipts" ("org_id","status");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "goods_receipt_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "receipt_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "po_id" uuid,
  "po_line_id" uuid,
  "description" text,
  "qty_base" numeric(18,4) NOT NULL,
  "unit_cost" numeric(18,6) NOT NULL,
  "amount" numeric(18,4) NOT NULL DEFAULT '0',
  "lot_id" uuid,
  "lot_no" varchar(64),
  "expiry_date" date,
  "billed_qty" numeric(18,4) NOT NULL DEFAULT '0',
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goods_receipt_lines_receipt_idx" ON "goods_receipt_lines" ("receipt_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goods_receipt_lines_po_idx" ON "goods_receipt_lines" ("po_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "goods_receipts"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
