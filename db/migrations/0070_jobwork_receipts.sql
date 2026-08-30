-- Job work orders: support multiple partial receipts against one dispatch,
-- an explicit "close" action, and wastage/yield recognition at closure.
-- See lib/inventory/jobwork.ts and lib/inventory/genealogy.ts.
ALTER TABLE "job_work_orders" ADD COLUMN IF NOT EXISTS "closed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "job_work_orders" ADD COLUMN IF NOT EXISTS "closed_by" uuid;
--> statement-breakpoint
ALTER TABLE "job_work_orders" ADD COLUMN IF NOT EXISTS "wastage_qty" numeric(18,4);
--> statement-breakpoint
ALTER TABLE "job_work_orders" ADD COLUMN IF NOT EXISTS "wastage_amount" numeric(14,2);
--> statement-breakpoint
ALTER TABLE "job_work_orders" ADD COLUMN IF NOT EXISTS "wastage_entry_id" uuid;
--> statement-breakpoint
ALTER TABLE "job_work_orders" ADD COLUMN IF NOT EXISTS "expected_yield_pct" numeric(9,4);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_work_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "job_work_order_id" uuid NOT NULL,
  "received_item_id" uuid NOT NULL,
  "received_sku_id" uuid,
  "received_qty" numeric(18,4) NOT NULL,
  "received_lot_id" uuid,
  "receipt_id" uuid,
  "receive_date" date NOT NULL,
  "receive_entry_id" uuid,
  "processing_fee_amount" numeric(14,2) NOT NULL DEFAULT '0',
  "notes" text,
  "created_by" uuid,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_work_receipts_org_order_idx" ON "job_work_receipts" ("org_id", "job_work_order_id");
