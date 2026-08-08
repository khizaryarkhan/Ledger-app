-- Management P&L structure: a dimension can be a "statement" (its values are P&L
-- lines with kind/sign/formula), and dimension values gain statement metadata.
-- IF NOT EXISTS so a partial apply (neon-http has no transactions) is safe to re-run.
-- ("code" already exists from 0032 — intentionally not re-added.)
ALTER TABLE "reporting_dimensions" ADD COLUMN IF NOT EXISTS "kind" varchar(16) NOT NULL DEFAULT 'dimension';
--> statement-breakpoint
ALTER TABLE "reporting_dimension_values" ADD COLUMN IF NOT EXISTS "line_kind" varchar(16) NOT NULL DEFAULT 'detail';
--> statement-breakpoint
ALTER TABLE "reporting_dimension_values" ADD COLUMN IF NOT EXISTS "sign" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "reporting_dimension_values" ADD COLUMN IF NOT EXISTS "formula" jsonb;
