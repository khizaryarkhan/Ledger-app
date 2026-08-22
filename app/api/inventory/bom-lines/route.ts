/** POST /api/inventory/bom-lines (add input/output line) · DELETE ?id= */

import { db } from "@/db";
import { bomLines, boms } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq } from "drizzle-orm";

const s = (v: any, n = 64) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));
const numStr = (v: any, d: string | null = null) => (v == null || v === "" || isNaN(Number(v)) ? d : String(Number(v)));

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const b = await req.json().catch(() => ({}));
  const [bom] = await db.select({ id: boms.id }).from(boms).where(and(eq(boms.id, String(b?.bomId)), eq(boms.orgId, orgId!))).limit(1);
  if (!bom) return bad("BOM not found", 404);
  const roleVal = b?.role === "output" ? "output" : "input";
  if (!s(b?.itemId)) return bad("An item is required");
  const [row] = await db.insert(bomLines).values({
    orgId: orgId!, bomId: bom.id, role: roleVal,
    itemId: s(b?.itemId, 64) as any,
    qty: numStr(b?.qty, "0")!, uom: s(b?.uom, 16),
    packagingConfig: s(b?.packagingConfig, 128),
    outputPackQty: numStr(b?.outputPackQty),
    supplierSkuId: s(b?.supplierSkuId, 64) as any,
    sortOrder: Number.isFinite(Number(b?.sortOrder)) ? Number(b?.sortOrder) : 0,
  } as any).returning();
  return ok(row);
}

export async function DELETE(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  await db.delete(bomLines).where(and(eq(bomLines.id, id), eq(bomLines.orgId, orgId!)));
  return ok({ id, deleted: true });
}
