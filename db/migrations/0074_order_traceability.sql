ALTER TABLE "manufacturing_orders" ADD COLUMN "sales_order_id" uuid;
--> statement-breakpoint
ALTER TABLE "job_work_orders" ADD COLUMN "sales_order_id" uuid;
--> statement-breakpoint
ALTER TABLE "trade_documents" ADD COLUMN "sales_order_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "manufacturing_orders_so_idx" ON "manufacturing_orders" ("sales_order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_work_orders_so_idx" ON "job_work_orders" ("sales_order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trade_documents_so_idx" ON "trade_documents" ("sales_order_id");
