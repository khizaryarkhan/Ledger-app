/**
 * GET /api/batch/debug/record — read-only QuickBooks inspection (no mutation).
 *
 *   ?entity=deposit&list=1        → last ~20 records, each with its Id + a
 *                                    compact view of every line (id, type,
 *                                    amount, whether it's a LinkedTxn). Use this
 *                                    to grab the real internal Id.
 *   ?entity=deposit&id=148        → the RAW QBO JSON for one record by Id.
 *   ?entity=deposit&docNumber=42  → …or looked up by its DocNumber.
 *
 * Org-scoped, read-only. Exists to see what a transaction's Line array actually
 * contains (e.g. after an Update that didn't delete a line as expected).
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { getEntity } from "@/lib/batch/entities";
import { getOrgQboToken } from "@/lib/qbo-token";
import { qboReadOne, qboQueryAll } from "@/lib/batch/qbo-client";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Compact one QBO record down to its id + line summary (id, type, amount). */
function summarize(r: any) {
  const lines = (r.Line || []).map((l: any) => {
    const linked = Array.isArray(l.LinkedTxn) && l.LinkedTxn.length ? l.LinkedTxn : null;
    return {
      lineId: l.Id ?? null,
      detailType: l.DetailType ?? null,
      amount: l.Amount ?? null,
      linkedTxn: linked ? linked.map((t: any) => ({ TxnType: t.TxnType, TxnId: t.TxnId })) : undefined,
    };
  });
  return { Id: r.Id, DocNumber: r.DocNumber ?? null, TxnDate: r.TxnDate ?? null, TotalAmt: r.TotalAmt ?? null, lineCount: lines.length, lines };
}

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const url = new URL(req.url);
  const entityId = url.searchParams.get("entity") || "";
  const id = url.searchParams.get("id") || "";
  const docNumber = url.searchParams.get("docNumber") || "";
  const list = url.searchParams.get("list");

  const entity = getEntity(entityId);
  if (!entity?.qboEntity || !entity.qboReadName) return bad("Pass ?entity=<entity id> (e.g. deposit)", 404);

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected for this organisation", 400);

  // List mode — grab the real Ids + line structure without guessing.
  if (list) {
    try {
      const rows = await qboQueryAll(token, entity.qboReadName, entity.qboExtraWhere || undefined);
      const recent = rows.slice(-20).reverse().map(summarize);
      return ok({ mode: "list", count: rows.length, showing: recent.length, records: recent });
    } catch (e: any) {
      return bad(`QuickBooks query failed: ${e?.message || "unknown"}`, 502);
    }
  }

  if (id) {
    const record = await qboReadOne(token, entity.qboEntity, id);
    if (record) return ok({ mode: "byId", record, summary: summarize(record) });
    // fall through to DocNumber if the value they passed wasn't an internal Id
  }

  const dn = docNumber || id;
  if (dn) {
    try {
      const rows = await qboQueryAll(token, entity.qboReadName, `DocNumber = '${dn.replace(/'/g, "\\'")}'`);
      if (rows.length) return ok({ mode: "byDocNumber", matched: rows.length, record: rows[0], summary: summarize(rows[0]) });
    } catch { /* ignore, fall to the not-found message */ }
  }

  return bad(`No ${entity.qboReadName} matched id/DocNumber "${id || docNumber}". Run ?entity=${entityId}&list=1 to see records with their real Ids.`, 404);
}
