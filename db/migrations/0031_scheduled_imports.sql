CREATE TABLE "google_sheets_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid REFERENCES "organisations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "email" varchar(255) NOT NULL,
  "access_token" text NOT NULL,
  "refresh_token" text NOT NULL,
  "access_token_expires_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scheduled_imports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "entity_id" varchar(48) NOT NULL,
  "name" varchar(120) NOT NULL,
  "spreadsheet_id" text NOT NULL,
  "sheet_range" text NOT NULL DEFAULT 'Sheet1',
  "mapping" jsonb NOT NULL DEFAULT '{}',
  "cadence" varchar(16) NOT NULL DEFAULT 'daily',
  "active" boolean NOT NULL DEFAULT true,
  "last_run_at" timestamp,
  "last_job_id" uuid,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "scheduled_imports_org_idx" ON "scheduled_imports"("org_id");
