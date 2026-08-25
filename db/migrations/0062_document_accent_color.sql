-- Brand accent colour for printed documents.
--
-- Professional document design uses 2–3 colours: one brand accent (document
-- title, table header fill, balance-due block) against dark text on white.
-- Hard-coding one would clash with every org's own branding, so it's a setting.
-- Nullable — a sensible default is applied when unset.

ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "document_accent_color" varchar(16);
