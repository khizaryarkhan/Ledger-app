/**
 * POST /api/batch/delete/search
 * JSON body: { entity, dateType?, from?, to?, refNumber? }
 *
 * Returns matching QBO records for the delete preview — id + syncToken so the
 * follow-up commit can delete without re-reading each record.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { getEntity } from "@/lib/batch/entities";
import { getOrgQboToken } from "@/lib/qbo-token";
import { qboQueryAll } from "@/lib/batch/qbo-client";
import { detectProvider } from "@/lib/batch/provider";
import { getXeroEntity } from "@/lib/batch/xero/registry";
import { getOrgXeroToken } from "@/lib/xero-token";
import { xeroQueryAll, xeroDate } from "@/lib/batch/xero/client";

export const runtime = "nodejs";
export const maxDuration = 120;

const DATE_FIELD: Record<string, string> = {
  transaction: "TxnDate",
  created: "MetaData.CreateTime",
  updated: "MetaData.LastUpdatedTime",
};

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const body = await req.json().catch(() => null);
  if (!body) return bad("Invalid JSON body");

  // ── Xero path ──
  if ((await detectProvider(orgId!)) === "xero") {
    const xe = getXeroEntity(String(body.entity || ""));
    if (!xe || !xe.supports.delete) return bad("This entity can't be deleted");
    const xtoken = await getOrgXeroToken(orgId!).catch(() => null);
    if (!xtoken) return bad("Xero is not connected for this organisation", 400);
    const parts: string[] = [];
    if (xe.where) parts.push(xe.where);
    if (xe.dateField && body.from) parts.push(`${xe.dateField} >= DateTime(${String(body.from).replaceAll("-", ",")})`);
    if (xe.dateField && body.to) parts.push(`${xe.dateField} <= DateTime(${String(body.to).replaceAll("-", ",")})`);
    let records: any[];
    try { records = await xeroQueryAll(xtoken, xe.xeroEntity, parts.join(" && ") || undefined); }
    catch (e: any) { return bad(e?.message || "Xero query failed", 502); }
    const rows = records.map((r) => ({
      id: r[xe.xeroIdKey || "ID"],
      syncToken: "",
      docNumber: r.InvoiceNumber ?? r.CreditNoteNumber ?? r.QuoteNumber ?? r.Code ?? r.Name ?? "—",
      date: xeroDate(r.Date) ?? "",
      name: r.Contact?.Name ?? "",
      amount: r.Total ?? null,
    }));
    return ok({ count: rows.length, rows });
  }

  const entity = getEntity(String(body.entity || ""));
  if (!entity) return bad("Unknown entity", 404);
  if (!entity.supports.delete || !entity.qboReadName || !entity.qboEntity) {
    return bad(entity.note || "This entity does not support delete");
  }

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected for this organisation", 400);

  const clauses: string[] = [];
  if (entity.qboExtraWhere) clauses.push(entity.qboExtraWhere);
  const field = DATE_FIELD[body.dateType as string] || "TxnDate";
  const isMeta = field.startsWith("MetaData");
  // For created/updated (a timestamp), make the day range INCLUSIVE: from the
  // start of the "from" day to the very end of the "to" day. Otherwise a
  // same-day search (from=to=27 Aug) compared 20:02 records against 00:00:00
  // and returned nothing — which is exactly what hid the records to recover.
  const fmtFrom = (d: string) => (isMeta ? new Date(`${d}T00:00:00.000Z`).toISOString() : d);
  const fmtTo = (d: string) => (isMeta ? new Date(`${d}T23:59:59.999Z`).toISOString() : d);
  if (entity.dateColumn && body.from) clauses.push(`${field} >= '${fmtFrom(body.from)}'`);
  if (entity.dateColumn && body.to) clauses.push(`${field} <= '${fmtTo(body.to)}'`);
  if (body.refNumber && entity.qboRefNumberField) {
    clauses.push(`${entity.qboRefNumberField} = '${String(body.refNumber).replace(/'/g, "\\'")}'`);
  }
  const where = clauses.join(" AND ");

  let records: any[];
  try {
    records = await qboQueryAll(token, entity.qboReadName, where);
    if (entity.qboClientFilter) records = records.filter(entity.qboClientFilter);
  } catch (e: any) {
    return bad(e?.message || "QBO query failed", 502);
  }

  const rows = records.map((r) => ({
    id: r.Id,
    syncToken: r.SyncToken,
    docNumber: r.DocNumber ?? r.PaymentRefNum ?? r.DisplayName ?? r.Name ?? "—",
    date: r.TxnDate ?? r.MetaData?.CreateTime?.slice(0, 10) ?? "",
    // Full QuickBooks creation timestamp — lets the user pinpoint the exact
    // batch a failed/timed-out import created (e.g. everything at 20:02).
    createTime: r.MetaData?.CreateTime ?? null,
    name: r.CustomerRef?.name ?? r.VendorRef?.name ?? r.EntityRef?.name ?? "",
    amount: r.TotalAmt ?? null,
  }));

  return ok({ count: rows.length, rows });
}
