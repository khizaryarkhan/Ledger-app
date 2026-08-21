/**
 * Batch engine — file parsing, column auto-mapping, and row grouping.
 *
 * All header keys are trimmed on parse so the builders can rely on canonical
 * (whitespace-free) column names regardless of how the uploaded file was saved.
 */

import * as XLSX from "xlsx";
import type { BatchEntity, SheetRow, GroupedDoc } from "./types";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const canon = (s: string) => s.trim();

export interface ParsedFile {
  headers: string[];       // trimmed file headers, in order
  rows: SheetRow[];        // rows keyed by trimmed file header
}

/**
 * Parse an uploaded xlsx/csv into headers + rows (first sheet). Isomorphic:
 * accepts a Node Buffer (server) or an ArrayBuffer/Uint8Array (browser), so the
 * client can parse the file locally and POST rows as JSON — avoiding the
 * platform's ~4.5 MB multipart request-body limit on serverless functions.
 */
export function parseWorkbook(data: Buffer | ArrayBuffer | Uint8Array): ParsedFile {
  let readArg: any = data;
  let type: "buffer" | "array" = "buffer";
  if (data instanceof ArrayBuffer) { readArg = new Uint8Array(data); type = "array"; }
  else if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) { type = "buffer"; }
  else if (data instanceof Uint8Array) { type = "array"; }
  const wb = XLSX.read(readArg, { type, cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) return { headers: [], rows: [] };

  const matrix: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, raw: true });
  if (matrix.length === 0) return { headers: [], rows: [] };

  const headers = (matrix[0] as any[]).map((h) => canon(String(h ?? "")));
  const rows: SheetRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const arr = matrix[i] as any[];
    if (!arr || arr.every((c) => c == null || c === "")) continue;
    const row: SheetRow = {};
    headers.forEach((h, idx) => {
      if (h) row[h] = arr[idx];
    });
    rows.push(row);
  }
  return { headers, rows };
}

/**
 * Auto-map file headers to an entity's template columns.
 * Returns { [canonicalEntityColumn]: fileHeader } for confident matches.
 */
export function autoMap(fileHeaders: string[], entity: { columns: string[] }): Record<string, string> {
  const byNorm = new Map(fileHeaders.map((h) => [norm(h), h]));
  const mapping: Record<string, string> = {};
  for (const col of entity.columns) {
    const c = canon(col);
    const hit = byNorm.get(norm(c));
    if (hit) mapping[c] = hit;
  }
  return mapping;
}

/**
 * Re-key raw file rows into canonical entity-column rows using the mapping.
 * mapping: { canonicalEntityColumn: fileHeader }
 */
export function normalizeRows(rows: SheetRow[], mapping: Record<string, string>): SheetRow[] {
  const pairs = Object.entries(mapping);
  return rows.map((raw) => {
    const out: SheetRow = {};
    for (const [entityCol, fileHeader] of pairs) {
      out[entityCol] = raw[fileHeader];
    }
    return out;
  });
}

/**
 * Update operations need the record's identity columns (Id / SyncToken). Those
 * are added to the "download to edit" export by the row-mappers, but they are
 * NOT part of an entity's data columns, so the auto-mapping drops them — which
 * left every update failing with "Update needs an 'Id' column". Merge them back
 * into the mapping (matching common header spellings) so normalizeRows keeps
 * them. Only call this for modify — a create must never carry an Id.
 */
export function ensureIdentityMapping(
  mapping: Record<string, string>,
  sampleRow: SheetRow,
): Record<string, string> {
  const identity: Record<string, RegExp> = {
    Id: /^(id|qbo id)$/i,
    SyncToken: /^(sync ?token)$/i,
  };
  const out = { ...mapping };
  const headers = Object.keys(sampleRow || {});
  for (const [target, re] of Object.entries(identity)) {
    if (out[target]) continue; // already mapped
    const hit = headers.find((h) => re.test(String(h).trim()));
    if (hit) out[target] = hit;
  }
  return out;
}

/**
 * Group normalized rows into logical documents.
 * Line-item entities group consecutive rows sharing the same docKey value;
 * flat entities (lists, single-line txns) treat every row as its own document.
 */
export function groupDocs(rows: SheetRow[], entity: { docKey?: string }): GroupedDoc[] {
  const key = entity.docKey ? canon(entity.docKey) : null;
  if (!key) {
    return rows.map((r, i) => ({ key: String(i), rows: [r] }));
  }

  const docs: GroupedDoc[] = [];
  const byKey = new Map<string, GroupedDoc>();
  let blankCounter = 0;

  for (const row of rows) {
    const raw = row[key];
    const k = raw == null || String(raw).trim() === "" ? `__blank_${blankCounter++}` : String(raw).trim();
    let doc = byKey.get(k);
    if (!doc) {
      doc = { key: k, rows: [] };
      byKey.set(k, doc);
      docs.push(doc);
    }
    doc.rows.push(row);
  }
  return docs;
}

/** Count how many logical documents a set of normalized rows represents. */
export function countDocs(rows: SheetRow[], entity: { docKey?: string }): number {
  return groupDocs(rows, entity).length;
}
