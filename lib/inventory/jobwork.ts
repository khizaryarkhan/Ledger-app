/**
 * Job work / subcontracting — send owned material to a vendor for external
 * processing (knitting, dyeing, ...) and receive it back transformed, still
 * owned throughout. Neither a purchase (fresh cost, ownership transfers) nor
 * a sale (ownership leaves, revenue recognised) fits this: the material's
 * value just moves between two of the company's OWN asset accounts, plus a
 * genuine payable for the vendor's processing fee.
 *
 *   Dispatch:  Dr  Materials with Job Worker    Cr  Inventory (sent item)
 *   Receive:   Dr  Inventory (received item)
 *                Cr  Materials with Job Worker    (material cost carried forward)
 *                Cr  GR/IR clearing               (processing fee — not yet billed)
 *
 * The received item's lot cost = carried material cost + processing fee, so
 * downstream COGS reflects the true accumulated cost — the same principle as
 * a production build, but the transformation happened at a vendor's site.
 *
 * The processing-fee portion is recorded into the ordinary goods_receipts /
 * goods_receipt_lines tables (grirTotal = the fee only, never the material
 * cost), so the EXISTING three-way-match Bill flow
 * (lib/inventory/receiving.ts's billFromReceipts) bills the job worker for
 * their charge completely unchanged — we never owe them for material we
 * already owned.
 *
 * neon-http has no transactions — post the balanced entry first, then commit
 * lot movements keyed to the entry id, same discipline as receiving.ts and
 * production.ts.
 */

import { db } from "@/db";
import { jobWorkOrders, goodsReceipts, goodsReceiptLines, inventoryLots } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { postJournalEntry, LedgerValidationError, type PostLine } from "@/lib/ledger";
import { ensureSystemAccounts, systemAccountId, INV_SUBTYPE } from "@/lib/accounting/system-accounts";
import { loadItemCostInfo, planIssue, commitIssue, commitReceipt } from "@/lib/inventory/valuation";
import { nextDocNumber } from "@/lib/accounting/numbering";
import { round2, round6 } from "@/lib/inventory/round";

const err = (m: string): never => { throw new LedgerValidationError(m); };

export type DispatchInput = {
  vendorId?: string | null;
  vendorLabel?: string | null;
  sentItemId: string;
  sentQty: number;
  dispatchDate: string;
  notes?: string | null;
};

/** Send owned material out to a job worker. Relieves the sent item's FIFO
 *  lots and reclassifies their cost into the Job Work clearing account — no
 *  COGS, no revenue, because ownership never transfers. */
export async function dispatchToJobWorker(orgId: string, input: DispatchInput, actorId: string | null) {
  const date = input.dispatchDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) err("A valid dispatch date is required.");
  const qty = Math.max(0, Number(input.sentQty) || 0);
  if (qty <= 0) err("Enter the quantity being sent.");
  if (!input.vendorId && !input.vendorLabel) err("Select the job worker this material is being sent to.");

  await ensureSystemAccounts(orgId);
  const invAssetId = await systemAccountId(orgId, INV_SUBTYPE.asset);
  const jwClearingId = await systemAccountId(orgId, INV_SUBTYPE.jobwork);
  if (!jwClearingId) err("No 'Materials with Job Worker' clearing account is set up.");

  const itemMap = await loadItemCostInfo(orgId, [input.sentItemId]);
  const item = itemMap.get(input.sentItemId);
  if (!item) err("Item not found.");
  if (!item!.tracked) err(`${item!.name} isn't an inventory-tracked item.`);
  const assetAcct = item!.assetAccountId ?? invAssetId;
  if (!assetAcct) err(`No inventory asset account for ${item!.name}.`);

  const plan = await planIssue(orgId, item!, qty);
  const cost = round2(plan.totalCost);
  if (cost <= 0) err(`${item!.name} has no inventory cost on hand to send. Receive stock first.`);

  const docNumber = await nextDocNumber(orgId, "JobWork");
  const lines: PostLine[] = [
    { accountId: jwClearingId!, debit: cost, description: `Sent to job worker — ${item!.name}` },
    { accountId: assetAcct!, credit: cost, description: `Sent to job worker — ${item!.name}` },
  ];
  const entry = await postJournalEntry({
    orgId, entryDate: date, memo: input.notes?.trim() || `Job work dispatch ${docNumber} — ${item!.name}`,
    series: "JobWork", sourceType: "JobWorkDispatch", docNumber, createdBy: actorId,
    reference: input.vendorLabel ?? null, lines,
  });

  await commitIssue(orgId, {
    itemId: item!.id, plan, movementType: "issue_jobwork",
    refType: "JobWorkOrder", refId: entry.id, entryId: entry.id, date, createdBy: actorId,
    note: `Sent to ${input.vendorLabel ?? "job worker"} (${docNumber})`,
  });

  const [jwo] = await db.insert(jobWorkOrders).values({
    orgId, docNumber, vendorId: input.vendorId ?? null, vendorLabel: input.vendorLabel ?? null,
    sentItemId: item!.id, sentQty: qty.toString(), sentAmount: cost.toString(),
    dispatchDate: date, dispatchEntryId: entry.id, status: "Dispatched",
    notes: input.notes?.trim() || null, createdBy: actorId,
  } as any).returning();

  return { id: jwo.id, docNumber, entryId: entry.id, sentAmount: cost };
}

export type ReceiveInput = {
  jobWorkOrderId: string;
  receivedItemId: string;
  receivedSkuId?: string | null;
  receivedQty: number;
  processingFeeAmount: number;   // agreed job-work/conversion charge, home currency
  receiveDate: string;
  expiryDate?: string | null;
  notes?: string | null;
};

/** Receive the transformed good back. Creates a new lot for the RECEIVED
 *  item costed at (carried material cost + processing fee); the fee-only
 *  portion is recorded as an ordinary goods receipt so it can be billed via
 *  the existing three-way-match flow. */
export async function receiveFromJobWork(orgId: string, input: ReceiveInput, actorId: string | null) {
  const date = input.receiveDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) err("A valid receive date is required.");
  const qty = Math.max(0, Number(input.receivedQty) || 0);
  if (qty <= 0) err("Enter the quantity received back.");

  const [jwo] = await db.select().from(jobWorkOrders).where(and(eq(jobWorkOrders.id, input.jobWorkOrderId), eq(jobWorkOrders.orgId, orgId))).limit(1);
  if (!jwo) err("Job work order not found.");
  if (jwo!.status !== "Dispatched") err("This job work order has already been received.");

  await ensureSystemAccounts(orgId);
  const invAssetId = await systemAccountId(orgId, INV_SUBTYPE.asset);
  const jwClearingId = await systemAccountId(orgId, INV_SUBTYPE.jobwork);
  const grirId = await systemAccountId(orgId, INV_SUBTYPE.grir);
  if (!jwClearingId) err("No 'Materials with Job Worker' clearing account is set up.");
  if (!grirId) err("No Goods-Received-Not-Invoiced clearing account is set up.");

  const itemMap = await loadItemCostInfo(orgId, [input.receivedItemId]);
  const output = itemMap.get(input.receivedItemId);
  if (!output) err("Received item not found.");
  if (!output!.tracked) err(`${output!.name} isn't an inventory-tracked item.`);
  const outAsset = output!.assetAccountId ?? invAssetId;
  if (!outAsset) err(`No inventory asset account for ${output!.name}.`);

  const materialCost = round2(Number(jwo!.sentAmount));
  const processingFee = round2(Math.max(0, Number(input.processingFeeAmount) || 0));
  const totalCost = round2(materialCost + processingFee);
  if (totalCost <= 0) err("Nothing to receive — the dispatched material has no carried cost.");

  const lines: PostLine[] = [{ accountId: outAsset!, debit: totalCost, description: `Received from job worker — ${output!.name}` }];
  if (materialCost > 0) lines.push({ accountId: jwClearingId!, credit: materialCost, description: `Job work material returned — ${jwo!.docNumber}` });
  if (processingFee > 0) lines.push({ accountId: grirId!, credit: processingFee, description: "Job work processing charge (not yet billed)" });

  const entry = await postJournalEntry({
    orgId, entryDate: date, memo: input.notes?.trim() || `Job work receipt — ${jwo!.docNumber}`,
    series: "GoodsReceipt", sourceType: "JobWorkReceipt", createdBy: actorId,
    reference: jwo!.vendorLabel ?? null, lines,
  });

  const unitCost = round6(totalCost / qty);
  const lotId = await commitReceipt(orgId, {
    itemId: output!.id, skuId: input.receivedSkuId ?? null, qty, unitCost,
    productType: output!.productType, expiryDate: input.expiryDate ?? null,
    supplierId: jwo!.vendorId ?? null, sourceType: "jobwork", receivedDate: date,
    refType: "JobWorkOrder", refId: jwo!.id, entryId: entry.id, createdBy: actorId,
    note: `Job work receipt — ${jwo!.docNumber}`,
  });
  const [createdLot] = await db.select({ lotNo: inventoryLots.lotNo }).from(inventoryLots).where(eq(inventoryLots.id, lotId)).limit(1);

  const receiptNo = await nextDocNumber(orgId, "GoodsReceipt");
  const [receipt] = await db.insert(goodsReceipts).values({
    orgId, receiptNo, supplierId: jwo!.vendorId ?? null, supplierLabel: jwo!.vendorLabel ?? null,
    receiptDate: date, currency: null, exchangeRate: "1", status: "Posted",
    entryId: entry.id, grirTotal: processingFee.toString(), billedAmount: "0",
    notes: `Job work processing charge — ${jwo!.docNumber}`, createdBy: actorId,
  } as any).returning();

  if (processingFee > 0) {
    await db.insert(goodsReceiptLines).values({
      orgId, receiptId: receipt.id, itemId: output!.id, skuId: input.receivedSkuId ?? null,
      description: `Job work processing charge — ${jwo!.docNumber}`,
      qtyBase: qty.toString(), unitCost: round6(processingFee / qty).toString(), amount: processingFee.toString(),
      lotId, lotNo: createdLot?.lotNo ?? null,
    } as any);
  }

  await db.update(jobWorkOrders).set({
    status: "Received", receivedItemId: output!.id, receivedSkuId: input.receivedSkuId ?? null,
    receivedQty: qty.toString(), receivedLotId: lotId, receiptId: receipt.id,
    receiveDate: date, receiveEntryId: entry.id, processingFeeAmount: processingFee.toString(), updatedAt: new Date(),
  }).where(and(eq(jobWorkOrders.id, jwo!.id), eq(jobWorkOrders.orgId, orgId)));

  return { id: jwo!.id, receiptId: receipt.id, receiptNo, entryId: entry.id, lotId, unitCost, totalCost };
}
