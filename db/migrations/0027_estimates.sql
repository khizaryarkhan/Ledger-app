CREATE TABLE "estimates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
  "estimate_number" varchar(64) NOT NULL,
  "estimate_date" varchar(16) NOT NULL,
  "expiry_date" varchar(16),
  "currency" varchar(8) NOT NULL DEFAULT 'GBP',
  "amount" real NOT NULL DEFAULT 0,
  "tax_amount" real NOT NULL DEFAULT 0,
  "total" real NOT NULL DEFAULT 0,
  "status" varchar(32) NOT NULL DEFAULT 'Pending',
  "billing_email" text,
  "notes" text,
  "line_items" jsonb DEFAULT '[]',
  "qbo_id" varchar(64),
  "qbo_customer_id" varchar(64),
  "qbo_synced_at" timestamp,
  "source" varchar(16) NOT NULL DEFAULT 'qbo',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "estimates_org_idx" ON "estimates"("org_id");
--> statement-breakpoint
CREATE INDEX "estimates_customer_idx" ON "estimates"("org_id", "customer_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "estimates_qbo_idx" ON "estimates"("org_id", "qbo_id");
