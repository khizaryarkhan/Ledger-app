/**
 * POST /api/batch/upload/preview
 * Multipart body: file (xlsx/csv) + entity (id).
 *
 * Parses the file, auto-maps its headers to the entity's template columns,
 * and returns everything the mapping/preview UI needs. No QBO calls here.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { getEntity } from "@/lib/batch/entities";
import { parseWorkbook, autoMap, normalizeRows, groupDocs } from "@/lib/batch/engine";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { error } = await requireOrg();
  if (error) return error;

  const form = await req.formData().catch(() => null);
  if (!form) return bad("Expected multipart form data");

  const entityId = String(form.get("entity") || "");
  const entity = getEntity(entityId);
  if (!entity) return bad("Unknown entity", 404);
  if (!entity.supports.upload) return bad(entity.note || "This entity does not support upload");

  const file = form.get("file");
  if (!(file instanceof File)) return bad("No file uploaded");
  if (file.size > 10 * 1024 * 1024) return bad("File exceeds 10 MB");

  const buf = Buffer.from(await file.arrayBuffer());
  const parsed = parseWorkbook(buf);
  if (parsed.headers.length === 0) return bad("The file has no header row");
  if (parsed.rows.length === 0) return bad("The file has no data rows");

  const mapping = autoMap(parsed.headers, entity);
  const normalized = normalizeRows(parsed.rows, mapping);
  const docs = groupDocs(normalized, entity);

  // Sample: first 20 documents' first rows, using canonical columns.
  const previewRows = docs.slice(0, 20).map((d) => d.rows[0]);

  const unmapped = entity.columns.filter((c) => !mapping[c.trim()]);

  return ok({
    entity: { id: entity.id, label: entity.label, columns: entity.columns, docKey: entity.docKey ?? null },
    fileName: file.name,
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
