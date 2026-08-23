-- Bank reconciliation: mark GL bank/credit-card lines cleared against a
-- statement. journal_lines gains a reconciliation link; a header table records
-- each completed reconciliation.

ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "reconciliation_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_lines_recon_idx" ON "journal_lines" ("reconciliation_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_reconciliations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "statement_date" date NOT NULL,
  "beginning_balance" numeric(14,2) NOT NULL DEFAULT '0',
  "statement_balance" numeric(14,2) NOT NULL DEFAULT '0',
  "cleared_balance" numeric(14,2) NOT NULL DEFAULT '0',
  "status" varchar(16) NOT NULL DEFAULT 'Reconciled',
  "reconciled_by" uuid,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_recs_acct_idx" ON "bank_reconciliations" ("org_id","account_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
