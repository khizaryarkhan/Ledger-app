/**
 * POST /api/batch/convert/estimates/search
 * JSON body: { dateType?, from?, to?, status? }
 *
 * Lists estimates for the convert-to-invoice picker, flagging which are already
 * (partly) invoiced so the user can choose.
 */

import { requireOrg, ok, bad } from "@/lib/api";
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

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected for this organisation", 400);

  const clauses: string[] = [];
  const field = DATE_FIELD[body.dateType as string] || "TxnDate";
  const isMeta = field.startsWith("MetaData");
  const fmt = (d: string) => (isMeta ? new Date(d).toISOString() : d);
  if (body.from) clauses.push(`${field} >= '${fmt(body.from)}'`);
  if (body.to) clauses.push(`${field} <= '${fmt(body.to)}'`);
  if (body.status) clauses.push(`TxnStatus = '${String(body.status).replace(/'/g, "\\'")}'`);
  const where = clauses.join(" AND ");

  let records: any[];
  try {
    records = await qboQueryAll(token, "Estimate", where);
  } catch (e: any) {
    return bad(e?.message || "QBO query failed", 502);
  }

  const rows = records.map((r) => {
    const invoiced = (r.LinkedTxn || []).some((t: any) => t.TxnType === "Invoice");
    return {
      id: r.Id,
      docNumber: r.DocNumber ?? "—",
      customer: r.CustomerRef?.name ?? "",
      date: r.TxnDate ?? "",
      total: r.TotalAmt ?? null,
      status: r.TxnStatus ?? "Pending",
      invoiced,
    };
  });

  return ok({ count: rows.length, rows });
}
