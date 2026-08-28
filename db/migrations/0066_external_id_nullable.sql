-- accounts / ap_items / ap_tax_rates all carry a leftover NOT NULL on
-- external_id from before these tables supported native (non-QBO/Xero)
-- records. db/schema.ts has declared external_id nullable on all three for a
-- long time ("null for native records" — see the POST /api/inventory/items
-- and ensureSystemAccounts insert paths, which have always inserted
-- externalId: null for native rows) but no migration ever actually dropped
-- the constraint, so a fresh database built purely from this migrations
-- folder rejects every native account/item/tax-rate insert with a NOT NULL
-- violation. ap_dimensions keeps its NOT NULL — schema.ts declares that one
-- .notNull() too, so it's intentional, not drift.
ALTER TABLE "accounts" ALTER COLUMN "external_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "ap_items" ALTER COLUMN "external_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "ap_tax_rates" ALTER COLUMN "external_id" DROP NOT NULL;
