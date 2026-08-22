/** GET /api/inventory/shipping/[id] → shipment header + lines. */

import { db } from "@/db";
import { salesShipments, shipmentLines, apItems } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, asc, inArray } from "drizzle-orm";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const [shipment] = await db.select().from(salesShipments).where(and(eq(salesShipments.id, params.id), eq(salesShipments.orgId, orgId!))).limit(1);
  if (!shipment) return bad("Shipment not found", 404);
  const lines = await db.select().from(shipmentLines).where(eq(shipmentLines.shipmentId, params.id)).orderBy(asc(shipmentLines.createdAt));
  const ids = [...new Set(lines.map(l => l.itemId))];
  const items = ids.length ? await db.select({ id: apItems.id, name: apItems.name, baseUom: apItems.baseUom }).from(apItems).where(and(eq(apItems.orgId, orgId!), inArray(apItems.id, ids))) : [];
  const byId = new Map(items.map(i => [i.id, i]));
  return ok({ shipment, lines: lines.map(l => ({ ...l, item: byId.get(l.itemId) ?? null })) });
}
