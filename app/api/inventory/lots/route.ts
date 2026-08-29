/**
 * GET /api/inventory/lots?q=<lot code>
 *
 * Search lots by code — regardless of Open/Depleted status, since tracing a
 * fully-consumed lot's history is exactly the point of traceability. Distinct
 * from /api/inventory/reports?type=lots (Stock Valuation Detail), which only
 * lists currently-open lots for the on-hand-value report.
 */

import { db } from "@/db";
import { inventoryLots, apItems } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, ilike } from "drizzle-orm";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return bad("Pass ?q=<lot code>");
  const rows = await db.select({
    id: inventoryLots.id, lotNo: inventoryLots.lotNo, itemId: inventoryLots.itemId, itemName: apItems.name,
    status: inventoryLots.status, remainingQty: inventoryLots.remainingQty, origQty: inventoryLots.origQty,
  }).from(inventoryLots).innerJoin(apItems, eq(apItems.id, inventoryLots.itemId))
    .where(and(eq(inventoryLots.orgId, orgId!), ilike(inventoryLots.lotNo, `%${q}%`)))
    .limit(25);
  return ok(rows);
}
