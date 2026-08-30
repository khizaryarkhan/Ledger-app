/**
 * GET  /api/inventory/receiving   → list goods receipts
 * POST /api/inventory/receiving   → post a goods receipt (Dr Inventory / Cr GR/IR)
 */

import { db } from "@/db";
import { goodsReceipts } from "@/db/schema";
import { requireOrg, ok, bad, canPostInventoryTxn } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { eq, desc } from "drizzle-orm";
import { postGoodsReceipt, type ReceiptInput } from "@/lib/inventory/receiving";
import { LedgerValidationError } from "@/lib/ledger";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  const rows = await db.select().from(goodsReceipts).where(eq(goodsReceipts.orgId, orgId!)).orderBy(desc(goodsReceipts.createdAt)).limit(200);
  return ok(rows.map(r => ({
    ...r,
    grirTotal: Number(r.grirTotal ?? 0), billedAmount: Number(r.billedAmount ?? 0),
    open: Number(r.grirTotal ?? 0) - Number(r.billedAmount ?? 0),
  })));
}

export async function POST(req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!canPostInventoryTxn(role)) return bad("You don't have permission to receive stock", 403);
  const body = (await req.json().catch(() => ({}))) as ReceiptInput;
  try {
    const res = await postGoodsReceipt(orgId!, body, (session?.user as any)?.id ?? null);
    return ok(res);
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[receiving] post failed:", e);
    return bad("Failed to post goods receipt", 500);
  }
}
