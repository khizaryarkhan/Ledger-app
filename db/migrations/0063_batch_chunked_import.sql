-- Chunked, resumable Studio imports: a cursor of how many docs are truly done,
-- and a short-lived lease so two chunk requests can never process the same
-- cursor at once (duplicate QuickBooks writes). Additive + safe on existing rows.

ALTER TABLE "batch_jobs" ADD COLUMN IF NOT EXISTS "processed_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "batch_jobs" ADD COLUMN IF NOT EXISTS "lease_until" timestamp;
