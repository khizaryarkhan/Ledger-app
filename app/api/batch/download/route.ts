/**
 * POST /api/batch/download
 * JSON body: { entity, dateType?, from?, to?, format? }
 *
 * Queries QuickBooks for the entity (optionally date-filtered) and returns an
 * xlsx (or csv) file in the entity's template layout, with Id + SyncToken
 * columns so the file can be edited and re-imported via Modify.
 *
 * The xlsx carries the SAME dropdowns as the blank template
 * (lib/batch/dropdowns). It previously didn't — validations were built only in
 * the template route — which had it exactly backwards: this is the file people
 * edit to reclassify transactions in bulk, so it's the file that most needs
 * every account/customer/class pick to be a valid one. CSV can't carry
 * validations at all, which is a reason to prefer xlsx for round trips.
 */

import * as XLSX from "xlsx";
import { requireOrg, bad } from "@/lib/api";
import { getEntity } from "@/lib/batch/entities";
import { getOrgQboToken } from "@/lib/qbo-token";
import { qboQueryAll } from "@/lib/batch/qbo-client";
import { downloadColumns, recordToRow } from "@/lib/batch/downloader";
import { RefResolver } from "@/lib/batch/ref-resolver";
import { buildDropdownPlan, applyDropdowns, entityDropdownKinds } from "@/lib/batch/dropdowns";
import type { BatchEntity } from "@/lib/batch/types";
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

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function fileHeaders(filename: string, format: "xlsx" | "csv", count: number) {
  return {
    "Content-Type": format === "csv" ? "text/csv" : XLSX_MIME,
    "Content-Disposition": `attachment; filename="${filename}-export.${format}"`,
    "X-Row-Count": String(count),
  };
}

const toAoa = (columns: string[], rows: Record<string, any>[]) =>
  [columns, ...rows.map((row) => columns.map((c) => row[c] ?? row[c.trim()] ?? ""))];

/** CSV has no concept of data validation, so this stays on the light path. */
function csvResponse(columns: string[], rows: Record<string, any>[], filename: string, count: number) {
  const ws = XLSX.utils.aoa_to_sheet(toAoa(columns, rows));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, filename.slice(0, 31));
  const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "csv" });
  return new Response(new Uint8Array(buf), { headers: fileHeaders(filename, "csv", count) });
}

/**
 * xlsx via exceljs so the export can carry dropdowns. `entity` and `resolver`
 * are optional: without them (Xero, or QBO unreachable) the file is still
 * produced, just with enum-only or no validations — an export must never fail
 * because a dropdown couldn't be built.
 */
async function xlsxResponse(
  columns: string[],
  rows: Record<string, any>[],
  filename: string,
  count: number,
  entity?: BatchEntity,
  resolver?: RefResolver | null,
) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(filename.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });

  const header = ws.addRow(columns);
  header.eachCell((c: any) => {
    c.font = { bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F0F0" } };
  });
  for (const row of rows) ws.addRow(columns.map((c) => row[c] ?? row[c.trim()] ?? ""));
  ws.columns.forEach((col: any) => { col.width = 22; });

  if (entity) {
    try {
      const plan = await buildDropdownPlan(columns, entity, resolver ?? null);
      // Validate the rows present plus headroom, so pasting a few extra rows
      // still picks up the dropdown without inflating the file to 5000 rows.
      applyDropdowns(wb, ws, columns, plan, rows.length + 100);
    } catch {
      // Dropdowns are an aid, not the payload. Never lose an export over one.
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, { headers: fileHeaders(filename, "xlsx", count) });
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
    return format === "csv"
      ? csvResponse(xe.columns, rows, xe.id, records.length)
      : xlsxResponse(xe.columns, rows, xe.id, records.length);
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
  // One preload covering both jobs: turning ids back into names in the rows,
  // and populating the dropdown lists.
  const needed = format === "csv"
    ? (entity.reverseRefs || [])
    : entityDropdownKinds(entity);
  if (needed.length) await resolver.preload(needed);

  const columns = downloadColumns(entity).map((c) => c.trim());
  const rows: Record<string, any>[] = [];
  let skipped = 0;
  for (const r of records) {
    // One malformed/edge-case record must not take down the whole download —
    // a single throw here used to fail the entire export for every record,
    // with the entity's Update flow left looking totally broken over one bad
    // row. Fall back to a flat mapping for that record so it still appears
    // (worst case with fewer columns filled) rather than vanishing silently.
    try {
      const mapped = entity.toRows ? await entity.toRows(r, resolver) : [recordToRow(entity, r)];
      rows.push(...mapped);
    } catch (e: any) {
      skipped++;
      console.error(`[batch download] toRows failed for ${entity.id} ${r?.Id ?? "?"}:`, e?.message || e);
      try { rows.push(recordToRow(entity, r)); } catch { /* even the flat fallback failed — genuinely skip this one */ }
    }
  }
  if (skipped > 0) console.error(`[batch download] ${entity.id}: ${skipped}/${records.length} records used the fallback row shape`);
  return format === "csv"
    ? csvResponse(columns, rows, entity.id, records.length)
    : xlsxResponse(columns, rows, entity.id, records.length, entity, resolver);
}
