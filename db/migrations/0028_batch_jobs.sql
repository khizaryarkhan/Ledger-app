CREATE TABLE "batch_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "operation" varchar(16) NOT NULL,
  "entity_id" varchar(48) NOT NULL,
  "entity_label" varchar(64) NOT NULL,
  "file_name" text,
  "status" varchar(16) NOT NULL DEFAULT 'running',
  "total_rows" integer NOT NULL DEFAULT 0,
  "success_count" integer NOT NULL DEFAULT 0,
  "error_count" integer NOT NULL DEFAULT 0,
  "results" jsonb DEFAULT '[]',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "finished_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "batch_jobs_org_idx" ON "batch_jobs"("org_id", "created_at");
