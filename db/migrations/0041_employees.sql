-- Employees — a Name list (party) for payroll and journal "Name" references.
-- Same envelope as the other party/master lists: source (native/qbo/xero),
-- optional currency (multi-currency party), status. Additive.

CREATE TABLE IF NOT EXISTS "employees" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "external_id" varchar(64),
  "source" varchar(16) NOT NULL DEFAULT 'native',
  "name" varchar(255) NOT NULL,
  "email" varchar(255),
  "currency" varchar(8),
  "status" varchar(32) NOT NULL DEFAULT 'Active',
  "raw" jsonb,
  "last_synced_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employees_org_idx" ON "employees" ("org_id");
