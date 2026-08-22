-- Perpetual inventory (FIFO by lot) + COGS accounting, plus Bill of Materials
-- and production runs. Items gain inventory-asset / COGS account routing and
-- cached on-hand qty & value; new tables hold cost lots, the movement ledger,
-- BOM recipes and production builds.

ALTER TABLE "ap_items" ADD COLUMN IF NOT EXISTS "asset_account_id" varchar(64);
--> statement-breakpoint
ALTER TABLE "ap_items" ADD COLUMN IF NOT EXISTS "cogs_account_id" varchar(64);
--> statement-breakpoint
ALTER TABLE "ap_items" ADD COLUMN IF NOT EXISTS "lot_tracked" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "ap_items" ADD COLUMN IF NOT EXISTS "on_hand_qty" numeric(18,4) NOT NULL DEFAULT '0';
--> statement-breakpoint
ALTER TABLE "ap_items" ADD COLUMN IF NOT EXISTS "inv_value" numeric(18,4) NOT NULL DEFAULT '0';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_lots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "lot_no" varchar(64),
  "source_type" varchar(16) NOT NULL DEFAULT 'purchase',
  "source_id" uuid,
  "supplier_id" uuid,
  "received_date" date,
  "expiry_date" date,
  "orig_qty" numeric(18,4) NOT NULL,
  "remaining_qty" numeric(18,4) NOT NULL,
  "unit_cost" numeric(18,6) NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'Open',
  "note" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_lots_item_idx" ON "inventory_lots" ("org_id","item_id","status");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "ap_items"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_movements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "lot_id" uuid,
  "movement_type" varchar(24) NOT NULL,
  "qty" numeric(18,4) NOT NULL,
  "unit_cost" numeric(18,6),
  "total_cost" numeric(18,4),
  "ref_type" varchar(32),
  "ref_id" uuid,
  "entry_id" uuid,
  "movement_date" date,
  "note" text,
  "created_by" uuid,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_movements_item_idx" ON "inventory_movements" ("org_id","item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_movements_ref_idx" ON "inventory_movements" ("ref_type","ref_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "ap_items"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "boms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "code" varchar(64),
  "name" varchar(255) NOT NULL,
  "output_item_id" uuid,
  "status" varchar(16) NOT NULL DEFAULT 'Active',
  "batch_type" varchar(16) NOT NULL DEFAULT 'Output',
  "batch_size" numeric(14,4) NOT NULL DEFAULT '1',
  "exp_yield" numeric(9,4),
  "processing_step" varchar(64),
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "boms_org_idx" ON "boms" ("org_id","status");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "boms" ADD CONSTRAINT "boms_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bom_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "bom_id" uuid NOT NULL,
  "role" varchar(8) NOT NULL,
  "item_id" uuid NOT NULL,
  "qty" numeric(18,4) NOT NULL DEFAULT '0',
  "uom" varchar(16),
  "packaging_config" varchar(128),
  "output_pack_qty" numeric(14,4),
  "supplier_sku_id" uuid,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bom_lines_bom_idx" ON "bom_lines" ("bom_id","role");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_bom_id_fk" FOREIGN KEY ("bom_id") REFERENCES "boms"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "production_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "bom_id" uuid,
  "run_no" varchar(32),
  "output_item_id" uuid NOT NULL,
  "qty_to_produce" numeric(18,4) NOT NULL,
  "total_input_cost" numeric(18,4) NOT NULL DEFAULT '0',
  "status" varchar(16) NOT NULL DEFAULT 'Draft',
  "entry_id" uuid,
  "produced_lot_id" uuid,
  "produced_date" date,
  "notes" text,
  "created_by" uuid,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_runs_org_idx" ON "production_runs" ("org_id","status");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "production_consumptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "run_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "lot_id" uuid NOT NULL,
  "qty" numeric(18,4) NOT NULL,
  "unit_cost" numeric(18,6) NOT NULL,
  "total_cost" numeric(18,4) NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_consumptions_run_idx" ON "production_consumptions" ("run_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "production_consumptions" ADD CONSTRAINT "production_consumptions_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "production_consumptions" ADD CONSTRAINT "production_consumptions_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "production_runs"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
