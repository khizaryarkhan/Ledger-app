-- Financial period: fiscal-year definition + year-end close.
--
-- fiscal_year_start_month: 1-12 (e.g. Pakistan FY = 7 for July). Defines the
--   reporting year boundaries.
-- book_close_date: the lock date. Entries dated on/before this are locked
--   (except system closing entries). Set when a period is closed.
-- period_closes: audit trail of each year-end close — the net profit moved to
--   Retained Earnings and the closing journal entry that did it.

ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "fiscal_year_start_month" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "book_close_date" varchar(16);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "period_closes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "period_start" varchar(16) NOT NULL,
  "period_end" varchar(16) NOT NULL,
  "net_profit" numeric(14,2) NOT NULL DEFAULT '0',
  "retained_earnings_account_id" uuid,
  "closing_entry_id" uuid,
  "status" varchar(16) NOT NULL DEFAULT 'Closed',   -- Closed | Reopened
  "closed_by" uuid,
  "closed_at" timestamp NOT NULL DEFAULT now(),
  "reopened_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "period_closes_org_idx" ON "period_closes" ("org_id");
