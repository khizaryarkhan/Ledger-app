ALTER TABLE "batch_jobs" ADD COLUMN "input" jsonb;
--> statement-breakpoint
ALTER TABLE "batch_jobs" ADD COLUMN "undone_at" timestamp;
