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
  const fmt = (d: string) => (isMeta ? new Date(d).toISOString() : d);
  if (entity.dateColumn && body.from) clauses.push(`${field} >= '${fmt(body.from)}'`);
  if (entity.dateColumn && body.to) clauses.push(`${field} <= '${fmt(body.to)}'`);
  if (body.refNumber && entity.qboRefNumberField) {
    clauses.push(`${entity.qboRefNumberField} = '${String(body.refNumber).replace(/'/g, "\\'")}'`);
  }
  const where = clauses.join(" AND ");

  let records: any[];
  try {
    records = await qboQueryAll(token, entity.qboReadName, where);
  } catch (e: any) {
    return bad(e?.message || "QBO query failed", 502);
  }

  const rows = records.map((r) => ({
    id: r.Id,
    syncToken: r.SyncToken,
    docNumber: r.DocNumber ?? r.PaymentRefNum ?? r.DisplayName ?? r.Name ?? "—",
    date: r.TxnDate ?? r.MetaData?.CreateTime?.slice(0, 10) ?? "",
    name: r.CustomerRef?.name ?? r.VendorRef?.name ?? r.EntityRef?.name ?? "",
    amount: r.TotalAmt ?? null,
  }));

  return ok({ count: rows.length, rows });
}
