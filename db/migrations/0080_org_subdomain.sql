-- Per-org branded subdomain (white-label Phase 1). NULL = no custom
-- subdomain, org just uses the default app. Partial unique index so many
-- orgs can share NULL without conflict.
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "subdomain" varchar(63);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organisations_subdomain_unique" ON "organisations" ("subdomain") WHERE "subdomain" IS NOT NULL;
