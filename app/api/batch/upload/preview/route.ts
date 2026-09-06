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
  let blobUrl: string | null = null;

  if (ct.includes("application/json")) {
    // Preferred path: the browser parsed the workbook and sends rows as JSON,
    // sidestepping the serverless multipart body-size limit that returns a
    // plaintext 413 ("Request Entity Too Large") for larger uploads.
    const body = await req.json().catch(() => null);
    if (!body) return bad("Invalid request body");
    entityId = String(body.entity || "");
    fileName = String(body.fileName || "upload");

    if (body.blobUrl) {
      // Large-file path: handleFile() uploaded the parsed { headers, rows }
      // JSON straight to Vercel Blob (bypassing this function's own 4.5 MB
      // request-body ceiling) and handed us just the URL. Fetch it
      // server-side — an outbound fetch isn't subject to that inbound limit.
      blobUrl = String(body.blobUrl);
      const fileRes = await fetch(blobUrl).catch(() => null);
      if (!fileRes || !fileRes.ok) return bad("Could not read the uploaded file — try again.", 502);
      const fileJson = await fileRes.json().catch(() => null);
      if (!fileJson) return bad("The uploaded file was unreadable — try again.", 502);
      parsed = {
        headers: Array.isArray(fileJson.headers) ? fileJson.headers.map((h: any) => String(h ?? "").trim()) : [],
        rows: Array.isArray(fileJson.rows) ? fileJson.rows : [],
      };
    } else {
      parsed = {
        headers: Array.isArray(body.headers) ? body.headers.map((h: any) => String(h ?? "").trim()) : [],
        rows: Array.isArray(body.rows) ? body.rows : [],
      };
    }
    if (parsed.rows.length > 100000) return bad("Too many rows — split the file into batches of 100,000 rows or fewer.");
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

  // For the blob path, echo a blob URL instead of inlining rawRows — the
  // response body has the SAME 4.5 MB ceiling as the request, so a large
  // file would just move the 413 from the way in to the way out. Re-upload
  // (server-side put(), not the client SDK) rather than echo the ORIGINAL
  // blobUrl unchanged: normalizeDateColumns above mutated parsed.rows in
  // place, and the original blob still holds the pre-normalization dates —
  // echoing it back unchanged would silently undo that fix the moment
  // /api/batch/upload/start re-fetches it.
  let rawRowsBlobUrl: string | undefined;
  if (blobUrl) {
    const { put } = await import("@vercel/blob");
    const reuploaded = await put(
      `batch-uploads/${orgId}-${Date.now()}-normalized.json`,
      JSON.stringify({ headers: parsed.headers, rows: parsed.rows }),
      { access: "public", addRandomSuffix: true, contentType: "application/json" },
    );
    rawRowsBlobUrl = reuploaded.url;
  }

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
    // client-side without re-uploading the file. Large files get a blob URL
    // instead (see rawRowsBlobUrl above) — never both, to keep the response
    // itself under the same 4.5 MB ceiling the request already had to dodge.
    rawRows: blobUrl ? undefined : parsed.rows,
    rawRowsBlobUrl,
  });
}
