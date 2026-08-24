-- Multi-output / co-product BOMs: one recipe, several packed output SKUs, each
-- with its own packaging materials. MOs & builds carry per-SKU quantities.

ALTER TABLE "bom_lines" ALTER COLUMN "role" TYPE varchar(12);
--> statement-breakpoint
ALTER TABLE "bom_lines" ADD COLUMN IF NOT EXISTS "packaging_for_sku_id" uuid;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mo_outputs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "mo_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "sku_id" uuid,
  "qty" numeric(18,4) NOT NULL DEFAULT '0',
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mo_outputs_mo_idx" ON "mo_outputs" ("mo_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "mo_outputs" ADD CONSTRAINT "mo_outputs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "mo_outputs" ADD CONSTRAINT "mo_outputs_mo_id_fk" FOREIGN KEY ("mo_id") REFERENCES "manufacturing_orders"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "production_outputs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "run_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "sku_id" uuid,
  "qty_packs" numeric(18,4) NOT NULL DEFAULT '0',
  "qty_base" numeric(18,4) NOT NULL DEFAULT '0',
  "unit_cost" numeric(18,6) NOT NULL DEFAULT '0',
  "amount" numeric(18,4) NOT NULL DEFAULT '0',
  "lot_id" uuid,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_outputs_run_idx" ON "production_outputs" ("run_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "production_outputs" ADD CONSTRAINT "production_outputs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "production_outputs" ADD CONSTRAINT "production_outputs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "production_runs"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
