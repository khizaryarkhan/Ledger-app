/**
 * GET /api/trade-documents/[kind]/[id]/print
 *   → header + full lines for printing an Estimate / Purchase Order / Sales
 *     Order. These are the documents that get sent to a customer or supplier,
 *     so the payload carries what a printed copy needs (item name, ordered
 *     quantity and its unit, rate) rather than the balance-only shape the
 *     progress-invoicing screen uses.
 */

import { db } from "@/db";
import { tradeDocuments, tradeDocumentLines, apItems } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, asc, inArray } from "drizzle-orm";

const num = (v: any) => Number(v ?? 0);

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [doc] = await db.select().from(tradeDocuments)
    .where(and(eq(tradeDocuments.id, params.id), eq(tradeDocuments.orgId, orgId!))).limit(1);
  if (!doc) return bad("Document not found", 404);

  const lines = await db.select().from(tradeDocumentLines)
    .where(and(eq(tradeDocumentLines.documentId, params.id), eq(tradeDocumentLines.orgId, orgId!)))
    .orderBy(asc(tradeDocumentLines.lineNo));

  const itemIds = [...new Set(lines.map(l => l.itemId).filter(Boolean) as string[])];
  const items = itemIds.length
    ? await db.select({ id: apItems.id, name: apItems.name, baseUom: apItems.baseUom })
        .from(apItems).where(and(eq(apItems.orgId, orgId!), inArray(apItems.id, itemIds)))
    : [];
  const itemById = new Map(items.map(i => [i.id, i]));

  return ok({
    doc: {
      id: doc.id, kind: doc.kind, docNumber: doc.docNumber, status: doc.status,
      partyLabel: doc.partyLabel, issueDate: doc.issueDate, expiryDate: doc.expiryDate,
      currency: doc.currency, memo: doc.memo,
      subtotal: num(doc.subtotal), taxTotal: num(doc.taxTotal), total: num(doc.total),
    },
    lines: lines.map(l => {
      const it = l.itemId ? itemById.get(l.itemId) : null;
      return {
        id: l.id,
        name: it?.name ?? null,
        description: l.description,
        // Show the quantity as it was ordered (pack level), which is what the
        // other party agreed to — not the base-UoM figure stock is kept in.
        qty: num(l.qty),
        uom: l.orderUom || it?.baseUom || null,
        rate: num(l.rate),
        amount: num(l.amount),
      };
    }),
  });
}
