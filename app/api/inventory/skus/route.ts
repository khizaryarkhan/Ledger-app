/** POST /api/inventory/skus (finished-product SKU) · DELETE ?id= */

import { db } from "@/db";
import { itemSkus, apItems } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq } from "drizzle-orm";
import { skuReferences, blockerMessage } from "@/lib/inventory/references";
import { NextResponse } from "next/server";

const s = (v: any, n = 64) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));
const numOrNull = (v: any) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v).toString());

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const b = await req.json().catch(() => ({}));
  const [item] = await db.select({ id: apItems.id }).from(apItems).where(and(eq(apItems.id, String(b?.itemId)), eq(apItems.orgId, orgId!))).limit(1);
  if (!item) return bad("Item not found", 404);
  const [row] = await db.insert(itemSkus).values({
    orgId: orgId!, itemId: item.id,
    skuName: s(b?.skuName, 255), skuCode: s(b?.skuCode),
    innerUnitPackSize: numOrNull(b?.innerUnitPackSize), innerPackType: s(b?.innerPackType, 32),
    unitsInAddlInnerPack: numOrNull(b?.unitsInAddlInnerPack), addlInnerPackType: s(b?.addlInnerPackType, 32),
    unitsInOuterPack: numOrNull(b?.unitsInOuterPack), outerPackType: s(b?.outerPackType, 32),
    upc: s(b?.upc),
  } as any).returning();
  return ok(row);
}

export async function DELETE(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  const blockers = await skuReferences(orgId!, id);
  if (blockers.length) return NextResponse.json({ error: blockerMessage("SKU", blockers), blockers }, { status: 409 });
  await db.delete(itemSkus).where(and(eq(itemSkus.id, id), eq(itemSkus.orgId, orgId!)));
  return ok({ id, deleted: true });
}
