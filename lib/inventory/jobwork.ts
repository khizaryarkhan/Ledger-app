/**
 * Job work / subcontracting — send owned material to a vendor for external
 * processing (knitting, dyeing, ...) and receive it back transformed, still
 * owned throughout. Neither a purchase (fresh cost, ownership transfers) nor
 * a sale (ownership leaves, revenue recognised) fits this: the material's
 * value just moves between two of the company's OWN asset accounts, plus a
 * genuine payable for the vendor's processing fee.
 *
 *   Dispatch:      Dr  Materials with Job Worker    Cr  Inventory (sent item)
 *   Each receipt:  Dr  Inventory (received item)
 *                    Cr  Materials with Job Worker    (this tranche's share of
 *                                                       the carried material cost)
 *                    Cr  GR/IR clearing               (this tranche's processing fee)
 *   Close:         Dr  Inventory Adjustments  Cr  Materials with Job Worker
 *                  (only if sent > received; the reverse if received > sent)
 *
 * A single dispatch may come back across SEVERAL partial receipts (see
 * job_work_receipts) — e.g. 100,000kg of yarn sent for knitting, returned in
 * 4 deliveries. Each receipt's material cost is a proportional slice of the
 * original dispatch cost (`sentAmount/sentQty` per unit), not the whole
 * amount — crediting the whole amount on every receipt would double-credit
 * the clearing account the moment there's more than one tranche.
 *
 * Wastage is NEVER assumed or apportioned into unit cost automatically. It is
 * only recognised when someone explicitly closes the order (closeJobWorkOrder)
 * — at that point, whatever gap remains between total dispatched and total
 * received is written off as its own visible GL line (Inventory Adjustments),
 * not silently folded into the received lots' cost. This keeps the received
 * item's unit cost equal to the SAME per-unit rate for every tranche, and
 * makes subcontractor loss reportable per vendor instead of hidden.
 *
 * The received item's lot cost = carried material cost + processing fee, so
 * downstream COGS reflects the true accumulated cost — the same principle as
 * a production build, but the transformation happened at a vendor's site.
 *
 * The processing-fee portion is recorded into the ordinary goods_receipts /
 * goods_receipt_lines tables (grirTotal = the fee only, never the material
 * cost) for EACH receipt, so the EXISTING three-way-match Bill flow
 * (lib/inventory/receiving.ts's billFromReceipts) bills the job worker for
 * their charge completely unchanged — we never owe them for material we
 * already owned.
 *
 * neon-http has no transactions — post the balanced entry first, then commit
 * lot movements keyed to the entry id, same discipline as receiving.ts and
 * production.ts.
 */

import { db } from "@/db";
import { jobWorkOrders, jobWorkReceipts, goodsReceipts, goodsReceiptLines, inventoryLots, apSuppliers } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { postJournalEntry, LedgerValidationError, type PostLine } from "@/lib/ledger";
import { ensureSystemAccounts, systemAccountId, INV_SUBTYPE } from "@/lib/accounting/system-accounts";
import { loadItemCostInfo, commitReceipt, planIssue, commitIssue } from "@/lib/inventory/valuation";
import { nextDocNumber } from "@/lib/accounting/numbering";
import { round2, round6 } from "@/lib/inventory/round";
import { requiresApproval, stagePendingApproval } from "@/lib/inventory/approvals";
import { deleteEntry } from "@/lib/inventory/void";

const err = (m: string): never => { throw new LedgerValidationError(m); };

export type DispatchInput = {
  vendorId?: string | null;
  vendorLabel?: string | null;
  sentItemId: string;
  sentQty: number;
  dispatchDate: string;
  notes?: string | null;
  expectedYieldPct?: number | null; // optional benchmark, informational only — never enforced
};

/** Send owned material out to a job worker. Relieves the sent item's FIFO
 *  lots and reclassifies their cost into the Job Work clearing account — no
 *  COGS, no revenue, because ownership never transfers. */
export async function dispatchToJobWorker(orgId: string, input: DispatchInput, actorId: string | null, opts?: { skipApprovalCheck?: boolean }) {
  const date = input.dispatchDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) err("A valid dispatch date is required.");
  const qty = Math.max(0, Number(input.sentQty) || 0);
  if (qty <= 0) err("Enter the quantity being sent.");
  if (!input.vendorId && !input.vendorLabel) err("Select the job worker this material is being sent to.");

  // The UI always resolves and sends vendorLabel alongside vendorId, but any
  // other caller (a script, a future integration) might send only the id —
  // resolve the name server-side rather than silently recording a vendor
  // with no display name (surfaces as "Unknown vendor" in every report).
  let vendorLabel = input.vendorLabel ?? null;
  if (!vendorLabel && input.vendorId) {
    const [supplier] = await db.select({ name: apSuppliers.name }).from(apSuppliers).where(and(eq(apSuppliers.id, input.vendorId), eq(apSuppliers.orgId, orgId))).limit(1);
    vendorLabel = supplier?.name ?? null;
  }

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

  if (!opts?.skipApprovalCheck && await requiresApproval(orgId, "jobwork_dispatch", cost)) {
    const pending = await stagePendingApproval(orgId, "jobwork_dispatch", input, cost, actorId);
    return { pending: true, id: pending.id, amount: cost };
  }

  const docNumber = await nextDocNumber(orgId, "JobWork");
  const lines: PostLine[] = [
    { accountId: jwClearingId!, debit: cost, description: `Sent to job worker — ${item!.name}` },
    { accountId: assetAcct!, credit: cost, description: `Sent to job worker — ${item!.name}` },
  ];
  const entry = await postJournalEntry({
    orgId, entryDate: date, memo: input.notes?.trim() || `Job work dispatch ${docNumber} — ${item!.name}`,
    series: "JobWork", sourceType: "JobWorkDispatch", docNumber, createdBy: actorId,
    reference: vendorLabel, lines,
  });

  await commitIssue(orgId, {
    itemId: item!.id, plan, movementType: "issue_jobwork",
    refType: "JobWorkOrder", refId: entry.id, entryId: entry.id, date, createdBy: actorId,
    note: `Sent to ${vendorLabel ?? "job worker"} (${docNumber})`,
  });

  const [jwo] = await db.insert(jobWorkOrders).values({
    orgId, docNumber, vendorId: input.vendorId ?? null, vendorLabel,
    sentItemId: item!.id, sentQty: qty.toString(), sentAmount: cost.toString(),
    dispatchDate: date, dispatchEntryId: entry.id, status: "Dispatched",
    expectedYieldPct: input.expectedYieldPct != null ? String(input.expectedYieldPct) : null,
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
  // How much of the DISPATCHED item (in its own unit) this tranche represents
  // — required whenever the received item's unit differs from the sent
  // item's (e.g. kg of fabric in, count of garments out). Omit when sent and
  // received share a unit (the common case) — defaults to receivedQty, i.e.
  // assumes 1:1.
  materialQtyConsumed?: number;
};

/** Receive one tranche of the transformed good back — a single dispatch may
 *  be received across several calls to this function. Creates a new lot for
 *  the RECEIVED item costed at (this tranche's proportional share of the
 *  carried material cost + this tranche's processing fee); the fee-only
 *  portion is recorded as an ordinary goods receipt so it can be billed via
 *  the existing three-way-match flow. */
export async function receiveFromJobWork(orgId: string, input: ReceiveInput, actorId: string | null) {
  const date = input.receiveDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) err("A valid receive date is required.");
  const qty = Math.max(0, Number(input.receivedQty) || 0);
  if (qty <= 0) err("Enter the quantity received back.");

  const [jwo] = await db.select().from(jobWorkOrders).where(and(eq(jobWorkOrders.id, input.jobWorkOrderId), eq(jobWorkOrders.orgId, orgId))).limit(1);
  if (!jwo) err("Job work order not found.");
  if (jwo!.status === "Closed") err("This job work order has been closed — reopen it first if more stock is still expected.");

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

  const sentQty = Number(jwo!.sentQty);
  const sentAmount = Number(jwo!.sentAmount);
  const alreadyReceived = round2(Number(jwo!.receivedQty ?? 0));
  // How much of the DISPATCHED item this tranche represents, in the
  // dispatched item's own unit — defaults to receivedQty (assumes 1:1),
  // correct whenever sent/received share a unit; must be passed explicitly
  // when they don't (e.g. kg fabric in, garment count out).
  const materialQty = input.materialQtyConsumed != null ? Math.max(0, Number(input.materialQtyConsumed)) : qty;
  // This tranche's slice of the ORIGINAL dispatch cost, at the same per-unit
  // rate for every tranche — never the whole sentAmount, which would
  // double-credit the clearing account past the first receipt.
  const materialCost = sentQty > 0 ? round2(materialQty * (sentAmount / sentQty)) : 0;
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

  await db.insert(jobWorkReceipts).values({
    orgId, jobWorkOrderId: jwo!.id, receivedItemId: output!.id, receivedSkuId: input.receivedSkuId ?? null,
    receivedQty: qty.toString(), materialQtyConsumed: materialQty.toString(), receivedLotId: lotId, receiptId: receipt.id,
    receiveDate: date, receiveEntryId: entry.id, processingFeeAmount: processingFee.toString(),
    notes: input.notes?.trim() || null, createdBy: actorId,
  } as any);

  const totalReceived = round2(alreadyReceived + qty);
  await db.update(jobWorkOrders).set({
    status: "PartiallyReceived", receivedItemId: output!.id, receivedSkuId: input.receivedSkuId ?? null,
    receivedQty: totalReceived.toString(), receivedLotId: lotId, receiptId: receipt.id,
    receiveDate: date, receiveEntryId: entry.id, processingFeeAmount: processingFee.toString(), updatedAt: new Date(),
  }).where(and(eq(jobWorkOrders.id, jwo!.id), eq(jobWorkOrders.orgId, orgId)));

  return { id: jwo!.id, receiptId: receipt.id, receiptNo, entryId: entry.id, lotId, unitCost, totalCost, totalReceived, sentQty };
}

/**
 * Explicitly close a job work order — declares that no further receipts are
 * expected. Computes the gap between total dispatched and total received and
 * writes it off as ITS OWN visible GL line (never folded into any lot's unit
 * cost): a shortfall (the normal case) debits "Inventory Adjustments" and
 * credits the clearing account down to zero; a surplus (unusual — e.g.
 * moisture/dye uptake — the caller must pass `confirmGain: true`, meant to
 * gate a client-side confirmation) posts the mirror entry. Zero gap still
 * stamps closedAt/closedBy so there's always an audit record of who closed it.
 */
export async function closeJobWorkOrder(orgId: string, jwoId: string, actorId: string | null, opts?: { confirmGain?: boolean }) {
  const [jwo] = await db.select().from(jobWorkOrders).where(and(eq(jobWorkOrders.id, jwoId), eq(jobWorkOrders.orgId, orgId))).limit(1);
  if (!jwo) err("Job work order not found.");
  if (jwo!.status === "Closed") err("This job work order is already closed.");

  const sentQty = Number(jwo!.sentQty);
  const sentAmount = Number(jwo!.sentAmount);
  // Sum each tranche's DISPATCHED-item-equivalent qty, not raw receivedQty —
  // they're the same number whenever sent/received share a unit, but must
  // diverge when they don't (e.g. kg fabric in, garment count out), or the
  // wastage comparison below would subtract two incomparable quantities.
  const receipts = await db.select().from(jobWorkReceipts).where(and(eq(jobWorkReceipts.orgId, orgId), eq(jobWorkReceipts.jobWorkOrderId, jwoId)));
  const materialQtyReceived = round2(receipts.reduce((s, r) => s + Number(r.materialQtyConsumed ?? r.receivedQty), 0));
  const wastageQty = round2(sentQty - materialQtyReceived); // negative = received more than sent (a gain)
  const wastageAmount = sentQty > 0 ? round2(wastageQty * (sentAmount / sentQty)) : 0;

  if (wastageQty < -0.0001 && !opts?.confirmGain) {
    err(`This order received ${Math.abs(wastageQty)} more than was sent — confirm this is correct before closing.`);
  }

  let wastageEntryId: string | null = null;
  if (Math.abs(wastageAmount) > 0.005) {
    await ensureSystemAccounts(orgId);
    const jwClearingId = await systemAccountId(orgId, INV_SUBTYPE.jobwork);
    const adjustmentsId = await systemAccountId(orgId, INV_SUBTYPE.shrinkage);
    if (!jwClearingId) err("No 'Materials with Job Worker' clearing account is set up.");
    if (!adjustmentsId) err("No 'Inventory Adjustments' account is set up.");

    const lines: PostLine[] = wastageQty > 0
      ? [
          { accountId: adjustmentsId!, debit: wastageAmount, description: `Job work wastage — ${jwo!.docNumber}` },
          { accountId: jwClearingId!, credit: wastageAmount, description: `Job work wastage — ${jwo!.docNumber}` },
        ]
      : [
          { accountId: jwClearingId!, debit: Math.abs(wastageAmount), description: `Job work yield gain — ${jwo!.docNumber}` },
          { accountId: adjustmentsId!, credit: Math.abs(wastageAmount), description: `Job work yield gain — ${jwo!.docNumber}` },
        ];

    const entry = await postJournalEntry({
      orgId, entryDate: new Date().toISOString().slice(0, 10),
      memo: `Job work order closed — ${jwo!.docNumber} (${wastageQty > 0 ? "wastage" : "yield gain"})`,
      series: "JobWork", sourceType: "JobWorkClose", docNumber: jwo!.docNumber ?? undefined, createdBy: actorId,
      reference: jwo!.vendorLabel ?? null, lines,
    });
    wastageEntryId = entry.id;
  }

  await db.update(jobWorkOrders).set({
    status: "Closed", closedAt: new Date(), closedBy: actorId,
    wastageQty: wastageQty.toString(), wastageAmount: wastageAmount.toString(),
    wastageEntryId, updatedAt: new Date(),
  }).where(and(eq(jobWorkOrders.id, jwoId), eq(jobWorkOrders.orgId, orgId)));

  return { id: jwoId, wastageQty, wastageAmount, wastageEntryId };
}

/** Undo a close — reverses the wastage entry (if any, GL-only, no inventory
 *  to unwind) and reopens the order for further receipts. */
export async function reopenJobWorkOrder(orgId: string, jwoId: string) {
  const [jwo] = await db.select().from(jobWorkOrders).where(and(eq(jobWorkOrders.id, jwoId), eq(jobWorkOrders.orgId, orgId))).limit(1);
  if (!jwo) err("Job work order not found.");
  if (jwo!.status !== "Closed") err("This job work order isn't closed.");

  if (jwo!.wastageEntryId) await deleteEntry(orgId, jwo!.wastageEntryId);

  const receivedQty = Number(jwo!.receivedQty ?? 0);
  await db.update(jobWorkOrders).set({
    status: receivedQty > 0 ? "PartiallyReceived" : "Dispatched",
    closedAt: null, closedBy: null, wastageQty: null, wastageAmount: null, wastageEntryId: null, updatedAt: new Date(),
  }).where(and(eq(jobWorkOrders.id, jwoId), eq(jobWorkOrders.orgId, orgId)));

  return { id: jwoId, reopened: true };
}
