CREATE TABLE IF NOT EXISTS "qbo_rate_limits" (
  "realm_id" varchar(64) PRIMARY KEY NOT NULL,
  "in_flight" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- lib/rate-limit.ts's generic fixed-window limiter (db/migration-rate-limits.sql)
-- lived outside the numbered migration pipeline and was never confirmed to have
-- actually been applied to production — folding its table into the normal
-- pipeline here so the QBO batch-endpoint pacing this migration exists for can
-- actually rely on it (the limiter itself fails open if this is missing, so this
-- is belt-and-suspenders, not a behavior change for anything already using it).
CREATE TABLE IF NOT EXISTS "rate_limits" (
  "key"        text        PRIMARY KEY,
  "count"      integer     NOT NULL DEFAULT 0,
  "expires_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limits_expires_idx" ON "rate_limits" ("expires_at");
