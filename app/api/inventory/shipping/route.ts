/**
 * GET  /api/inventory/shipping   → list shipments
 * POST /api/inventory/shipping   → post a shipment (Dr COGS / Cr Inventory)
 */

import { db } from "@/db";
import { salesShipments } from "@/db/schema";
import { requireOrg, ok, bad, canPostInventoryTxn } from "@/lib/api";
import { eq, desc } from "drizzle-orm";
import { postShipment, type ShipmentInput } from "@/lib/inventory/shipping";
import { LedgerValidationError } from "@/lib/ledger";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const rows = await db.select().from(salesShipments).where(eq(salesShipments.orgId, orgId!)).orderBy(desc(salesShipments.createdAt)).limit(200);
  return ok(rows.map(r => ({
    ...r, cogsTotal: Number(r.cogsTotal ?? 0), saleTotal: Number(r.saleTotal ?? 0), invoicedAmount: Number(r.invoicedAmount ?? 0),
    open: Number(r.saleTotal ?? 0) - Number(r.invoicedAmount ?? 0),
  })));
}

export async function POST(req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (!canPostInventoryTxn(role)) return bad("You don't have permission to post shipments", 403);
  const body = (await req.json().catch(() => ({}))) as ShipmentInput;
  try {
    const res = await postShipment(orgId!, body, (session?.user as any)?.id ?? null);
    return ok(res);
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[shipping] post failed:", e);
    return bad("Failed to post shipment", 500);
  }
}
