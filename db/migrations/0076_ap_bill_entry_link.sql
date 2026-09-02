ALTER TABLE "ap_bills" ADD COLUMN IF NOT EXISTS "entry_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ap_bills_org_entry_idx" ON "ap_bills" ("org_id", "entry_id");
