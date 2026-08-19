-- Group Accounts: a Head Office / group spine that branches map into.
-- Additive only. A group is a first-class entity; membership is a nullable
-- org_groups reference on each organisation (one group per org, NULL = standalone).
-- No DB-level FK constraints (matches the schema's existing logical-FK style for
-- organisations.account_id) to keep neon-http migrations single-statement-safe.

CREATE TABLE IF NOT EXISTS "org_groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(255) NOT NULL,
  "head_office_org_id" uuid,
  "currency" varchar(8) DEFAULT 'EUR' NOT NULL,
  "logo_url" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "group_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_org_group" ON "organisations" ("group_id");
