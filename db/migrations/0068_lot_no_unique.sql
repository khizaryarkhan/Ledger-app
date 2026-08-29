-- A lot code is a physical tag on real inventory — two lots (even of
-- different items) sharing a code would be as confusing as a duplicate
-- within one item, so this is org-wide, not per-item. Partial (WHERE lot_no
-- IS NOT NULL) so the many pre-existing lots created before proper lot
-- numbering (see lib/inventory/valuation.ts's resolveLotNo) aren't blocked.
--
-- Pre-existing data CAN collide: a multi-output BOM build produces several
-- output-pack lots that all defaulted to the same run number as their lot
-- code (lib/inventory/production.ts's buildProductionMulti, one lotNo per
-- run, several lots per run). These were never meaningful user-entered
-- identifiers — they were a document-number fallback — so it's safe to null
-- out every occurrence but the oldest (kept as-is) rather than block the
-- deploy or invent a fake disambiguated code.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY org_id, lot_no ORDER BY created_at ASC, id ASC
  ) AS rn
  FROM "inventory_lots"
  WHERE "lot_no" IS NOT NULL
)
UPDATE "inventory_lots"
SET "lot_no" = NULL
WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_lots_org_lotno_unique"
  ON "inventory_lots" ("org_id", "lot_no")
  WHERE "lot_no" IS NOT NULL;
