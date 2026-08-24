-- Manufacturing Orders: planned/scheduled production jobs (Production module).
CREATE TABLE IF NOT EXISTS "manufacturing_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "mo_no" varchar(32),
  "bom_id" uuid,
  "output_item_id" uuid NOT NULL,
  "output_sku_id" uuid,
  "qty" numeric(18,4) NOT NULL,
  "scheduled_date" date,
  "due_date" date,
  "priority" varchar(8) NOT NULL DEFAULT 'Normal',
  "status" varchar(16) NOT NULL DEFAULT 'Draft',
  "notes" text,
  "production_run_id" uuid,
  "created_by" uuid,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "manufacturing_orders_org_idx" ON "manufacturing_orders" ("org_id","status");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
