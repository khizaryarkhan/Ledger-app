-- Order-to-cash mirror: sales shipments between a Sales Order and an Invoice.
-- Shipment posts Dr COGS / Cr Inventory at FIFO cost; the invoice posts revenue.

CREATE TABLE IF NOT EXISTS "sales_shipments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "shipment_no" varchar(32),
  "customer_id" uuid,
  "customer_label" varchar(255),
  "shipment_date" date NOT NULL,
  "currency" varchar(8),
  "exchange_rate" numeric(18,6),
  "status" varchar(16) NOT NULL DEFAULT 'Posted',
  "entry_id" uuid,
  "cogs_total" numeric(18,4) NOT NULL DEFAULT '0',
  "sale_total" numeric(18,4) NOT NULL DEFAULT '0',
  "invoiced_amount" numeric(18,4) NOT NULL DEFAULT '0',
  "notes" text,
  "created_by" uuid,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_shipments_org_idx" ON "sales_shipments" ("org_id","status");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales_shipments" ADD CONSTRAINT "sales_shipments_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shipment_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "shipment_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "so_id" uuid,
  "so_line_id" uuid,
  "description" text,
  "qty_base" numeric(18,4) NOT NULL,
  "unit_cost" numeric(18,6) NOT NULL DEFAULT '0',
  "cogs_amount" numeric(18,4) NOT NULL DEFAULT '0',
  "sale_rate" numeric(18,6),
  "income_account_id" varchar(64),
  "tax_rate_id" uuid,
  "invoiced_qty" numeric(18,4) NOT NULL DEFAULT '0',
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_lines_shipment_idx" ON "shipment_lines" ("shipment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_lines_so_idx" ON "shipment_lines" ("so_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "sales_shipments"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
