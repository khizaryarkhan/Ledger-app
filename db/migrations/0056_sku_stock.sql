-- Per-SKU stock for Stock Items & Finished Products. Cost lots keep base-UoM
-- costing but gain a stock-SKU tag; BOMs name the SKU they produce; order/
-- receive/ship lines record the stock SKU transacted.

ALTER TABLE "inventory_lots" ADD COLUMN IF NOT EXISTS "sku_id" uuid;
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "sku_id" uuid;
--> statement-breakpoint
ALTER TABLE "boms" ADD COLUMN IF NOT EXISTS "output_sku_id" uuid;
--> statement-breakpoint
ALTER TABLE "bom_lines" ADD COLUMN IF NOT EXISTS "sku_id" uuid;
--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN IF NOT EXISTS "sku_id" uuid;
--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD COLUMN IF NOT EXISTS "sku_id" uuid;
--> statement-breakpoint
ALTER TABLE "trade_document_lines" ADD COLUMN IF NOT EXISTS "sku_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_lots_sku_idx" ON "inventory_lots" ("org_id","sku_id","status");
