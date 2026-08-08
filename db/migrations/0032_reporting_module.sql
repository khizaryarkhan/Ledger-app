CREATE TABLE "reporting_dimensions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "name" varchar(120) NOT NULL,
  "slug" varchar(64) NOT NULL,
  "description" text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "reporting_dimensions_org_slug_idx" ON "reporting_dimensions"("org_id","slug");
--> statement-breakpoint
CREATE TABLE "reporting_dimension_values" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "dimension_id" uuid NOT NULL REFERENCES "reporting_dimensions"("id") ON DELETE CASCADE,
  "parent_id" uuid REFERENCES "reporting_dimension_values"("id") ON DELETE SET NULL,
  "name" varchar(120) NOT NULL,
  "code" varchar(64),
  "sort_order" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "reporting_dimension_values_dim_idx" ON "reporting_dimension_values"("dimension_id");
--> statement-breakpoint
CREATE TABLE "reporting_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "dimension_id" uuid NOT NULL REFERENCES "reporting_dimensions"("id") ON DELETE CASCADE,
  "target_value_id" uuid REFERENCES "reporting_dimension_values"("id") ON DELETE CASCADE,
  "name" varchar(160),
  "description" text,
  "priority" integer NOT NULL DEFAULT 100,
  "conditions" jsonb NOT NULL DEFAULT '{"op":"AND","conditions":[]}',
  "active" boolean NOT NULL DEFAULT true,
  "effective_from" date,
  "effective_to" date,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "reporting_rules_org_dim_idx" ON "reporting_rules"("org_id","dimension_id");
--> statement-breakpoint
CREATE TABLE "reporting_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "dimension_id" uuid NOT NULL REFERENCES "reporting_dimensions"("id") ON DELETE CASCADE,
  "value_id" uuid REFERENCES "reporting_dimension_values"("id") ON DELETE CASCADE,
  "txn_type" varchar(32) NOT NULL,
  "txn_id" varchar(48) NOT NULL,
  "line_id" varchar(48) NOT NULL,
  "original_value_id" uuid REFERENCES "reporting_dimension_values"("id") ON DELETE SET NULL,
  "reason" text,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "reporting_overrides_line_dim_idx" ON "reporting_overrides"("org_id","dimension_id","txn_type","txn_id","line_id");
