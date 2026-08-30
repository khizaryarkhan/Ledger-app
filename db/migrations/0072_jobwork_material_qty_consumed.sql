-- Cost/wastage proration for a job-work tranche was computed purely from
-- receivedQty, which silently assumes the sent and received items share a
-- unit (fine for kg yarn -> kg fabric, wrong for kg fabric -> count of
-- garments, a routine real-world conversion e.g. cut-and-sew). This column
-- lets a tranche record how much of the DISPATCHED item it actually
-- represents, in the dispatched item's own unit. Null = "assume 1:1 with
-- receivedQty", preserving existing same-unit behavior unchanged.
ALTER TABLE "job_work_receipts" ADD COLUMN IF NOT EXISTS "material_qty_consumed" numeric(18,4);
