/**
 * POST /api/batch/upload/preview
 * Multipart body: file (xlsx/csv) + entity (id).
 *
 * Parses the file, auto-maps its headers to the entity's template columns,
 * and returns everything the mapping/preview UI needs. No QBO calls here.
 */

import { db } from "@/db";
import { organisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";
import { getEntity } from "@/lib/batch/entities";
import { getXeroEntity } from "@/lib/batch/xero/registry";
import { detectProvider } from "@/lib/batch/provider";
import { parseWorkbook, autoMap, normalizeRows, groupDocs } from "@/lib/batch/engine";
import { normalizeDateColumns, dateFileHeaders, orgDateOrder } from "@/lib/batch/dates";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const ct = req.headers.get("content-type") || "";
  let entityId = "";
  let fileName = "upload";
  let parsed: { headers: string[]; rows: any[] };

  if (ct.includes("application/json")) {
    // Preferred path: the browser parsed the workbook and sends rows as JSON,
    // sidestepping the serverless multipart body-size limit that returns a
    // plaintext 413 ("Request Entity Too Large") for larger uploads.
    const body = await req.json().catch(() => null);
    if (!body) return bad("Invalid request body");
    entityId = String(body.entity || "");
    fileName = String(body.fileName || "upload");
    parsed = {
      headers: Array.isArray(body.headers) ? body.headers.map((h: any) => String(h ?? "").trim()) : [],
      rows: Array.isArray(body.rows) ? body.rows : [],
    };
    if (parsed.rows.length > 50000) return bad("Too many rows — split the file into batches of 50,000 rows or fewer.");
  } else {
    const form = await req.formData().catch(() => null);
    if (!form) return bad("Expected multipart form data");
    entityId = String(form.get("entity") || "");
    const file = form.get("file");
    if (!(file instanceof File)) return bad("No file uploaded");
    if (file.size > 10 * 1024 * 1024) return bad("File exceeds 10 MB");
    fileName = file.name;
    parsed = parseWorkbook(Buffer.from(await file.arrayBuffer()));
  }

  const provider = await detectProvider(orgId!);
  const entity: any = provider === "xero" ? getXeroEntity(entityId) : getEntity(entityId);
  if (!entity) return bad("Unknown entity", 404);
  if (!entity.supports.upload) return bad(entity.note || "This entity does not support upload");

  if (parsed.headers.length === 0) return bad("The file has no header row");
  if (parsed.rows.length === 0) return bad("The file has no data rows");

  const mapping = autoMap(parsed.headers, entity);

  // Normalise date columns to canonical YYYY-MM-DD up front, using the org's
  // date-format preference to resolve ambiguous text dates. Mutates parsed.rows
  // so the preview, the mapping edits, and the rawRows echoed to the client all
  // carry clean dates — the Excel serial/value wins over the rendered text.
  const [org] = await db.select({ dateFormat: organisations.dateFormat }).from(organisations).where(eq(organisations.id, orgId!)).limit(1);
  normalizeDateColumns(parsed.rows, dateFileHeaders(entity, mapping), orgDateOrder(org?.dateFormat));

  const normalized = normalizeRows(parsed.rows, mapping);
  const docs = groupDocs(normalized, entity);

  // Sample: first 20 documents' first rows, using canonical columns.
  const previewRows = docs.slice(0, 20).map((d) => d.rows[0]);

  const unmapped = entity.columns.filter((c) => !mapping[c.trim()]);

  return ok({
    entity: { id: entity.id, label: entity.label, columns: entity.columns, docKey: entity.docKey ?? null },
    fileName,
    fileHeaders: parsed.headers,
    mapping,                    // { canonicalColumn: fileHeader }
    unmappedColumns: unmapped,
    totalRows: parsed.rows.length,
    documentCount: docs.length,
    previewRows,
    // Echo raw rows back so commit is stateless and mapping edits re-normalize
    // client-side without re-uploading the file.
    rawRows: parsed.rows,
  });
}
