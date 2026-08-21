/**
 * Excel date handling for imports.
 *
 * Excel does NOT store the text you see — a date cell holds a serial number
 * (days since 1899-12-30); the format is display-only. So the reliable value is
 * the serial (or the Date SheetJS derived from it), never the rendered string.
 *
 * Text dates (cells the user typed as plain text) are genuinely ambiguous —
 * 03/04/2024 could be 3 Apr or 4 Mar. We resolve the order per COLUMN: if any
 * value in the column has a part > 12 it proves the order (e.g. 15/03 → D/M);
 * otherwise we fall back to the organisation's date-format preference.
 *
 * Everything normalises to canonical YYYY-MM-DD.
 */

export type DateOrder = "DMY" | "MDY";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Excel serial → YYYY-MM-DD using pure integer date math (no JS Date, no
 * timezone). Serial 0 = 1899-12-30; 25569 = 1970-01-01. Uses Howard Hinnant's
 * days→civil algorithm so the calendar day is bit-exact regardless of runtime.
 */
export function excelSerialToISO(n: number): string | null {
  if (!isFinite(n) || n <= 0) return null;
  let z = Math.round(n) - 25569 + 719468;          // days since 0000-03-01 shifted epoch
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  const doe = z - era * 146097;                     // [0, 146096]
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153);       // [0, 11]
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1; // [1, 31]
  const m = mp < 10 ? mp + 3 : mp - 9;              // [1, 12]
  const year = m <= 2 ? y + 1 : y;
  if (year < 1900 || year > 3000) return null;
  return `${year}-${pad(m)}-${pad(d)}`;
}

/** The org's preferred order, from organisations.date_format (e.g. "MM/DD/YYYY"). */
export function orgDateOrder(dateFormat?: string | null): DateOrder {
  return (dateFormat || "").trim().toUpperCase().startsWith("M") ? "MDY" : "DMY";
}

/** Coerce a single cell to YYYY-MM-DD; leaves non-dates untouched. */
export function normalizeDateValue(v: any, order: DateOrder): any {
  if (v == null || v === "") return v;
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  if (typeof v === "number") return excelSerialToISO(v) ?? v;

  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${pad(+iso[2])}-${pad(+iso[3])}`;

  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3];
    if (y < 100) y += y < 70 ? 2000 : 1900;
    let day: number, mon: number;
    if (a > 12 && b <= 12)      { day = a; mon = b; }   // unambiguous
    else if (b > 12 && a <= 12) { mon = a; day = b; }   // unambiguous
    else if (order === "DMY")   { day = a; mon = b; }
    else                        { mon = a; day = b; }
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) return `${y}-${pad(mon)}-${pad(day)}`;
  }
  return v; // unknown shape — don't corrupt it
}

/** Detect a text column's order from unambiguous values; else the fallback. */
export function detectOrder(values: any[], fallback: DateOrder): DateOrder {
  let dmy = 0, mdy = 0;
  for (const v of values) {
    if (typeof v !== "string") continue;
    const m = v.trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.]\d{2,4}$/);
    if (!m) continue;
    const a = +m[1], b = +m[2];
    if (a > 12 && b <= 12) dmy++;
    else if (b > 12 && a <= 12) mdy++;
  }
  if (dmy > 0 && mdy === 0) return "DMY";
  if (mdy > 0 && dmy === 0) return "MDY";
  return fallback;
}

/** In-place normalise the given (file-header) date columns across all rows. */
export function normalizeDateColumns(rows: Record<string, any>[], dateHeaders: string[], fallback: DateOrder) {
  for (const h of dateHeaders) {
    if (!h) continue;
    const order = detectOrder(rows.map(r => r?.[h]), fallback);
    for (const r of rows) if (r && h in r) r[h] = normalizeDateValue(r[h], order);
  }
}

/** File headers that map to an entity's date-ish columns (Invoice Date, Due Date, …). */
export function dateFileHeaders(entity: { columns: string[] }, mapping: Record<string, string>): string[] {
  const out = new Set<string>();
  for (const col of entity.columns) {
    if (!/date|expir/i.test(col)) continue;
    const h = mapping[col.trim()] ?? mapping[col];
    if (h) out.add(h);
  }
  return [...out];
}
