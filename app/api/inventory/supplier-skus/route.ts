/** POST /api/inventory/supplier-skus (raw-material supplier link) · DELETE ?id= */

import { db } from "@/db";
import { itemSupplierSkus, apItems } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq } from "drizzle-orm";
import { needsConversionFactor } from "@/lib/inventory/uom";
import { supplierSkuReferences, blockerMessage } from "@/lib/inventory/references";
import { NextResponse } from "next/server";

const s = (v: any, n = 64) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));
const numOrNull = (v: any) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v).toString());

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const b = await req.json().catch(() => ({}));
  const [item] = await db.select({ id: apItems.id, baseUom: apItems.baseUom }).from(apItems).where(and(eq(apItems.id, String(b?.itemId)), eq(apItems.orgId, orgId!))).limit(1);
  if (!item) return bad("Item not found", 404);

  const supplierUom = s(b?.supplierUom, 16);
  // Cross-dimension packaging (e.g. item Lt ↔ supplier Lb) requires an explicit factor.
  const factorRequired = !!(item.baseUom && supplierUom && needsConversionFactor(item.baseUom, supplierUom));
  const factor = numOrNull(b?.conversionFactor);
  if (factorRequired && !factor) {
    return bad(`A conversion factor is required to convert supplier UoM "${supplierUom}" to item base UoM "${item.baseUom}".`);
  }

  const [row] = await db.insert(itemSupplierSkus).values({
    orgId: orgId!, itemId: item.id,
    supplierId: s(b?.supplierId, 64), supplierUom,
    skuName: s(b?.skuName, 255), supplierSku: s(b?.supplierSku),
    itemCodeBySupplier: s(b?.itemCodeBySupplier),
    innerUnitPackSize: numOrNull(b?.innerUnitPackSize), innerPackType: s(b?.innerPackType, 32),
    unitsInOuterPack: numOrNull(b?.unitsInOuterPack), outerPackType: s(b?.outerPackType, 32),
    conversionFactor: factor,
  } as any).returning();
  return ok(row);
}

export async function DELETE(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  const blockers = await supplierSkuReferences(orgId!, id);
  if (blockers.length) return NextResponse.json({ error: blockerMessage("supplier SKU", blockers), blockers }, { status: 409 });
  await db.delete(itemSupplierSkus).where(and(eq(itemSupplierSkus.id, id), eq(itemSupplierSkus.orgId, orgId!)));
  return ok({ id, deleted: true });
}
