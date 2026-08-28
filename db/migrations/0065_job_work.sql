-- Job work / subcontracting: send owned material to a vendor for external
-- processing, receive it back transformed, still owned throughout. See
-- lib/inventory/jobwork.ts. One row per dispatch->receive cycle, mirroring
-- the goods_receipts header pattern (entryId links to the GL posting).
CREATE TABLE IF NOT EXISTS "job_work_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "doc_number" varchar(32),
  "vendor_id" uuid,
  "vendor_label" varchar(255),
  "sent_item_id" uuid NOT NULL,
  "sent_sku_id" uuid,
  "sent_qty" numeric(18,4) NOT NULL,
  "sent_amount" numeric(14,2) NOT NULL DEFAULT '0',
  "dispatch_date" date NOT NULL,
  "dispatch_entry_id" uuid,
  "status" varchar(16) NOT NULL DEFAULT 'Dispatched',
  "received_item_id" uuid,
  "received_sku_id" uuid,
  "received_qty" numeric(18,4),
  "received_lot_id" uuid,
  "receipt_id" uuid,
  "receive_date" date,
  "receive_entry_id" uuid,
  "processing_fee_amount" numeric(14,2),
  "notes" text,
  "created_by" uuid,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_work_orders_org_status_idx" ON "job_work_orders" ("org_id", "status");
