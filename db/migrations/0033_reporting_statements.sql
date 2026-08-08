-- Management P&L structure: a dimension can be a "statement" (its values are P&L
-- lines with kind/sign/formula), and dimension values gain statement metadata.
ALTER TABLE "reporting_dimensions" ADD COLUMN "kind" varchar(16) NOT NULL DEFAULT 'dimension';
--> statement-breakpoint
ALTER TABLE "reporting_dimension_values" ADD COLUMN "line_kind" varchar(16) NOT NULL DEFAULT 'detail';
--> statement-breakpoint
ALTER TABLE "reporting_dimension_values" ADD COLUMN "sign" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "reporting_dimension_values" ADD COLUMN "code" varchar(64);
--> statement-breakpoint
ALTER TABLE "reporting_dimension_values" ADD COLUMN "formula" jsonb;
