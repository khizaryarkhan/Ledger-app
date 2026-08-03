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

/** Parse an uploaded xlsx/csv buffer into headers + rows (first sheet). */
export function parseWorkbook(buffer: Buffer): ParsedFile {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
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
export function autoMap(fileHeaders: string[], entity: BatchEntity): Record<string, string> {
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
 * Group normalized rows into logical documents.
 * Line-item entities group consecutive rows sharing the same docKey value;
 * flat entities (lists, single-line txns) treat every row as its own document.
 */
export function groupDocs(rows: SheetRow[], entity: BatchEntity): GroupedDoc[] {
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
export function countDocs(rows: SheetRow[], entity: BatchEntity): number {
  return groupDocs(rows, entity).length;
}
