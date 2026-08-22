/**
 * GET  /api/inventory/items[?type=FinishedProduct|RawMaterial]  → item register
 * POST /api/inventory/items                                     → create an item
 */

import { db } from "@/db";
import { apItems } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, asc } from "drizzle-orm";

const s = (v: any, n = 255) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));
const numOrNull = (v: any) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const type = new URL(req.url).searchParams.get("type");
  const where = type ? and(eq(apItems.orgId, orgId!), eq(apItems.productType, type)) : eq(apItems.orgId, orgId!);
  const rows = await db.select().from(apItems).where(where).orderBy(asc(apItems.name));
  return ok(rows.map(r => ({
    id: r.id, name: r.name, code: r.code, category: r.category, baseUom: r.baseUom,
    productType: r.productType, status: r.status, minOhQty: Number(r.minOhQty ?? 0), source: r.source,
    unitPrice: r.unitPrice, unitCost: r.unitCost, incomeAccountId: r.incomeAccountId, expenseAccountId: r.expenseAccountId, taxRateId: r.taxRateId,
  })));
}

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const b = await req.json().catch(() => ({}));
  const name = s(b?.name); if (!name) return bad("Item name is required");
  const productType = b?.productType === "RawMaterial" ? "RawMaterial" : "FinishedProduct";
  const [row] = await db.insert(apItems).values({
    orgId: orgId!, source: "native", name,
    productType, baseUom: s(b?.baseUom, 16), category: s(b?.category, 128), code: s(b?.code, 64),
    minOhQty: (numOrNull(b?.minOhQty) ?? 0).toString(),
    itemType: productType === "RawMaterial" ? "Inventory" : "Inventory",
    unitPrice: numOrNull(b?.unitPrice) as any, unitCost: numOrNull(b?.unitCost) as any,
    incomeAccountId: s(b?.incomeAccountId, 64), expenseAccountId: s(b?.expenseAccountId, 64), taxRateId: s(b?.taxRateId, 64),
    status: "Active",
  } as any).returning();
  return ok(row);
}
