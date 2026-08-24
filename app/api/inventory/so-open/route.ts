/**
 * GET /api/inventory/so-open[?customerId=]  → open sales orders with each
 * line's remaining-to-ship quantity (base UoM). Feeds the shipping picker.
 * (receivedQty is reused as "shipped" for Sales Orders.)
 */

import { db } from "@/db";
import { tradeDocuments, tradeDocumentLines, apItems } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { and, eq, asc, inArray } from "drizzle-orm";

const num = (v: any) => Number(v ?? 0);

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const customerId = new URL(req.url).searchParams.get("customerId");

  const sos = await db.select().from(tradeDocuments)
    .where(and(eq(tradeDocuments.orgId, orgId!), eq(tradeDocuments.kind, "SalesOrder")))
    .orderBy(asc(tradeDocuments.issueDate));
  const CLOSED = new Set(["Closed", "Cancelled", "Converted"]);
  const live = sos.filter(s => !CLOSED.has(s.status));
  const wanted = customerId ? live.filter(s => s.partyId === customerId) : live;
  if (!wanted.length) return ok([]);

  const lines = await db.select().from(tradeDocumentLines).where(inArray(tradeDocumentLines.documentId, wanted.map(s => s.id))).orderBy(asc(tradeDocumentLines.lineNo));
  const itemIds = [...new Set(lines.map(l => l.itemId).filter(Boolean) as string[])];
  const items = itemIds.length ? await db.select({ id: apItems.id, name: apItems.name, baseUom: apItems.baseUom }).from(apItems).where(and(eq(apItems.orgId, orgId!), inArray(apItems.id, itemIds))) : [];
  const itemById = new Map(items.map(i => [i.id, i]));

  const result = wanted.map(so => {
    const soLines = lines.filter(l => l.documentId === so.id && l.itemId).map(l => {
      const ordered = num(l.orderedBaseQty) || num(l.qty) * num(l.unitsPerOrderUnit || 1);
      const shipped = num(l.receivedQty);
      const remaining = Math.round((ordered - shipped) * 1e4) / 1e4;
      const it = l.itemId ? itemById.get(l.itemId) : null;
      const saleRateBase = num(l.unitsPerOrderUnit || 1) > 0 ? num(l.rate) / num(l.unitsPerOrderUnit || 1) : num(l.rate);
      return {
        lineId: l.id, itemId: l.itemId, skuId: l.skuId ?? null, itemName: it?.name ?? "Item", baseUom: it?.baseUom ?? null,
        orderedBaseQty: ordered, shippedQty: shipped, remainingQty: remaining,
        saleRateBase: Math.round(saleRateBase * 1e6) / 1e6, taxRateId: l.taxRateId ?? null,
      };
    }).filter(l => l.remainingQty > 0.0001);
    return {
      id: so.id, docNumber: so.docNumber, partyId: so.partyId, partyLabel: so.partyLabel,
      currency: so.currency, exchangeRate: num(so.exchangeRate) || 1, issueDate: so.issueDate, expiryDate: so.expiryDate,
      lines: soLines,
    };
  }).filter(so => so.lines.length > 0);

  return ok(result);
}
