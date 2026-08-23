/**
 * Referential-integrity guard — the single place that answers "can this record
 * be deleted, or is something depending on it?".
 *
 * House rule: anything created in the app stays editable/deletable UNTIL a
 * transaction depends on it. Each function returns the list of dependents that
 * block deletion (empty = safe to delete). Routes turn a non-empty list into a
 * 409 with a clear "in use by …" message instead of cascading or orphaning.
 */

import { db } from "@/db";
import {
  inventoryLots, inventoryMovements, bomLines, boms, tradeDocumentLines,
  goodsReceiptLines, shipmentLines, productionRuns,
  journalLines, tradeDocuments, invoices, goodsReceipts, salesShipments,
} from "@/db/schema";
import { and, eq, or, sql, type SQL } from "drizzle-orm";

export type Blocker = { label: string; count: number };

/** Count rows in `table` matching `where` (org-scoped by the caller's clause). */
async function count(table: any, where: SQL): Promise<number> {
  const [row] = await db.select({ c: sql<number>`count(*)::int` }).from(table).where(where);
  return Number(row?.c ?? 0);
}

const pack = (entries: [string, number][]): Blocker[] =>
  entries.filter(([, n]) => n > 0).map(([label, count]) => ({ label, count }));

/** Dependents that block deleting an inventory item. */
export async function itemReferences(orgId: string, itemId: string): Promise<Blocker[]> {
  const [stock, orderLines, receipts, shipments, bomUse, bomOut, runs] = await Promise.all([
    count(inventoryLots, and(eq(inventoryLots.orgId, orgId), eq(inventoryLots.itemId, itemId))!),
    count(tradeDocumentLines, and(eq(tradeDocumentLines.orgId, orgId), eq(tradeDocumentLines.itemId, itemId))!),
    count(goodsReceiptLines, and(eq(goodsReceiptLines.orgId, orgId), eq(goodsReceiptLines.itemId, itemId))!),
    count(shipmentLines, and(eq(shipmentLines.orgId, orgId), eq(shipmentLines.itemId, itemId))!),
    count(bomLines, and(eq(bomLines.orgId, orgId), eq(bomLines.itemId, itemId))!),
    count(boms, and(eq(boms.orgId, orgId), eq(boms.outputItemId, itemId))!),
    count(productionRuns, and(eq(productionRuns.orgId, orgId), eq(productionRuns.outputItemId, itemId))!),
  ]);
  return pack([
    ["cost lots / stock movements", stock],
    ["purchase/sales order lines", orderLines],
    ["goods receipts", receipts],
    ["shipments", shipments],
    ["bills of material", bomUse + bomOut],
    ["production runs", runs],
  ]);
}

/** Whether an item's base UoM / kind may still be changed (only before it has stock). */
export async function itemHasStockHistory(orgId: string, itemId: string): Promise<boolean> {
  const n = await count(inventoryMovements, and(eq(inventoryMovements.orgId, orgId), eq(inventoryMovements.itemId, itemId))!);
  return n > 0;
}

/** Dependents that block deleting a finished-product SKU. */
export async function skuReferences(orgId: string, skuId: string): Promise<Blocker[]> {
  const [stock, bomUse, bomOut, orderLines, receipts, shipments] = await Promise.all([
    count(inventoryLots, and(eq(inventoryLots.orgId, orgId), eq(inventoryLots.skuId, skuId))!),
    count(bomLines, and(eq(bomLines.orgId, orgId), eq(bomLines.skuId, skuId))!),
    count(boms, and(eq(boms.orgId, orgId), eq(boms.outputSkuId, skuId))!),
    count(tradeDocumentLines, and(eq(tradeDocumentLines.orgId, orgId), eq(tradeDocumentLines.skuId, skuId))!),
    count(goodsReceiptLines, and(eq(goodsReceiptLines.orgId, orgId), eq(goodsReceiptLines.skuId, skuId))!),
    count(shipmentLines, and(eq(shipmentLines.orgId, orgId), eq(shipmentLines.skuId, skuId))!),
  ]);
  return pack([
    ["stock on hand / movements", stock],
    ["bills of material", bomUse + bomOut],
    ["order lines", orderLines],
    ["goods receipts", receipts],
    ["shipments", shipments],
  ]);
}

/** Dependents that block deleting a supplier SKU. */
export async function supplierSkuReferences(orgId: string, id: string): Promise<Blocker[]> {
  const orderLines = await count(tradeDocumentLines, and(eq(tradeDocumentLines.orgId, orgId), eq(tradeDocumentLines.supplierSkuId, id))!);
  return pack([["purchase order lines", orderLines]]);
}

/** Dependents that block deleting a BOM. */
export async function bomReferences(orgId: string, bomId: string): Promise<Blocker[]> {
  const runs = await count(productionRuns, and(eq(productionRuns.orgId, orgId), eq(productionRuns.bomId, bomId))!);
  return pack([["production runs", runs]]);
}

/** Dependents that block deleting a party (customer / supplier / employee). */
export async function partyReferences(orgId: string, type: "customers" | "suppliers" | "employees", id: string): Promise<Blocker[]> {
  const txns = await count(journalLines, and(eq(journalLines.orgId, orgId), eq(journalLines.nameId, id))!);
  const orders = await count(tradeDocuments, and(eq(tradeDocuments.orgId, orgId), eq(tradeDocuments.partyId, id))!);
  const entries: [string, number][] = [["posted transactions", txns], ["estimates / orders", orders]];
  if (type === "customers") {
    entries.push(["receivable invoices", await count(invoices, and(eq(invoices.orgId, orgId), eq(invoices.customerId, id))!)]);
    entries.push(["shipments", await count(salesShipments, and(eq(salesShipments.orgId, orgId), eq(salesShipments.customerId, id))!)]);
  } else if (type === "suppliers") {
    entries.push(["goods receipts", await count(goodsReceipts, and(eq(goodsReceipts.orgId, orgId), eq(goodsReceipts.supplierId, id))!)]);
  }
  return pack(entries);
}

/** Human message for a set of blockers. */
export function blockerMessage(what: string, blockers: Blocker[]): string {
  const parts = blockers.map(b => `${b.count} ${b.label}`);
  return `This ${what} can't be deleted — it's in use by ${parts.join(", ")}. Remove or reverse ${parts.length > 1 ? "those" : "that"} first.`;
}
