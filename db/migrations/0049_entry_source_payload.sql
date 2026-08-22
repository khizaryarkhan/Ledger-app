-- Store the document form input that produced a posted entry, so the exact
-- form (items, qty, rate, tax per line) can be reopened for editing — the GL
-- lines alone don't carry that document-level detail. Additive, nullable.

ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "source_payload" jsonb;
