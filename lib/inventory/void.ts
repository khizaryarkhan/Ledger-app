/**
 * Void (delete) inventory EVENTS — goods receipts, shipments, production runs.
 *
 * Same house rule as everything else: an event can be voided UNTIL something
 * depends on it. A receipt can't be voided once billed; a shipment once
 * invoiced; and any of them once the stock they moved has been consumed/sold on
 * (reverseInventoryByEntry enforces that). Voiding unwinds the GL entry, the
 * FIFO lot movements, the event rows, and the order (PO/SO) progress.
 *
 * neon-http has no transactions — we guard first (so nothing mutates on a
 * blocked void), then unwind.
 */

import { db } from "@/db";
import {
  goodsReceipts, goodsReceiptLines, salesShipments, shipmentLines,
  productionRuns, productionConsumptions, tradeDocumentLines,
  journalEntries, journalLines, transactionLinks, organisations, manufacturingOrders,
  jobWorkOrders,
} from "@/db/schema";
import { and, eq, or, sql } from "drizzle-orm";
import { LedgerValidationError } from "@/lib/ledger";
import { reverseInventoryByEntry } from "@/lib/inventory/valuation";

const err = (m: string): never => { throw new LedgerValidationError(m); };

/** Delete a GL entry (lines + header + any links), guarding the period lock. */
async function deleteEntry(orgId: string, entryId: string | null) {
  if (!entryId) return;
  const [entry] = await db.select({ date: journalEntries.entryDate }).from(journalEntries)
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.orgId, orgId))).limit(1);
  if (!entry) return;
  const [org] = await db.select({ lock: organisations.bookCloseDate }).from(organisations).where(eq(organisations.id, orgId)).limit(1);
  if (org?.lock && entry.date <= org.lock) err(`The books are closed through ${org.lock}. Reopen the period to void this.`);
  await db.delete(transactionLinks).where(and(eq(transactionLinks.orgId, orgId), or(eq(transactionLinks.fromId, entryId), eq(transactionLinks.toId, entryId), eq(transactionLinks.contextEntryId, entryId))));
  await db.delete(journalLines).where(and(eq(journalLines.orgId, orgId), eq(journalLines.entryId, entryId)));
  await db.delete(journalEntries).where(and(eq(journalEntries.id, entryId), eq(journalEntries.orgId, orgId)));
}

export async function voidGoodsReceipt(orgId: string, receiptId: string) {
  const [r] = await db.select().from(goodsReceipts).where(and(eq(goodsReceipts.id, receiptId), eq(goodsReceipts.orgId, orgId))).limit(1);
  if (!r) err("Goods receipt not found.");
  if (Number(r!.billedAmount) > 0.005) err("This receipt has been billed — reverse the bill first, then void the receipt.");
  const [billed] = await db.select({ id: transactionLinks.id }).from(transactionLinks)
    .where(and(eq(transactionLinks.orgId, orgId), eq(transactionLinks.fromId, receiptId), eq(transactionLinks.relation, "receipt_bill"))).limit(1);
  if (billed) err("This receipt has a bill against it — reverse the bill first.");

  // Unwind lots (throws if the received stock was already consumed/sold on).
  try { await reverseInventoryByEntry(orgId, r!.entryId ?? receiptId); }
  catch (e: any) { err(e?.message || "The received stock has already been used — reverse those transactions first."); }

  // Restore PO received-qty for any linked lines.
  const lines = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.receiptId, receiptId));
  for (const l of lines) if (l.poLineId) await db.update(tradeDocumentLines)
    .set({ receivedQty: sql`greatest(${tradeDocumentLines.receivedQty} - ${l.qtyBase}, 0)` })
    .where(and(eq(tradeDocumentLines.id, l.poLineId), eq(tradeDocumentLines.orgId, orgId)));

  await deleteEntry(orgId, r!.entryId ?? null);
  await db.delete(goodsReceipts).where(and(eq(goodsReceipts.id, receiptId), eq(goodsReceipts.orgId, orgId))); // lines cascade
  return { id: receiptId, voided: true };
}

export async function voidShipment(orgId: string, shipmentId: string) {
  const [s] = await db.select().from(salesShipments).where(and(eq(salesShipments.id, shipmentId), eq(salesShipments.orgId, orgId))).limit(1);
  if (!s) err("Shipment not found.");
  if (Number(s!.invoicedAmount) > 0.005) err("This shipment has been invoiced — reverse the invoice first, then void the shipment.");
  const [inv] = await db.select({ id: transactionLinks.id }).from(transactionLinks)
    .where(and(eq(transactionLinks.orgId, orgId), eq(transactionLinks.fromId, shipmentId), eq(transactionLinks.relation, "shipment_invoice"))).limit(1);
  if (inv) err("This shipment has an invoice against it — reverse the invoice first.");

  // Restores the relieved lots.
  try { await reverseInventoryByEntry(orgId, s!.entryId ?? shipmentId); }
  catch (e: any) { err(e?.message || "Could not unwind this shipment's stock movements."); }

  const lines = await db.select().from(shipmentLines).where(eq(shipmentLines.shipmentId, shipmentId));
  for (const l of lines) if (l.soLineId) await db.update(tradeDocumentLines)
    .set({ receivedQty: sql`greatest(${tradeDocumentLines.receivedQty} - ${l.qtyBase}, 0)` })
    .where(and(eq(tradeDocumentLines.id, l.soLineId), eq(tradeDocumentLines.orgId, orgId)));

  await deleteEntry(orgId, s!.entryId ?? null);
  await db.delete(salesShipments).where(and(eq(salesShipments.id, shipmentId), eq(salesShipments.orgId, orgId)));
  return { id: shipmentId, voided: true };
}

export async function voidProductionRun(orgId: string, runId: string) {
  const [run] = await db.select().from(productionRuns).where(and(eq(productionRuns.id, runId), eq(productionRuns.orgId, orgId))).limit(1);
  if (!run) err("Production run not found.");

  // Restores consumed input lots and removes the produced output lot — throws
  // if the produced stock has since been sold or consumed in another build.
  try { await reverseInventoryByEntry(orgId, run!.entryId ?? runId); }
  catch (e: any) { err(e?.message || "The produced stock has already been used — reverse those transactions first."); }

  await deleteEntry(orgId, run!.entryId ?? null);
  await db.delete(productionRuns).where(and(eq(productionRuns.id, runId), eq(productionRuns.orgId, orgId))); // consumptions cascade

  // If this run came from completing a Manufacturing Order, un-brick that MO:
  // clear its run link and drop it back to Released so it can be re-built.
  await db.update(manufacturingOrders)
    .set({ status: "Released", productionRunId: null, updatedAt: new Date() })
    .where(and(eq(manufacturingOrders.orgId, orgId), eq(manufacturingOrders.productionRunId, runId)));

  return { id: runId, voided: true };
}

/**
 * Void a job work order — either leg, dispatch-only or dispatch+receive.
 * Received: refuses if the processing-fee receipt has already been billed
 * (mirrors voidGoodsReceipt's guard — the receipt IS an ordinary
 * goods_receipts row, see lib/inventory/jobwork.ts's receiveFromJobWork), or
 * if the received stock has been consumed downstream (reverseInventoryByEntry
 * enforces that). Reverses the receive leg first (most recent), then the
 * dispatch leg (restores the originally sent item's lot).
 */
export async function voidJobWorkOrder(orgId: string, jwoId: string) {
  const [jwo] = await db.select().from(jobWorkOrders).where(and(eq(jobWorkOrders.id, jwoId), eq(jobWorkOrders.orgId, orgId))).limit(1);
  if (!jwo) err("Job work order not found.");

  if (jwo!.status === "Received") {
    if (jwo!.receiptId) {
      const [receipt] = await db.select().from(goodsReceipts).where(and(eq(goodsReceipts.id, jwo!.receiptId), eq(goodsReceipts.orgId, orgId))).limit(1);
      if (receipt && Number(receipt.billedAmount) > 0.005) err("The processing-fee bill has been created for this receipt — reverse the bill first, then void.");
      const [billed] = await db.select({ id: transactionLinks.id }).from(transactionLinks)
        .where(and(eq(transactionLinks.orgId, orgId), eq(transactionLinks.fromId, jwo!.receiptId), eq(transactionLinks.relation, "receipt_bill"))).limit(1);
      if (billed) err("This receipt has a bill against it — reverse the bill first.");
    }

    try { await reverseInventoryByEntry(orgId, jwo!.receiveEntryId ?? jwoId); }
    catch (e: any) { err(e?.message || "The received stock has already been used — reverse those transactions first."); }

    await deleteEntry(orgId, jwo!.receiveEntryId ?? null);
    if (jwo!.receiptId) await db.delete(goodsReceipts).where(and(eq(goodsReceipts.id, jwo!.receiptId), eq(goodsReceipts.orgId, orgId))); // lines cascade
  }

  // Restores the sent item's lot — throws if it's somehow already been
  // consumed further (shouldn't happen: dispatched material only ever leaves
  // via this same job work order's receive leg, already unwound above).
  try { await reverseInventoryByEntry(orgId, jwo!.dispatchEntryId ?? jwoId); }
  catch (e: any) { err(e?.message || "Could not unwind this job work order's dispatch."); }
  await deleteEntry(orgId, jwo!.dispatchEntryId ?? null);

  await db.delete(jobWorkOrders).where(and(eq(jobWorkOrders.id, jwoId), eq(jobWorkOrders.orgId, orgId)));
  return { id: jwoId, voided: true };
}
