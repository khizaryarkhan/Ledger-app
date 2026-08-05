/**
 * POST /api/batch/download
 * JSON body: { entity, dateType?, from?, to?, format? }
 *
 * Queries QuickBooks for the entity (optionally date-filtered) and returns an
 * xlsx (or csv) file in the entity's template layout, with Id + SyncToken
 * columns so the file can be edited and re-imported via Modify.
 */

import * as XLSX from "xlsx";
import { requireOrg, bad } from "@/lib/api";
import { getEntity } from "@/lib/batch/entities";
import { getOrgQboToken } from "@/lib/qbo-token";
import { qboQueryAll } from "@/lib/batch/qbo-client";
import { downloadColumns, recordToRow } from "@/lib/batch/downloader";
import { RefResolver } from "@/lib/batch/ref-resolver";
import { detectProvider } from "@/lib/batch/provider";
import { getXeroEntity } from "@/lib/batch/xero/registry";
import { getOrgXeroToken } from "@/lib/xero-token";
import { xeroQueryAll } from "@/lib/batch/xero/client";

export const runtime = "nodejs";
export const maxDuration = 120;

const DATE_FIELD: Record<string, string> = {
  transaction: "TxnDate",
  created: "MetaData.CreateTime",
  updated: "MetaData.LastUpdatedTime",
};

function xlsxResponse(columns: string[], rows: Record<string, any>[], filename: string, format: "xlsx" | "csv", count: number) {
  const aoa = [columns, ...rows.map((row) => columns.map((c) => row[c] ?? row[c.trim()] ?? ""))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, filename.slice(0, 31));
  const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: format });
  const mime = format === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": mime, "Content-Disposition": `attachment; filename="${filename}-export.${format}"`, "X-Row-Count": String(count) },
  });
}

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const body = await req.json().catch(() => null);
  if (!body) return bad("Invalid JSON body");
  const format = body.format === "csv" ? "csv" : "xlsx";

  // ── Xero path ──────────────────────────────────────────────────────────────
  if ((await detectProvider(orgId!)) === "xero") {
    const xe = getXeroEntity(String(body.entity || ""));
    if (!xe) return bad("Unknown entity", 404);
    if (!xe.supports.download) return bad("This entity does not support export");
    const xtoken = await getOrgXeroToken(orgId!).catch(() => null);
    if (!xtoken) return bad("Xero is not connected for this organisation", 400);

    const parts: string[] = [];
    if (xe.where) parts.push(xe.where);
    if (xe.dateField && body.from) parts.push(`${xe.dateField} >= DateTime(${body.from.replaceAll("-", ",")})`);
    if (xe.dateField && body.to) parts.push(`${xe.dateField} <= DateTime(${body.to.replaceAll("-", ",")})`);
    const where = parts.join(" && ");

    let records: any[];
    try { records = await xeroQueryAll(xtoken, xe.xeroEntity, where || undefined); }
    catch (e: any) { return bad(e?.message || "Xero query failed", 502); }

    const rows = records.flatMap((r) => xe.toRows(r));
    return xlsxResponse(xe.columns, rows, xe.id, format, records.length);
  }

  const entity = getEntity(String(body.entity || ""));
  if (!entity) return bad("Unknown entity", 404);
  if (!entity.supports.download || !entity.qboReadName) {
    return bad(entity.note || "This entity does not support download");
  }

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected for this organisation", 400);

  // Build an optional date-range WHERE clause.
  const clauses: string[] = [];
  if (entity.qboExtraWhere) clauses.push(entity.qboExtraWhere);
  const field = DATE_FIELD[body.dateType as string] || "TxnDate";
  const isMeta = field.startsWith("MetaData");
  const fmt = (d: string) => (isMeta ? new Date(d).toISOString() : d);
  if (entity.dateColumn && body.from) clauses.push(`${field} >= '${fmt(body.from)}'`);
  if (entity.dateColumn && body.to) clauses.push(`${field} <= '${fmt(body.to)}'`);
  const where = clauses.join(" AND ");

  let records: any[];
  try {
    records = await qboQueryAll(token, entity.qboReadName, where);
  } catch (e: any) {
    return bad(e?.message || "QBO query failed", 502);
  }

  const resolver = new RefResolver(token);
  if (entity.reverseRefs?.length) await resolver.preload(entity.reverseRefs);

  const columns = downloadColumns(entity);
  const rows: Record<string, any>[] = [];
  for (const r of records) {
    const mapped = entity.toRows ? await entity.toRows(r, resolver) : [recordToRow(entity, r)];
    rows.push(...mapped);
  }
  return xlsxResponse(columns.map((c) => c.trim()), rows, entity.id, format, records.length);
}
