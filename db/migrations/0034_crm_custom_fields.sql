-- CRM custom fields: admin-defined properties on accounts / leads / contacts.
-- Platform-level (the admin CRM is not org-scoped). Definitions + values.
CREATE TABLE "crm_field_defs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity" varchar(16) NOT NULL,                      -- account | lead | contact
  "field_key" varchar(64) NOT NULL,
  "label" varchar(120) NOT NULL,
  "field_type" varchar(16) NOT NULL DEFAULT 'text',   -- text|textarea|number|money|date|select|multiselect|boolean|url|email|phone
  "options" jsonb,                                    -- for select/multiselect
  "required" boolean NOT NULL DEFAULT false,
  "sort_order" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "crm_field_defs_entity_key_idx" ON "crm_field_defs"("entity","field_key");
--> statement-breakpoint
CREATE TABLE "crm_field_values" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "def_id" uuid NOT NULL REFERENCES "crm_field_defs"("id") ON DELETE CASCADE,
  "entity" varchar(16) NOT NULL,
  "entity_id" varchar(64) NOT NULL,
  "value" jsonb,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "crm_field_values_def_entity_idx" ON "crm_field_values"("def_id","entity_id");
--> statement-breakpoint
CREATE INDEX "crm_field_values_entity_idx" ON "crm_field_values"("entity","entity_id");
