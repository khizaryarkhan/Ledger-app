/**
 * Transaction relationship graph.
 *
 * A link is directional (from → to) but queried both ways, so any document can
 * show everything it relates to: the Estimate that produced an Invoice, the
 * Invoices a Payment settled, the Bill a Purchase Order became. This is the
 * foundation for progress invoicing and (next) payment application.
 */

import { db } from "@/db";
import { transactionLinks, tradeDocuments, journalEntries, journalLines, paymentApplications, payments, invoices } from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

const TRADE_TYPES = new Set(["Estimate", "PurchaseOrder"]);

export type LinkInput = {
  fromType: string; fromId: string; fromLineId?: string | null;
  toType: string; toId: string; toLineId?: string | null;
  relation: string; amount: number; contextEntryId?: string | null;
};

export async function createLink(orgId: string, l: LinkInput, actorId: string | null) {
  const [row] = await db.insert(transactionLinks).values({
    orgId, fromType: l.fromType, fromId: l.fromId, fromLineId: l.fromLineId ?? null,
    toType: l.toType, toId: l.toId, toLineId: l.toLineId ?? null,
    relation: l.relation, amount: l.amount.toFixed(2), contextEntryId: l.contextEntryId ?? l.fromId, createdBy: actorId,
  }).returning();
  return row;
}

/** Delete every link a transaction created (its cash allocations + any credit
 *  applications it made) — used when a payment is edited or reversed. */
export async function deleteLinksByContext(orgId: string, contextEntryId: string) {
  await db.delete(transactionLinks).where(and(eq(transactionLinks.orgId, orgId), eq(transactionLinks.contextEntryId, contextEntryId)));
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

export type RelatedDoc = ResolvedDoc & { direction: "from" | "to"; relation: string; linkedAmount: number; lineId: string | null };

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
    const otherLineId = isFrom ? r.toLineId : r.fromLineId;
    const doc = resolved.get(`${other.type}:${other.id}`);
    return {
      direction: isFrom ? "to" : "from",
      relation: r.relation, linkedAmount: Number(r.amount), lineId: otherLineId ?? null,
      type: other.type, id: other.id,
      docNumber: doc?.docNumber ?? null, date: doc?.date ?? null, total: doc?.total ?? 0, status: doc?.status ?? null,
    } as RelatedDoc;
  });
}

/**
 * Same shape as `linksFor`, but also covers QBO/Xero-mirrored orgs, whose
 * payment application lives in `paymentApplications` (raw-QBO-id-keyed,
 * written by lib/qbo-sync.ts) rather than `transactionLinks` — a native org
 * and a QBO-synced org never populate both tables for the same document, so
 * this merges native links with a read-only view over the mirror table
 * instead of migrating that data. Only "Invoice" / "CreditMemo" (both live in
 * the `invoices` table) and "Payment" are covered — the two ends of the
 * QBO-mirror application relationship.
 */
export async function linksForAny(orgId: string, type: string, id: string): Promise<RelatedDoc[]> {
  const native = await linksFor(orgId, type, id);
  if (type !== "Invoice" && type !== "CreditMemo" && type !== "Payment") return native;

  const mirrored: RelatedDoc[] = [];
  if (type === "Invoice" || type === "CreditMemo") {
    const apps = await db.select({ app: paymentApplications, pay: payments })
      .from(paymentApplications)
      .innerJoin(payments, eq(payments.id, paymentApplications.paymentId))
      .where(and(eq(paymentApplications.orgId, orgId), eq(paymentApplications.invoiceId, id)));
    for (const { app, pay } of apps) {
      mirrored.push({
        direction: "from", relation: "payment", linkedAmount: app.amountApplied, lineId: app.targetLineId ?? null,
        type: "Payment", id: pay.id,
        docNumber: pay.paymentRef ?? pay.qboId ?? null, date: pay.txnDate, total: pay.totalAmount, status: null,
      });
    }
  } else {
    const apps = await db.select({ app: paymentApplications, inv: invoices })
      .from(paymentApplications)
      .leftJoin(invoices, eq(invoices.id, paymentApplications.invoiceId))
      .where(and(eq(paymentApplications.orgId, orgId), eq(paymentApplications.paymentId, id)));
    for (const { app, inv } of apps) {
      mirrored.push({
        direction: "to", relation: "payment", linkedAmount: app.amountApplied, lineId: app.targetLineId ?? null,
        type: app.targetType, id: inv?.id ?? app.targetQboId,
        docNumber: inv?.invoiceNumber ?? null, date: inv?.invoiceDate ?? null, total: inv?.total ?? 0, status: inv?.paymentStatus ?? null,
      });
    }
  }
  return [...native, ...mirrored];
}
