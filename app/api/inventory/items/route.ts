/**
 * GET  /api/inventory/items[?type=FinishedProduct|RawMaterial]  → item register
 * POST /api/inventory/items                                     → create an item
 */

import { db } from "@/db";
import { apItems } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, asc } from "drizzle-orm";
import { kindOf, qboItemType } from "@/lib/inventory/item-kinds";
import { systemAccountId, INV_SUBTYPE, ensureSystemAccounts } from "@/lib/accounting/system-accounts";

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
    assetAccountId: r.assetAccountId, cogsAccountId: r.cogsAccountId, lotTracked: r.lotTracked,
    onHandQty: Number(r.onHandQty ?? 0), invValue: Number(r.invValue ?? 0),
  })));
}

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const b = await req.json().catch(() => ({}));
  const name = s(b?.name); if (!name) return bad("Item name is required");
  const meta = kindOf(b?.productType);
  const productType = meta.kind;

  // Inventory-tracked items must post to a balance-sheet asset and relieve COGS.
  // Fall back to the org's system Inventory Asset / COGS accounts when the form
  // doesn't name explicit ones, so purchases never silently hit an expense.
  let assetAccountId = s(b?.assetAccountId, 64);
  let cogsAccountId = s(b?.cogsAccountId, 64);
  if (meta.tracked) {
    await ensureSystemAccounts(orgId!).catch(() => {});
    if (!assetAccountId) assetAccountId = await systemAccountId(orgId!, INV_SUBTYPE.asset);
    if (!cogsAccountId) cogsAccountId = await systemAccountId(orgId!, INV_SUBTYPE.cogs);
  }
  const lotTracked = b?.lotTracked === undefined ? meta.lotTrackedDefault : !!b.lotTracked;

  const [row] = await db.insert(apItems).values({
    orgId: orgId!, source: "native", name,
    productType, baseUom: s(b?.baseUom, 16), category: s(b?.category, 128), code: s(b?.code, 64),
    minOhQty: (numOrNull(b?.minOhQty) ?? 0).toString(),
    itemType: qboItemType(productType),
    unitPrice: numOrNull(b?.unitPrice) as any, unitCost: numOrNull(b?.unitCost) as any,
    incomeAccountId: s(b?.incomeAccountId, 64), expenseAccountId: s(b?.expenseAccountId, 64), taxRateId: s(b?.taxRateId, 64),
    assetAccountId, cogsAccountId, lotTracked,
    status: "Active",
  } as any).returning();
  return ok(row);
}
