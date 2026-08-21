/**
 * Transaction relationship graph.
 *
 * A link is directional (from → to) but queried both ways, so any document can
 * show everything it relates to: the Estimate that produced an Invoice, the
 * Invoices a Payment settled, the Bill a Purchase Order became. This is the
 * foundation for progress invoicing and (next) payment application.
 */

import { db } from "@/db";
import { transactionLinks, tradeDocuments, journalEntries, journalLines } from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

const TRADE_TYPES = new Set(["Estimate", "PurchaseOrder"]);

export type LinkInput = { fromType: string; fromId: string; toType: string; toId: string; relation: string; amount: number };

export async function createLink(orgId: string, l: LinkInput, actorId: string | null) {
  const [row] = await db.insert(transactionLinks).values({
    orgId, fromType: l.fromType, fromId: l.fromId, toType: l.toType, toId: l.toId,
    relation: l.relation, amount: l.amount.toFixed(2), createdBy: actorId,
  }).returning();
  return row;
}

type DocRef = { type: string; id: string };
type ResolvedDoc = { type: string; id: string; docNumber: string | null; date: string | null; total: number; status: string | null };

/** Resolve display info for a set of documents (trade docs + posted entries). */
async function resolveDocs(orgId: string, refs: DocRef[]): Promise<Map<string, ResolvedDoc>> {
  const out = new Map<string, ResolvedDoc>();
  const key = (r: DocRef) => `${r.type}:${r.id}`;
  const tradeIds = refs.filter(r => TRADE_TYPES.has(r.type)).map(r => r.id);
  const entryIds = refs.filter(r => !TRADE_TYPES.has(r.type)).map(r => r.id);

  if (tradeIds.length) {
    const rows = await db.select().from(tradeDocuments)
      .where(and(eq(tradeDocuments.orgId, orgId), inArray(tradeDocuments.id, tradeIds)));
    for (const r of rows) out.set(`${r.kind}:${r.id}`, { type: r.kind, id: r.id, docNumber: r.docNumber, date: r.issueDate, total: Number(r.total), status: r.status });
  }
  if (entryIds.length) {
    const entries = await db.select().from(journalEntries)
      .where(and(eq(journalEntries.orgId, orgId), inArray(journalEntries.id, entryIds)));
    const sums = await db.select({ entryId: journalLines.entryId, total: sql<string>`sum(${journalLines.debit})` })
      .from(journalLines).where(inArray(journalLines.entryId, entryIds)).groupBy(journalLines.entryId);
    const totalById = new Map(sums.map(s => [s.entryId, Number(s.total ?? 0)]));
    for (const e of entries) out.set(`${e.sourceType}:${e.id}`, { type: e.sourceType, id: e.id, docNumber: e.docNumber ?? `JE-${e.entryNumber}`, date: e.entryDate, total: totalById.get(e.id) ?? 0, status: e.status });
  }
  return out;
}

export type RelatedDoc = ResolvedDoc & { direction: "from" | "to"; relation: string; linkedAmount: number };

/** All documents linked to (type,id), both directions, enriched for display. */
export async function linksFor(orgId: string, type: string, id: string): Promise<RelatedDoc[]> {
  const rows = await db.select().from(transactionLinks)
    .where(and(
      eq(transactionLinks.orgId, orgId),
      sql`((${transactionLinks.fromType} = ${type} AND ${transactionLinks.fromId} = ${id})
        OR (${transactionLinks.toType} = ${type} AND ${transactionLinks.toId} = ${id}))`,
    ));
  const refs: DocRef[] = [];
  for (const r of rows) {
    if (r.fromType === type && r.fromId === id) refs.push({ type: r.toType, id: r.toId });
    else refs.push({ type: r.fromType, id: r.fromId });
  }
  const resolved = await resolveDocs(orgId, refs);
  return rows.map(r => {
    const isFrom = r.fromType === type && r.fromId === id;
    const other = isFrom ? { type: r.toType, id: r.toId } : { type: r.fromType, id: r.fromId };
    const doc = resolved.get(`${other.type}:${other.id}`);
    return {
      direction: isFrom ? "to" : "from",
      relation: r.relation, linkedAmount: Number(r.amount),
      type: other.type, id: other.id,
      docNumber: doc?.docNumber ?? null, date: doc?.date ?? null, total: doc?.total ?? 0, status: doc?.status ?? null,
    } as RelatedDoc;
  });
}
