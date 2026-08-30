-- Backfill job_work_receipts for orders that were received under the OLD
-- single-receipt model (before job_work_receipts existed in 0070). Without
-- this, historical job-work orders vanish from genealogy.ts's ancestor/
-- descendant traversal, which now looks them up through job_work_receipts
-- exclusively. Idempotent: NOT EXISTS guards against re-running, and the
-- status fixup only ever touches the old literal 'Received' value.
INSERT INTO "job_work_receipts" (
  "org_id", "job_work_order_id", "received_item_id", "received_sku_id",
  "received_qty", "received_lot_id", "receipt_id", "receive_date",
  "receive_entry_id", "processing_fee_amount", "notes", "created_by", "created_at"
)
SELECT
  jwo."org_id", jwo."id", jwo."received_item_id", jwo."received_sku_id",
  jwo."received_qty", jwo."received_lot_id", jwo."receipt_id", jwo."receive_date",
  jwo."receive_entry_id", COALESCE(jwo."processing_fee_amount", '0'),
  'Backfilled from single-receipt legacy record', jwo."created_by", COALESCE(jwo."updated_at", now())
FROM "job_work_orders" jwo
WHERE jwo."received_lot_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "job_work_receipts" jwr WHERE jwr."job_work_order_id" = jwo."id"
  );
--> statement-breakpoint
UPDATE "job_work_orders" SET "status" = 'PartiallyReceived' WHERE "status" = 'Received';
