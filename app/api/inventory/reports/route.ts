/**
 * GET /api/inventory/reports?type=valuation|status|lots
 *
 *  valuation → per tracked item: on-hand qty, avg cost, total inventory value
 *  status    → per tracked item: on-hand vs minimum reorder qty (+ below-min flag)
 *  lots      → every open FIFO cost lot with its item, remaining qty, cost & value
 */

import { db } from "@/db";
import { apItems, inventoryLots, tradeDocuments, tradeDocumentLines } from "@/db/schema";
import { requireReadScope, ok, bad } from "@/lib/api";
import { and, eq, asc, inArray } from "drizzle-orm";
import { kindOf } from "@/lib/inventory/item-kinds";

const num = (v: any) => Number(v ?? 0);

/** Open-order remaining qty per item (base UoM), for a PO or SO. */
async function openOrderQtyByItem(orgIds: string[], kind: "PurchaseOrder" | "SalesOrder"): Promise<Map<string, number>> {
  const docs = await db.select({ id: tradeDocuments.id }).from(tradeDocuments)
    .where(and(inArray(tradeDocuments.orgId, orgIds), eq(tradeDocuments.kind, kind)));
  const map = new Map<string, number>();
  if (!docs.length) return map;
  const lines = await db.select().from(tradeDocumentLines).where(inArray(tradeDocumentLines.documentId, docs.map(p => p.id)));
  for (const l of lines) {
    if (!l.itemId) continue;
    const ordered = num(l.orderedBaseQty) || num(l.qty) * num(l.unitsPerOrderUnit || 1);
    const remaining = ordered - num(l.receivedQty); // receivedQty = received (PO) / shipped (SO)
    if (remaining > 0.0001) map.set(l.itemId, (map.get(l.itemId) ?? 0) + remaining);
  }
  return map;
}

export async function GET(req: Request) {
  const { error, orgIds } = await requireReadScope();
  if (error) return error;
  const type = new URL(req.url).searchParams.get("type") || "valuation";

  const items = await db.select().from(apItems).where(inArray(apItems.orgId, orgIds!)).orderBy(asc(apItems.name));
  const tracked = items.filter(i => kindOf(i.productType).tracked);

  if (type === "status") {
    const expected = await openOrderQtyByItem(orgIds!, "PurchaseOrder");
    const committed = await openOrderQtyByItem(orgIds!, "SalesOrder");
    return ok(tracked.map(i => {
      const onHand = num(i.onHandQty), min = num(i.minOhQty), exp = expected.get(i.id) ?? 0, com = committed.get(i.id) ?? 0;
      const available = onHand + exp - com;
      return {
        id: i.id, name: i.name, code: i.code, category: i.category, baseUom: i.baseUom, productType: i.productType,
        onHandQty: onHand, expectedQty: Math.round(exp * 1e4) / 1e4, committedQty: Math.round(com * 1e4) / 1e4,
        availableQty: Math.round(available * 1e4) / 1e4, minOhQty: min,
        belowMin: min > 0 && available < min, out: onHand <= 0,
      };
    }));
  }

  if (type === "lots") {
    const ids = tracked.map(i => i.id);
    const nameById = new Map(tracked.map(i => [i.id, { name: i.name, code: i.code, baseUom: i.baseUom }]));
    const lots = ids.length
      ? await db.select().from(inventoryLots)
          .where(and(inArray(inventoryLots.orgId, orgIds!), eq(inventoryLots.status, "Open")))
          .orderBy(asc(inventoryLots.itemId), asc(inventoryLots.receivedDate), asc(inventoryLots.createdAt))
      : [];
    return ok(lots.filter(l => nameById.has(l.itemId)).map(l => {
      const meta = nameById.get(l.itemId)!;
      const rem = num(l.remainingQty), cost = num(l.unitCost);
      return {
        id: l.id, itemId: l.itemId, itemName: meta.name, itemCode: meta.code, baseUom: meta.baseUom,
        lotNo: l.lotNo, sourceType: l.sourceType, receivedDate: l.receivedDate, expiryDate: l.expiryDate,
        remainingQty: rem, unitCost: cost, value: Math.round(rem * cost * 100) / 100,
      };
    }));
  }

  // valuation (default)
  let grand = 0;
  const rows = tracked.map(i => {
    const onHand = num(i.onHandQty), value = num(i.invValue);
    grand += value;
    return {
      id: i.id, name: i.name, code: i.code, category: i.category, baseUom: i.baseUom, productType: i.productType,
      onHandQty: onHand, avgCost: onHand !== 0 ? Math.round((value / onHand) * 1e4) / 1e4 : 0, value: Math.round(value * 100) / 100,
    };
  });
  return ok({ rows, total: Math.round(grand * 100) / 100 });
}
