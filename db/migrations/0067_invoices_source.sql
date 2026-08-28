-- invoices.source was added to db/schema.ts (and is written by lib/qbo-sync.ts's
-- QBO ingestion inserts, and lib/accounting/documents.ts's bridgeNativeInvoice
-- for native invoices) but no migration ever created the column — any fresh
-- database built from this migrations folder throws "column \"source\" of
-- relation \"invoices\" does not exist" on every native invoice post AND on
-- QBO invoice sync itself. Every insert path already sets it explicitly
-- ('qbo' or 'native'), so the default only matters for pre-existing rows.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "source" varchar(16) NOT NULL DEFAULT 'native';
