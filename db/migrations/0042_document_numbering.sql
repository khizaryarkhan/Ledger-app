-- Document numbering — our own gap-free, per-type transaction number series
-- for the native accounting app (QBO model: per type, auto-increment,
-- alphanumeric prefix, user-editable, sequence continues from the highest used).
--
-- `next_no` is the number that will be assigned NEXT. Allocation is:
--   INSERT ... ON CONFLICT DO NOTHING   (lazily seed the row)
--   UPDATE ... SET next_no = next_no + 1 RETURNING next_no - 1  (atomic consume)
-- The UPDATE row-lock makes allocation concurrency-safe without a transaction.

CREATE TABLE IF NOT EXISTS "document_sequences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "doc_type" varchar(24) NOT NULL,          -- Journal | Invoice | Bill | Payment | CreditNote | ...
  "prefix" varchar(16) NOT NULL DEFAULT '',
  "next_no" integer NOT NULL DEFAULT 1,
  "padding" integer NOT NULL DEFAULT 4,     -- zero-pad width of the numeric part
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_sequences_org_type_unique" ON "document_sequences" ("org_id", "doc_type");
--> statement-breakpoint
-- The user-facing (editable) document number stamped on each GL entry. The
-- internal, immutable audit counter `entry_number` stays as-is; this is the
-- number a user sees and may override, decoupled from the gap-free counter.
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "doc_number" varchar(64);
