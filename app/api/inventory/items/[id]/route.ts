/**
 * GET    /api/inventory/items/[id]  → item + its SKUs / supplier SKUs
 * PATCH  /api/inventory/items/[id]  → update item fields
 * DELETE /api/inventory/items/[id]  → delete the item (SKUs cascade)
 */

import { db } from "@/db";
import { apItems, itemSkus, itemSupplierSkus, apSuppliers, inventoryLots, inventoryMovements } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, asc, desc } from "drizzle-orm";
import { kindOf, qboItemType } from "@/lib/inventory/item-kinds";

const s = (v: any, n = 255) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));
const numOrNull = (v: any) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const [item] = await db.select().from(apItems).where(and(eq(apItems.id, params.id), eq(apItems.orgId, orgId!))).limit(1);
  if (!item) return bad("Item not found", 404);
  const skus = await db.select().from(itemSkus).where(eq(itemSkus.itemId, params.id)).orderBy(asc(itemSkus.createdAt));
  const supRows = await db.select().from(itemSupplierSkus).where(eq(itemSupplierSkus.itemId, params.id)).orderBy(asc(itemSupplierSkus.createdAt));
  const supIds = [...new Set(supRows.map(r => r.supplierId).filter(Boolean) as string[])];
  const sups = supIds.length ? await db.select({ id: apSuppliers.id, name: apSuppliers.displayName, name2: apSuppliers.name }).from(apSuppliers).where(eq(apSuppliers.orgId, orgId!)) : [];
  const supName = new Map(sups.map(x => [x.id, x.name || x.name2]));
  // Open FIFO cost lots + recent stock movements for inventory-tracked items.
  const lots = await db.select().from(inventoryLots)
    .where(and(eq(inventoryLots.orgId, orgId!), eq(inventoryLots.itemId, params.id), eq(inventoryLots.status, "Open")))
    .orderBy(asc(inventoryLots.receivedDate), asc(inventoryLots.createdAt));
  const movements = await db.select().from(inventoryMovements)
    .where(and(eq(inventoryMovements.orgId, orgId!), eq(inventoryMovements.itemId, params.id)))
    .orderBy(desc(inventoryMovements.createdAt)).limit(50);
  return ok({
    item,
    skus,
    supplierSkus: supRows.map(r => ({ ...r, supplierName: r.supplierId ? supName.get(r.supplierId) ?? null : null })),
    lots,
    movements,
  });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const b = await req.json().catch(() => ({}));
  const set: Record<string, any> = { updatedAt: new Date() };
  if (b.name !== undefined) set.name = s(b.name);
  if (b.category !== undefined) set.category = s(b.category, 128);
  if (b.baseUom !== undefined) set.baseUom = s(b.baseUom, 16);
  if (b.code !== undefined) set.code = s(b.code, 64);
  if (b.status !== undefined) set.status = s(b.status, 32);
  if (b.productType !== undefined) { const m = kindOf(b.productType); set.productType = m.kind; set.itemType = qboItemType(m.kind); }
  if (b.minOhQty !== undefined) set.minOhQty = (numOrNull(b.minOhQty) ?? 0).toString();
  if (b.unitPrice !== undefined) set.unitPrice = numOrNull(b.unitPrice);
  if (b.unitCost !== undefined) set.unitCost = numOrNull(b.unitCost);
  if (b.incomeAccountId !== undefined) set.incomeAccountId = s(b.incomeAccountId, 64);
  if (b.expenseAccountId !== undefined) set.expenseAccountId = s(b.expenseAccountId, 64);
  if (b.assetAccountId !== undefined) set.assetAccountId = s(b.assetAccountId, 64);
  if (b.cogsAccountId !== undefined) set.cogsAccountId = s(b.cogsAccountId, 64);
  if (b.lotTracked !== undefined) set.lotTracked = !!b.lotTracked;
  if (b.taxRateId !== undefined) set.taxRateId = s(b.taxRateId, 64);
  await db.update(apItems).set(set).where(and(eq(apItems.id, params.id), eq(apItems.orgId, orgId!)));
  return ok({ id: params.id, updated: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  await db.delete(apItems).where(and(eq(apItems.id, params.id), eq(apItems.orgId, orgId!)));
  return ok({ id: params.id, deleted: true });
}
