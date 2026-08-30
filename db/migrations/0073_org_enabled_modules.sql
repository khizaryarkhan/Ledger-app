ALTER TABLE "organisations" ADD COLUMN "enabled_modules" jsonb NOT NULL DEFAULT '["receivables","payables","studio","accounting"]';
