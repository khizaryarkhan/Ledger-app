/**
 * GET /api/inventory/po-open[?supplierId=]  → open purchase orders with each
 * line's remaining-to-receive quantity (base UoM). Feeds the receiving picker.
 */

import { db } from "@/db";
import { tradeDocuments, tradeDocumentLines, apItems } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq, asc, inArray } from "drizzle-orm";

const num = (v: any) => Number(v ?? 0);

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  const supplierId = new URL(req.url).searchParams.get("supplierId");

  const pos = await db.select().from(tradeDocuments)
    .where(and(eq(tradeDocuments.orgId, orgId!), eq(tradeDocuments.kind, "PurchaseOrder")))
    .orderBy(asc(tradeDocuments.issueDate));
  const CLOSED = new Set(["Closed", "Cancelled", "Converted"]);
  const live = pos.filter(p => !CLOSED.has(p.status));
  const wanted = supplierId ? live.filter(p => p.partyId === supplierId) : live;
  if (!wanted.length) return ok([]);

  const poIds = wanted.map(p => p.id);
  const lines = await db.select().from(tradeDocumentLines).where(inArray(tradeDocumentLines.documentId, poIds)).orderBy(asc(tradeDocumentLines.lineNo));
  const itemIds = [...new Set(lines.map(l => l.itemId).filter(Boolean) as string[])];
  const items = itemIds.length ? await db.select({ id: apItems.id, name: apItems.name, baseUom: apItems.baseUom, productType: apItems.productType }).from(apItems).where(and(eq(apItems.orgId, orgId!), inArray(apItems.id, itemIds))) : [];
  const itemById = new Map(items.map(i => [i.id, i]));

  const result = wanted.map(po => {
    const poLines = lines.filter(l => l.documentId === po.id && l.itemId).map(l => {
      const ordered = num(l.orderedBaseQty) || num(l.qty) * num(l.unitsPerOrderUnit || 1);
      const received = num(l.receivedQty);
      const remaining = Math.round((ordered - received) * 1e4) / 1e4;
      const it = l.itemId ? itemById.get(l.itemId) : null;
      return {
        lineId: l.id, itemId: l.itemId, skuId: l.skuId ?? null, itemName: it?.name ?? "Item", baseUom: it?.baseUom ?? null,
        orderUom: l.orderUom, packLevel: l.packLevel, unitsPerOrderUnit: num(l.unitsPerOrderUnit || 1),
        rate: num(l.rate), orderedBaseQty: ordered, receivedQty: received, remainingQty: remaining,
        unitCostBase: num(l.unitsPerOrderUnit || 1) > 0 ? Math.round((num(l.rate) / num(l.unitsPerOrderUnit || 1)) * 1e6) / 1e6 : num(l.rate),
      };
    }).filter(l => l.remainingQty > 0.0001);
    return {
      id: po.id, docNumber: po.docNumber, partyId: po.partyId, partyLabel: po.partyLabel,
      currency: po.currency, exchangeRate: num(po.exchangeRate) || 1, issueDate: po.issueDate, expiryDate: po.expiryDate,
      lines: poLines,
    };
  }).filter(po => po.lines.length > 0);

  return ok(result);
}
