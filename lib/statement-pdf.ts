/**
 * Statement of Account — professional PDF.
 *
 * Runs client-side (pdf-lib, already a dependency). Produces a clean,
 * printable statement grouped Customer → Project with per-level subtotals
 * and a grand total. Company name sits in the masthead; the run timestamp
 * (date + time) is stamped in the masthead and repeated in the page footer.
 * Multi-currency safe — subtotals render per currency.
 *
 * Design: Swiss-minimalist — whitespace, hairline rules (no heavy filled
 * blocks), black used only for lines/borders/totals, and a small monogram
 * for identity. Aims to read "considered", not "template".
 */

import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "pdf-lib";

export type StatementRow = {
  inv: any;
  custName: string;
  projName: string | null;
  bal: number;
  days: number;
};

// ── Page geometry (A4 portrait, points) ──────────────────────────────────────
const PAGE_W = 595.28, PAGE_H = 841.89;
const M = 48;
const CONTENT_W = PAGE_W - M * 2;
const RIGHT = PAGE_W - M;
const BOTTOM = 70;

// ── Palette — warm neutrals; black accent for lines/borders/totals only ──────
const INK    = rgb(0.13, 0.12, 0.11);
const MUTED  = rgb(0.48, 0.45, 0.42);
const FAINT  = rgb(0.64, 0.61, 0.58);
const HAIR   = rgb(0.87, 0.85, 0.83);
const BAND   = rgb(0.972, 0.968, 0.962);
const ACCENT = rgb(0.06, 0.06, 0.06);     // black — used only for lines, borders, totals
const WHITE  = rgb(1, 1, 1);
const RED    = rgb(0.64, 0.15, 0.15);

// ── Columns (right-aligned numbers align to their x) ──────────────────────────
const COL = {
  label:   M,
  invDate: M + 176,
  dueDate: M + 240,
  overdue: M + 312,       // right
  cur:     M + 322,
  amount:  M + 436,       // right
  out:     RIGHT,         // right
};

const num2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtCcyMap(map: Record<string, number>): string {
  const parts = Object.entries(map).filter(([, v]) => Math.abs(v) > 0.005).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  if (!parts.length) return num2(0);
  return parts.map(([c, v]) => `${c} ${num2(v)}`).join("   ·   ");
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? "";
  if (first.length >= 2 && first.length <= 4 && first === first.toUpperCase()) return first.slice(0, 2);
  return words.slice(0, 2).map(w => (w[0] ?? "").toUpperCase()).join("") || "•";
}

export async function buildStatementPdf({ orgName, rows, logoUrl }: { orgName: string; rows: StatementRow[]; logoUrl?: string | null }): Promise<Uint8Array> {
  const now = new Date();
  const stamp =
    now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
    " · " +
    now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  // Group Customer → Project.
  type Grp = { total: Record<string, number>; rows: StatementRow[] };
  const byCust = new Map<string, { total: Record<string, number>; projects: Map<string, Grp> }>();
  for (const r of rows) {
    const ccy = r.inv.currency || "EUR";
    const cKey = r.custName || "—";
    if (!byCust.has(cKey)) byCust.set(cKey, { total: {}, projects: new Map() });
    const cg = byCust.get(cKey)!;
    cg.total[ccy] = (cg.total[ccy] ?? 0) + r.bal;
    const pKey = r.projName || "No project";
    if (!cg.projects.has(pKey)) cg.projects.set(pKey, { total: {}, rows: [] });
    const pg = cg.projects.get(pKey)!;
    pg.total[ccy] = (pg.total[ccy] ?? 0) + r.bal;
    pg.rows.push(r);
  }
  const sumT = (t: Record<string, number>) => Object.values(t).reduce((s, v) => s + v, 0);
  const customers = [...byCust.entries()].sort((a, b) => sumT(b[1].total) - sumT(a[1].total));
  const grand: Record<string, number> = {};
  rows.forEach(r => { const c = r.inv.currency || "EUR"; grand[c] = (grand[c] ?? 0) + r.bal; });

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mark = monogram(orgName);

  // Embed the org logo if provided and in a raster format pdf-lib supports
  // (PNG/JPEG — SVG isn't supported, so it silently falls back to the
  // monogram). Any fetch/parse failure also falls back — the statement must
  // never fail to generate because of a bad logo.
  let logo: { img: any; w: number; h: number } | null = null;
  if (logoUrl) {
    try {
      const res = await fetch(logoUrl);
      if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer());
        const isPng = buf[0] === 0x89 && buf[1] === 0x50;
        const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
        const img = isPng ? await doc.embedPng(buf) : isJpg ? await doc.embedJpg(buf) : null;
        if (img) {
          const maxH = 36, maxW = 210;
          const scale = Math.min(maxH / img.height, maxW / img.width, 1);
          logo = { img, w: img.width * scale, h: img.height * scale };
        }
      }
    } catch { logo = null; }
  }

  let page!: PDFPage;
  let y = 0;

  const tW = (t: string, size: number, f: PDFFont) => f.widthOfTextAtSize(t, size);
  const clip = (t: string, maxW: number, size: number, f: PDFFont) => {
    if (tW(t, size, f) <= maxW) return t;
    let s = t;
    while (s.length > 1 && tW(s + "…", size, f) > maxW) s = s.slice(0, -1);
    return s + "…";
  };
  const left  = (t: string, x: number, yy: number, size: number, f: PDFFont, color = INK) => page.drawText(t, { x, y: yy, size, font: f, color });
  const right = (t: string, xR: number, yy: number, size: number, f: PDFFont, color = INK) => page.drawText(t, { x: xR - tW(t, size, f), y: yy, size, font: f, color });
  const rule  = (yy: number, x1 = M, x2 = RIGHT, thickness = 0.5, color = HAIR) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness, color });

  function masthead(first: boolean) {
    if (logo) {
      // Uploaded logo — drawn at its aspect ratio; the company name still
      // appears in the footer, so we don't repeat it here as text.
      const h = first ? logo.h : logo.h * 0.72;
      const w = first ? logo.w : logo.w * 0.72;
      const topY = PAGE_H - (first ? 34 : 28);
      page.drawImage(logo.img, { x: M, y: topY - h, width: w, height: h });
      left("STATEMENT OF OPEN INVOICES" + (first ? "" : "  (continued)"), M, topY - h - 11, first ? 8 : 7, font, MUTED);
    } else {
      // Monogram mark + wordmark
      const sz = first ? 32 : 22;
      page.drawRectangle({ x: M, y: PAGE_H - (first ? 66 : 52), width: sz, height: sz, color: ACCENT });
      const mSize = first ? 14 : 10;
      left(mark, M + (sz - tW(mark, mSize, bold)) / 2, PAGE_H - (first ? 66 : 52) + (sz - mSize) / 2 + 1, mSize, bold, WHITE);

      const wx = M + sz + 14;
      const wordMax = RIGHT - wx - (first ? 190 : 150);
      let wSize = first ? 19 : 13;
      while (wSize > 11 && tW(orgName, wSize, bold) > wordMax) wSize -= 0.5;
      left(clip(orgName, wordMax, wSize, bold), wx, PAGE_H - (first ? 50 : 42), wSize, bold, INK);
      left("STATEMENT OF OPEN INVOICES" + (first ? "" : "  (continued)"), wx, PAGE_H - (first ? 64 : 53), first ? 8 : 7, font, MUTED);
    }

    // Right meta
    if (first) {
      right("STATEMENT DATE", RIGHT, PAGE_H - 42, 7, font, FAINT);
      right(stamp, RIGHT, PAGE_H - 55, 9.5, bold, INK);
      right(`${rows.length} invoice${rows.length !== 1 ? "s" : ""}  ·  ${customers.length} customer${customers.length !== 1 ? "s" : ""}`, RIGHT, PAGE_H - 68, 8, font, MUTED);
    }

    // Accent hairline under the masthead
    const ruleY = first ? PAGE_H - 84 : PAGE_H - 66;
    rule(ruleY, M, RIGHT, 1.5, ACCENT);

    if (first) {
      // Focal figure — total outstanding
      right("TOTAL OUTSTANDING", RIGHT, ruleY - 22, 8, font, MUTED);
      right(fmtCcyMap(grand), RIGHT, ruleY - 40, 18, bold, ACCENT);
      left("Outstanding balances", M, ruleY - 26, 9, font, MUTED);
      left("as at the statement date", M, ruleY - 38, 8, font, FAINT);
      y = ruleY - 66;
    } else {
      y = ruleY - 24;
    }
  }

  function columnHeads() {
    left("INVOICE", COL.label, y, 7.5, bold, FAINT);
    left("INV DATE", COL.invDate, y, 7.5, bold, FAINT);
    left("DUE", COL.dueDate, y, 7.5, bold, FAINT);
    right("OVERDUE", COL.overdue, y, 7.5, bold, FAINT);
    left("CUR", COL.cur, y, 7.5, bold, FAINT);
    right("AMOUNT", COL.amount, y, 7.5, bold, FAINT);
    right("OUTSTANDING", COL.out, y, 7.5, bold, FAINT);
    y -= 8;
    rule(y);
    y -= 16;
  }

  function newPage(first = false) {
    page = doc.addPage([PAGE_W, PAGE_H]);
    masthead(first);
    columnHeads();
  }

  function ensure(space: number) { if (y - space < BOTTOM) newPage(false); }

  newPage(true);

  for (const [custName, cg] of customers) {
    ensure(48);
    // Customer section header — light band + accent tick, label only.
    page.drawRectangle({ x: M, y: y - 6, width: CONTENT_W, height: 22, color: BAND });
    page.drawRectangle({ x: M, y: y - 6, width: 3, height: 22, color: ACCENT });
    left(clip(custName, CONTENT_W - 24, 12, bold), M + 12, y, 12, bold, INK);
    y -= 26;

    const projects = [...cg.projects.entries()].sort((a, b) => sumT(b[1].total) - sumT(a[1].total));
    for (const [projName, pg] of projects) {
      const showProj = projName !== "No project" || projects.length > 1;
      if (showProj) {
        ensure(24);
        left(clip(projName, CONTENT_W - 24, 9.5, bold), M + 12, y, 9.5, bold, rgb(0.32, 0.30, 0.28));
        y -= 17;
      }

      const invRows = [...pg.rows].sort((a, b) => String(a.inv.dueDate).localeCompare(String(b.inv.dueDate)));
      for (const r of invRows) {
        ensure(17);
        const inv = r.inv;
        const total = Number(inv.total || 0);
        left(clip(`#${inv.invoiceNumber}`, 140, 9, font), COL.label + 12, y, 9, font, INK);
        left(fmtDate(inv.invoiceDate), COL.invDate, y, 8.5, font, MUTED);
        left(fmtDate(inv.dueDate), COL.dueDate, y, 8.5, font, MUTED);
        right(r.days > 0 ? `${r.days}d` : "—", COL.overdue, y, 8.5, font, r.days > 90 ? RED : MUTED);
        left(inv.currency || "EUR", COL.cur, y, 8, font, FAINT);
        right(num2(total), COL.amount, y, 9, font, MUTED);
        right(num2(r.bal), COL.out, y, 9, bold, INK);
        y -= 16;
      }
      if (showProj) {
        ensure(18);
        rule(y + 9, COL.amount - 44, RIGHT);
        right("Subtotal", COL.amount, y, 8, font, MUTED);
        right(fmtCcyMap(pg.total), COL.out, y, 8.5, bold, INK);
        y -= 18;
      }
    }
    // Customer total
    ensure(22);
    rule(y + 10, M, RIGHT, 0.75, HAIR);
    left(`Total — ${clip(custName, 240, 9.5, bold)}`, M, y, 9.5, bold, INK);
    right(fmtCcyMap(cg.total), COL.out, y, 10.5, bold, ACCENT);
    y -= 30;
  }

  // Grand total — elegant, no heavy fill: double rule + large accent figure.
  ensure(44);
  rule(y + 14, M, RIGHT, 0.5, HAIR);
  rule(y + 11, M, RIGHT, 1.5, ACCENT);
  left("GRAND TOTAL", M, y - 6, 11, bold, INK);
  right(fmtCcyMap(grand), RIGHT, y - 8, 15, bold, ACCENT);

  // Footers on every page. Three slots — left label, centre page number, right
  // timestamp — that must never overlap, so the left label is truncated to the
  // gap before the centred page number (long org names used to collide).
  const pages = doc.getPages();
  const FS = 7.5;
  const truncateToWidth = (s: string, maxW: number) => {
    if (maxW <= 0) return "";
    if (font.widthOfTextAtSize(s, FS) <= maxW) return s;
    let t = s;
    while (t.length > 1 && font.widthOfTextAtSize(t + "…", FS) > maxW) t = t.slice(0, -1);
    return t + "…";
  };
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 50 }, end: { x: RIGHT, y: 50 }, thickness: 0.5, color: HAIR });
    const pg = `Page ${i + 1} of ${pages.length}`;
    const pgW = font.widthOfTextAtSize(pg, FS);
    const pgX = (PAGE_W - pgW) / 2;
    const gen = `Generated ${stamp}`;
    const genX = RIGHT - font.widthOfTextAtSize(gen, FS);
    const GAP = 12;
    const label = truncateToWidth(`${orgName} · Statement of Open Invoices`, pgX - GAP - M);
    p.drawText(label, { x: M, y: 38, size: FS, font, color: FAINT });
    p.drawText(pg,  { x: pgX,  y: 38, size: FS, font, color: FAINT });
    p.drawText(gen, { x: genX, y: 38, size: FS, font, color: FAINT });
  });

  return await doc.save();
}

/** Client-side: build + trigger a download. */
export async function exportStatementPdf({ orgName, rows, logoUrl }: { orgName: string; rows: StatementRow[]; logoUrl?: string | null }) {
  const bytes = await buildStatementPdf({ orgName, rows, logoUrl });
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Statement_${new Date().toISOString().slice(0, 10)}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
