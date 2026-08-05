CREATE TABLE "batch_import_mappings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "entity_id" varchar(48) NOT NULL,
  "name" varchar(120) NOT NULL,
  "mapping" jsonb NOT NULL DEFAULT '{}',
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "batch_import_mappings_org_entity_idx" ON "batch_import_mappings"("org_id", "entity_id");
