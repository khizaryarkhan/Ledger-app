-- Maker-checker: inventory postings above a threshold (or always, for Job
-- Work dispatch) are staged in pending_approvals instead of posting
-- immediately. See lib/inventory/approvals.ts.
CREATE TABLE IF NOT EXISTS "approval_thresholds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "entity_type" varchar(32) NOT NULL,
  "threshold_amount" numeric(14,2),
  "always_require" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "approval_thresholds_org_entity_unique" ON "approval_thresholds" ("org_id", "entity_type");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pending_approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "entity_type" varchar(32) NOT NULL,
  "payload_json" jsonb NOT NULL,
  "amount" numeric(14,2) NOT NULL DEFAULT '0',
  "requested_by" uuid,
  "status" varchar(16) NOT NULL DEFAULT 'Pending',
  "approved_by" uuid,
  "approved_at" timestamp,
  "rejected_reason" text,
  "result_id" uuid,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pending_approvals_org_status_idx" ON "pending_approvals" ("org_id", "status");
