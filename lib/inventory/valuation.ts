/**
 * Perpetual inventory valuation — FIFO by cost lot.
 *
 * A LOT is a dated cost layer created when stock is received (purchase) or
 * produced (BOM build). Issuing stock (sale or production consumption) relieves
 * the oldest open lots first (FIFO) unless specific lots are picked, so every
 * unit carries the exact cost it entered at. The item's on-hand qty and value
 * are cached on ap_items and recomputed from the open lots after every change.
 *
 * neon-http has NO transactions — we plan (read-only) then commit, and always
 * recompute the cached totals from the authoritative lot rows afterwards.
 */

import { db } from "@/db";
import { apItems, inventoryLots, inventoryMovements } from "@/db/schema";
import { and, eq, asc, sql, inArray } from "drizzle-orm";
import { kindOf } from "@/lib/inventory/item-kinds";

const n4 = (n: number) => (Math.round((Number(n) || 0) * 1e4) / 1e4).toFixed(4);
const n6 = (n: number) => (Math.round((Number(n) || 0) * 1e6) / 1e6).toFixed(6);
const num = (v: any) => Number(v ?? 0);

export type ItemCostInfo = {
  id: string; name: string; productType: string; baseUom: string | null;
  tracked: boolean; lotTracked: boolean;
  assetAccountId: string | null; cogsAccountId: string | null;
  unitCost: number | null;
};

/** Load costing metadata for a set of item ids. */
export async function loadItemCostInfo(orgId: string, itemIds: string[]): Promise<Map<string, ItemCostInfo>> {
  const ids = [...new Set(itemIds.filter(Boolean))];
  const map = new Map<string, ItemCostInfo>();
  if (!ids.length) return map;
  const rows = await db.select().from(apItems).where(and(eq(apItems.orgId, orgId), inArray(apItems.id, ids)));
  for (const r of rows) {
    map.set(r.id, {
      id: r.id, name: r.name, productType: r.productType, baseUom: r.baseUom,
      tracked: kindOf(r.productType).tracked, lotTracked: !!r.lotTracked,
      assetAccountId: r.assetAccountId ?? null, cogsAccountId: r.cogsAccountId ?? null,
      unitCost: r.unitCost != null ? Number(r.unitCost) : null,
    });
  }
  return map;
}

/** Recompute cached on-hand qty & value from the item's OPEN lots. Authoritative. */
export async function recalcItemCache(orgId: string, itemId: string): Promise<void> {
  const lots = await db.select({ rem: inventoryLots.remainingQty, cost: inventoryLots.unitCost })
    .from(inventoryLots)
    .where(and(eq(inventoryLots.orgId, orgId), eq(inventoryLots.itemId, itemId), eq(inventoryLots.status, "Open")));
  let qty = 0, val = 0;
  for (const l of lots) { const q = num(l.rem); qty += q; val += q * num(l.cost); }
  await db.update(apItems).set({ onHandQty: n4(qty), invValue: n4(val), updatedAt: new Date() })
    .where(and(eq(apItems.id, itemId), eq(apItems.orgId, orgId)));
}

export type IssuePick = { lotId: string | null; lotNo: string | null; qty: number; unitCost: number };
export type IssuePlan = { itemId: string; qty: number; totalCost: number; picks: IssuePick[]; shortfallQty: number };

/**
 * Plan a FIFO issue (read-only). Optionally restrict to specific lot ids
 * (specific-identification, e.g. production lot picking). Any qty beyond what's
 * on hand is a shortfall costed at the item's fallback unit cost.
 */
export async function planIssue(orgId: string, item: ItemCostInfo, qty: number, restrictLotIds?: string[]): Promise<IssuePlan> {
  const want = Math.max(0, Number(qty) || 0);
  const picks: IssuePick[] = [];
  if (want === 0) return { itemId: item.id, qty: 0, totalCost: 0, picks, shortfallQty: 0 };

  let lots = await db.select().from(inventoryLots)
    .where(and(eq(inventoryLots.orgId, orgId), eq(inventoryLots.itemId, item.id), eq(inventoryLots.status, "Open")))
    .orderBy(asc(inventoryLots.receivedDate), asc(inventoryLots.createdAt));
  if (restrictLotIds?.length) { const set = new Set(restrictLotIds); lots = lots.filter(l => set.has(l.id)); }

  let remaining = want, cost = 0;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const avail = num(lot.remainingQty);
    if (avail <= 0) continue;
    const take = Math.min(avail, remaining);
    picks.push({ lotId: lot.id, lotNo: lot.lotNo, qty: take, unitCost: num(lot.unitCost) });
    cost += take * num(lot.unitCost);
    remaining -= take;
  }
  const shortfallQty = Math.round(remaining * 1e4) / 1e4;
  if (shortfallQty > 0) {
    const fb = item.unitCost ?? (picks.length ? picks[picks.length - 1].unitCost : 0);
    picks.push({ lotId: null, lotNo: null, qty: shortfallQty, unitCost: fb });
    cost += shortfallQty * fb;
  }
  return { itemId: item.id, qty: want, totalCost: Math.round(cost * 1e4) / 1e4, picks, shortfallQty };
}

export type ReceiptInput = {
  itemId: string; qty: number; unitCost: number;
  lotNo?: string | null; expiryDate?: string | null; supplierId?: string | null;
  sourceType?: "purchase" | "production" | "opening" | "adjustment";
  receivedDate: string; refType: string; refId: string; entryId?: string | null;
  createdBy?: string | null; note?: string | null;
};

/** Commit a stock receipt: create a lot + movement, refresh the item cache. Returns the lot id. */
export async function commitReceipt(orgId: string, r: ReceiptInput): Promise<string> {
  const qty = Math.max(0, Number(r.qty) || 0);
  const unitCost = Math.max(0, Number(r.unitCost) || 0);
  const [lot] = await db.insert(inventoryLots).values({
    orgId, itemId: r.itemId,
    lotNo: r.lotNo?.trim() || null,
    sourceType: r.sourceType ?? "purchase", sourceId: r.entryId ?? r.refId,
    supplierId: r.supplierId ?? null,
    receivedDate: r.receivedDate, expiryDate: r.expiryDate ?? null,
    origQty: n4(qty), remainingQty: n4(qty), unitCost: n6(unitCost),
    status: qty > 0 ? "Open" : "Depleted", note: r.note ?? null,
  } as any).returning({ id: inventoryLots.id });
  await db.insert(inventoryMovements).values({
    orgId, itemId: r.itemId, lotId: lot.id, movementType: r.sourceType === "production" ? "produce" : "receipt",
    qty: n4(qty), unitCost: n6(unitCost), totalCost: n4(qty * unitCost),
    refType: r.refType, refId: r.refId, entryId: r.entryId ?? null,
    movementDate: r.receivedDate, note: r.note ?? null, createdBy: r.createdBy ?? null,
  } as any);
  await recalcItemCache(orgId, r.itemId);
  return lot.id;
}

export type IssueCommit = {
  itemId: string; plan: IssuePlan; movementType: "issue_sale" | "issue_production" | "adjustment";
  refType: string; refId: string; entryId?: string | null; date: string; createdBy?: string | null; note?: string | null;
};

/** Commit a planned issue: relieve the picked lots + write movements, refresh cache. */
export async function commitIssue(orgId: string, c: IssueCommit): Promise<void> {
  for (const p of c.plan.picks) {
    if (p.lotId) {
      // Guarded decrement — never drive a lot negative if a concurrent write moved it.
      await db.update(inventoryLots).set({
        remainingQty: sql`greatest(${inventoryLots.remainingQty} - ${n4(p.qty)}, 0)`,
        status: sql`case when ${inventoryLots.remainingQty} - ${n4(p.qty)} <= 0 then 'Depleted' else 'Open' end`,
      }).where(and(eq(inventoryLots.id, p.lotId), eq(inventoryLots.orgId, orgId)));
    }
    await db.insert(inventoryMovements).values({
      orgId, itemId: c.itemId, lotId: p.lotId, movementType: c.movementType,
      qty: n4(-p.qty), unitCost: n6(p.unitCost), totalCost: n4(-(p.qty * p.unitCost)),
      refType: c.refType, refId: c.refId, entryId: c.entryId ?? null,
      movementDate: c.date, note: p.lotId ? c.note ?? null : (c.note ? `${c.note} (no stock — costed at fallback)` : "No stock on hand — costed at fallback"),
      createdBy: c.createdBy ?? null,
    } as any);
  }
  await recalcItemCache(orgId, c.itemId);
}

/**
 * Reverse all inventory movements a document created (by entry id) — for
 * delete / reverse / edit-then-reapply. Restores issued lots and removes receipt
 * lots. Refuses when a receipt lot has already been partly sold/consumed
 * downstream (its cost can't be cleanly unwound — reverse the later doc first).
 */
export async function reverseInventoryByEntry(orgId: string, entryId: string): Promise<void> {
  const moves = await db.select().from(inventoryMovements)
    .where(and(eq(inventoryMovements.orgId, orgId), eq(inventoryMovements.entryId, entryId)));
  if (!moves.length) return;

  const affected = new Set<string>();
  // 1. Guard receipt/produce lots that have already been drawn down.
  const receiptLotIds = moves.filter(m => (m.movementType === "receipt" || m.movementType === "produce") && m.lotId).map(m => m.lotId!) as string[];
  if (receiptLotIds.length) {
    const lots = await db.select().from(inventoryLots)
      .where(and(eq(inventoryLots.orgId, orgId), inArray(inventoryLots.id, receiptLotIds)));
    for (const lot of lots) {
      if (num(lot.remainingQty) < num(lot.origQty)) {
        throw new Error("Inventory received/produced by this document has already been sold or consumed. Reverse the later transaction(s) first.");
      }
    }
  }

  // 2. Undo each movement.
  for (const m of moves) {
    affected.add(m.itemId);
    if ((m.movementType === "receipt" || m.movementType === "produce") && m.lotId) {
      await db.delete(inventoryLots).where(and(eq(inventoryLots.id, m.lotId), eq(inventoryLots.orgId, orgId)));
    } else if (m.lotId) {
      // Issue — put the qty back on the lot and reopen it.
      const back = Math.abs(num(m.qty));
      await db.update(inventoryLots).set({
        remainingQty: sql`${inventoryLots.remainingQty} + ${n4(back)}`, status: "Open",
      }).where(and(eq(inventoryLots.id, m.lotId), eq(inventoryLots.orgId, orgId)));
    }
  }
  await db.delete(inventoryMovements).where(and(eq(inventoryMovements.orgId, orgId), eq(inventoryMovements.entryId, entryId)));
  for (const itemId of affected) await recalcItemCache(orgId, itemId);
}
