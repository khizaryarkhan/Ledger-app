-- Group-level access: which users may see a Group Account's consolidated view,
-- and in what capacity (ho_manager = full, ho_finance = receivables). Additive;
-- does not change existing single-org access. One row per (group, user).

CREATE TABLE IF NOT EXISTS "org_group_users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" varchar(32) NOT NULL DEFAULT 'ho_finance',
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_org_group_user" ON "org_group_users" ("group_id","user_id");
