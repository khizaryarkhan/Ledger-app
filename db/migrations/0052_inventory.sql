-- Inventory register: product types (Finished Product / Raw Material), a base
-- UoM at item level, packaging SKUs (finished products) and supplier SKUs (raw
-- materials, with a base↔supplier conversion factor for cross-dimension units).

ALTER TABLE "ap_items" ADD COLUMN IF NOT EXISTS "product_type" varchar(24) NOT NULL DEFAULT 'FinishedProduct';
--> statement-breakpoint
ALTER TABLE "ap_items" ADD COLUMN IF NOT EXISTS "base_uom" varchar(16);
--> statement-breakpoint
ALTER TABLE "ap_items" ADD COLUMN IF NOT EXISTS "category" varchar(128);
--> statement-breakpoint
ALTER TABLE "ap_items" ADD COLUMN IF NOT EXISTS "min_oh_qty" numeric(14,4) NOT NULL DEFAULT '0';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "item_skus" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "sku_name" varchar(255),
  "sku_code" varchar(64),
  "inner_unit_pack_size" numeric(14,4),
  "inner_pack_type" varchar(32),
  "units_in_addl_inner_pack" numeric(14,4),
  "addl_inner_pack_type" varchar(32),
  "units_in_outer_pack" numeric(14,4),
  "outer_pack_type" varchar(32),
  "upc" varchar(64),
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_skus_item_idx" ON "item_skus" ("item_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "item_skus" ADD CONSTRAINT "item_skus_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "item_skus" ADD CONSTRAINT "item_skus_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "ap_items"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "item_supplier_skus" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "supplier_id" uuid,
  "supplier_uom" varchar(16),
  "sku_name" varchar(255),
  "supplier_sku" varchar(64),
  "item_code_by_supplier" varchar(64),
  "inner_unit_pack_size" numeric(14,4),
  "inner_pack_type" varchar(32),
  "units_in_outer_pack" numeric(14,4),
  "outer_pack_type" varchar(32),
  "conversion_factor" numeric(18,8),   -- base UoM per 1 supplier UoM, when dimensions differ
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_supplier_skus_item_idx" ON "item_supplier_skus" ("item_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "item_supplier_skus" ADD CONSTRAINT "item_supplier_skus_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "item_supplier_skus" ADD CONSTRAINT "item_supplier_skus_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "ap_items"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
