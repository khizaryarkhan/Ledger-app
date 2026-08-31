ALTER TABLE "job_work_orders" ADD COLUMN "expected_return_date" date;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supply_chain_alerts" (
  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "source_type" varchar(16) NOT NULL,
  "source_id" uuid NOT NULL,
  "sales_order_id" uuid,
  "kind" varchar(16) NOT NULL,
  "severity" varchar(16) NOT NULL DEFAULT 'warning',
  "message" text NOT NULL,
  "detected_at" timestamp NOT NULL DEFAULT now(),
  "resolved_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "supply_chain_alerts_source_idx" ON "supply_chain_alerts" ("org_id", "source_type", "source_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supply_chain_alerts_open_idx" ON "supply_chain_alerts" ("org_id", "resolved_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supply_chain_alerts_so_idx" ON "supply_chain_alerts" ("sales_order_id");
