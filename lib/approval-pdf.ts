/**
 * Generate an approval certificate PDF for a bill using pdf-lib.
 * Attached to QBO/Xero after approval so the audit trail lives in the
 * accounting system alongside the bill itself.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface ApprovalPdfOpts {
  billNumber?: string | null;
  supplierName?: string | null;
  total?: number | null;
  currency?: string | null;
  approvedAt: Date;
  approverName?: string | null;
  comments?: string | null;
}

export async function generateApprovalPdf(opts: ApprovalPdfOpts): Promise<Buffer> {
  const doc  = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();

  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  const margin = 56;

  // ── Header bar ──────────────────────────────────────────────────────────────
  page.drawRectangle({
    x: 0, y: height - 78,
    width, height: 78,
    color: rgb(0.06, 0.08, 0.10),
  });
  page.drawText("BILL APPROVAL CERTIFICATE", {
    x: margin, y: height - 46,
    font: bold, size: 17, color: rgb(1, 1, 1),
  });
  page.drawText("Prime Accountax  -  Accounts Payable", {
    x: margin, y: height - 66,
    font: regular, size: 9, color: rgb(0.55, 0.55, 0.55),
  });

  // ── Details table ────────────────────────────────────────────────────────────
  const tableX  = margin;
  const tableW  = width - margin * 2;
  const labelW  = 140;
  const rowH    = 32;
  let y = height - 78 - 36;

  const rows: [string, string][] = [
    ["Bill Number",  opts.billNumber    ?? "-"],
    ["Supplier",     opts.supplierName  ?? "-"],
    ["Amount",       opts.total != null
      ? `${opts.currency ?? ""} ${opts.total.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`
      : "-"],
    ["Approved By",  opts.approverName  ?? "-"],
    ["Approved At",  opts.approvedAt.toLocaleString("en-GB", {
      timeZone: "UTC", year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    }) + " UTC"],
  ];

  if (opts.comments) rows.push(["Comments", opts.comments]);

  for (let i = 0; i < rows.length; i++) {
    const rowY = y - i * rowH;

    page.drawRectangle({
      x: tableX, y: rowY - rowH + 6,
      width: tableW, height: rowH,
      color: i % 2 === 0 ? rgb(0.97, 0.97, 0.97) : rgb(1, 1, 1),
    });

    page.drawText(rows[i][0], {
      x: tableX + 10, y: rowY - 11,
      font: bold, size: 9.5, color: rgb(0.35, 0.35, 0.35),
    });
    page.drawText(rows[i][1], {
      x: tableX + labelW, y: rowY - 11,
      font: regular, size: 9.5, color: rgb(0.1, 0.1, 0.1),
    });
  }

  y -= rows.length * rowH + 32;

  // ── Approved stamp ────────────────────────────────────────────────────────────
  page.drawRectangle({
    x: tableX, y: y - 50, width: tableW, height: 58,
    color: rgb(0.94, 0.99, 0.95),
    borderColor: rgb(0.22, 0.70, 0.40), borderWidth: 1.5,
  });
  page.drawText("APPROVED FOR PAYMENT", {
    x: tableX + 18, y: y - 22,
    font: bold, size: 13, color: rgb(0.10, 0.50, 0.22),
  });

  const genDate = new Date().toLocaleDateString("en-GB", {
    year: "numeric", month: "long", day: "numeric",
  });
  page.drawText(`Generated automatically by Prime Accountax on ${genDate}`, {
    x: tableX + 18, y: y - 42,
    font: regular, size: 8.5, color: rgb(0.40, 0.50, 0.40),
  });

  // ── Footer rule ───────────────────────────────────────────────────────────────
  page.drawLine({
    start: { x: margin, y: 42 },
    end:   { x: width - margin, y: 42 },
    thickness: 0.5, color: rgb(0.8, 0.8, 0.8),
  });
  page.drawText("This document was generated automatically and serves as a digital approval record.", {
    x: margin, y: 28,
    font: regular, size: 7.5, color: rgb(0.6, 0.6, 0.6),
  });

  return Buffer.from(await doc.save());
}
