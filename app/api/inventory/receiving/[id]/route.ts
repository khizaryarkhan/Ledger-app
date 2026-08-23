/** GET /api/inventory/receiving/[id] → receipt header + lines (with item names). */

import { db } from "@/db";
import { goodsReceipts, goodsReceiptLines, apItems } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, asc, inArray } from "drizzle-orm";
import { voidGoodsReceipt } from "@/lib/inventory/void";
import { LedgerValidationError } from "@/lib/ledger";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const [receipt] = await db.select().from(goodsReceipts).where(and(eq(goodsReceipts.id, params.id), eq(goodsReceipts.orgId, orgId!))).limit(1);
  if (!receipt) return bad("Receipt not found", 404);
  const lines = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.receiptId, params.id)).orderBy(asc(goodsReceiptLines.createdAt));
  const ids = [...new Set(lines.map(l => l.itemId))];
  const items = ids.length ? await db.select({ id: apItems.id, name: apItems.name, baseUom: apItems.baseUom }).from(apItems).where(and(eq(apItems.orgId, orgId!), inArray(apItems.id, ids))) : [];
  const byId = new Map(items.map(i => [i.id, i]));
  return ok({ receipt, lines: lines.map(l => ({ ...l, item: byId.get(l.itemId) ?? null })) });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  try { return ok(await voidGoodsReceipt(orgId!, params.id)); }
  catch (e: any) { if (e instanceof LedgerValidationError) return bad(e.message, 409); console.error("[receiving void]", e); return bad("Could not void receipt", 500); }
}
