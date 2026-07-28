/**
 * Generate a professional bill approval certificate using pdf-lib.
 * Designed to look like a Big 4 accounting firm document:
 * company-branded letterhead, clean typography, formal approval block.
 */

import { PDFDocument, StandardFonts, rgb, PDFImage } from "pdf-lib";

export interface ApprovalPdfOpts {
  billNumber?:   string | null;
  supplierName?: string | null;
  total?:        number | null;
  currency?:     string | null;
  billDate?:     string | null;
  dueDate?:      string | null;
  approvedAt:    Date;
  approverName?: string | null;
  comments?:     string | null;
  // Org branding — passed from the approve/push route
  orgName?:      string | null;
  orgLogoUrl?:   string | null;
}

// ── Colour palette (corporate navy + warm grays) ────────────────────────────
const C = {
  navy:      rgb(0.07, 0.14, 0.30),   // #12244d
  navyMid:   rgb(0.13, 0.22, 0.43),   // #213870
  gold:      rgb(0.70, 0.55, 0.22),   // #b38c38
  black:     rgb(0.10, 0.10, 0.10),
  darkGray:  rgb(0.25, 0.25, 0.25),
  midGray:   rgb(0.45, 0.45, 0.45),
  lightGray: rgb(0.70, 0.70, 0.70),
  rowAlt:    rgb(0.96, 0.97, 0.98),
  rowWhite:  rgb(1.00, 1.00, 1.00),
  approved:  rgb(0.09, 0.43, 0.22),   // #176138
  approvedBg:rgb(0.93, 0.98, 0.94),   // #edfaf1
  approvedBd:rgb(0.20, 0.65, 0.38),   // #33a661
  white:     rgb(1.00, 1.00, 1.00),
};

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });
}

function fmtMoney(total?: number | null, currency?: string | null) {
  if (total == null) return "—";
  const ccy = (currency ?? "").trim();
  const num  = total.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return ccy ? `${ccy} ${num}` : num;
}

function fmtApprovedAt(d: Date) {
  return d.toLocaleString("en-GB", {
    timeZone:  "UTC",
    day:       "numeric",
    month:     "long",
    year:      "numeric",
    hour:      "2-digit",
    minute:    "2-digit",
  }) + " UTC";
}

/** Try to fetch an org logo and embed it — returns null if unavailable. */
async function fetchLogo(
  doc: PDFDocument,
  url: string,
): Promise<PDFImage | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const buf   = Buffer.from(await res.arrayBuffer());
    const mime  = res.headers.get("content-type") ?? "";
    if (mime.includes("png") || url.toLowerCase().endsWith(".png")) {
      return await doc.embedPng(buf);
    }
    return await doc.embedJpg(buf);
  } catch {
    return null;
  }
}

export async function generateApprovalPdf(opts: ApprovalPdfOpts): Promise<Buffer> {
  const doc  = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4 portrait
  const { width, height } = page.getSize();

  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const oblique = await doc.embedFont(StandardFonts.HelveticaOblique);

  const ML = 52; // margin left
  const MR = 52; // margin right
  const CW = width - ML - MR; // content width

  // ── 1. Top accent bar ───────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: height - 6, width, height: 6, color: C.navy });
  page.drawRectangle({ x: 0, y: height - 9, width, height: 3, color: C.gold });

  // ── 2. Letterhead ──────────────────────────────────────────────────────────
  const orgName = (opts.orgName ?? "").trim() || "Organisation";
  let headerY   = height - 30;

  // Try to embed logo
  let logoImage: PDFImage | null = null;
  if (opts.orgLogoUrl) {
    logoImage = await fetchLogo(doc, opts.orgLogoUrl);
  }

  const LOGO_MAX_H = 34;
  const LOGO_MAX_W = 150;

  if (logoImage) {
    const dims = logoImage.scaleToFit(LOGO_MAX_W, LOGO_MAX_H);
    page.drawImage(logoImage, {
      x: ML,
      y: headerY - dims.height,
      width:  dims.width,
      height: dims.height,
    });
    headerY -= dims.height;
  } else {
    // Text fallback — org name in navy
    page.drawText(orgName, {
      x: ML, y: headerY - 22,
      font: bold, size: 16, color: C.navy,
    });
    headerY -= 22;
  }

  // Document type block — right-aligned
  page.drawText("BILL APPROVAL CERTIFICATE", {
    x: width - MR - bold.widthOfTextAtSize("BILL APPROVAL CERTIFICATE", 11),
    y: height - 30,
    font: bold, size: 11, color: C.navy,
  });

  const refLine = `Ref: ${opts.billNumber ?? "—"}`;
  page.drawText(refLine, {
    x: width - MR - regular.widthOfTextAtSize(refLine, 8.5),
    y: height - 46,
    font: regular, size: 8.5, color: C.midGray,
  });

  const dateLine = `Date: ${fmtApprovedAt(opts.approvedAt)}`;
  page.drawText(dateLine, {
    x: width - MR - regular.widthOfTextAtSize(dateLine, 8.5),
    y: height - 58,
    font: regular, size: 8.5, color: C.midGray,
  });

  // ── 3. Divider under header ────────────────────────────────────────────────
  const divY1 = headerY - 18;
  page.drawLine({
    start: { x: ML,      y: divY1 },
    end:   { x: ML + CW, y: divY1 },
    thickness: 0.75, color: C.navy,
  });
  page.drawLine({
    start: { x: ML,      y: divY1 - 2 },
    end:   { x: ML + CW, y: divY1 - 2 },
    thickness: 0.25, color: C.gold,
  });

  // ── 4. Section: Bill Details ───────────────────────────────────────────────
  let y = divY1 - 22;

  page.drawText("BILL DETAILS", {
    x: ML, y,
    font: bold, size: 8, color: C.navy,
  });
  // Underline
  page.drawLine({
    start: { x: ML, y: y - 3 }, end: { x: ML + 80, y: y - 3 },
    thickness: 0.5, color: C.gold,
  });

  y -= 16;

  const billRows: [string, string][] = [
    ["Bill Number",  opts.billNumber    ?? "—"],
    ["Supplier",     opts.supplierName  ?? "—"],
    ["Amount",       fmtMoney(opts.total, opts.currency)],
    ["Bill Date",    fmtDate(opts.billDate)],
    ["Due Date",     fmtDate(opts.dueDate)],
  ];

  const LW     = 120; // label column width
  const rowH   = 26;

  for (let i = 0; i < billRows.length; i++) {
    const ry = y - i * rowH;
    // Alternating row background
    page.drawRectangle({
      x: ML, y: ry - rowH + 7,
      width: CW, height: rowH,
      color: i % 2 === 0 ? C.rowAlt : C.rowWhite,
    });
    // Left border accent on label cell
    page.drawRectangle({
      x: ML, y: ry - rowH + 7,
      width: 2, height: rowH,
      color: C.navy,
    });
    page.drawText(billRows[i][0], {
      x: ML + 10, y: ry - 10,
      font: bold, size: 9, color: C.darkGray,
    });
    page.drawText(billRows[i][1], {
      x: ML + LW, y: ry - 10,
      font: regular, size: 9, color: C.black,
    });
  }

  y -= billRows.length * rowH + 28;

  // ── 5. Section: Approval Authorization ────────────────────────────────────
  page.drawText("APPROVAL AUTHORIZATION", {
    x: ML, y,
    font: bold, size: 8, color: C.navy,
  });
  page.drawLine({
    start: { x: ML, y: y - 3 }, end: { x: ML + 118, y: y - 3 },
    thickness: 0.5, color: C.gold,
  });

  y -= 18;

  // Intro statement
  const intro =
    "This bill has been duly reviewed and authorized for payment in accordance with " +
    "the organisation's financial authorization policies and internal controls.";
  const introLines = wrapText(intro, regular, 9, CW);
  for (const line of introLines) {
    page.drawText(line, { x: ML, y, font: regular, size: 9, color: C.midGray });
    y -= 13;
  }

  y -= 8;

  const authRows: [string, string][] = [
    ["Authorized By",  opts.approverName ?? "—"],
    ["Capacity",       "Company Administrator"],
    ["Authorized At",  fmtApprovedAt(opts.approvedAt)],
    ["Decision",       "APPROVED FOR PAYMENT"],
  ];

  if (opts.comments) {
    authRows.push(["Comments", opts.comments]);
  }

  for (let i = 0; i < authRows.length; i++) {
    const ry  = y - i * rowH;
    const isDecision = authRows[i][0] === "Decision";
    page.drawRectangle({
      x: ML, y: ry - rowH + 7,
      width: CW, height: rowH,
      color: isDecision ? rgb(0.94, 0.97, 0.99) : (i % 2 === 0 ? C.rowAlt : C.rowWhite),
    });
    page.drawRectangle({
      x: ML, y: ry - rowH + 7,
      width: 2, height: rowH,
      color: isDecision ? C.navyMid : C.navy,
    });
    page.drawText(authRows[i][0], {
      x: ML + 10, y: ry - 10,
      font: bold, size: 9,
      color: isDecision ? C.navyMid : C.darkGray,
    });
    page.drawText(authRows[i][1], {
      x: ML + LW, y: ry - 10,
      font: isDecision ? bold : regular,
      size: isDecision ? 9.5 : 9,
      color: isDecision ? C.navyMid : C.black,
    });
  }

  y -= authRows.length * rowH + 28;

  // ── 6. Certification stamp ─────────────────────────────────────────────────
  const stampH = 68;
  page.drawRectangle({
    x: ML, y: y - stampH,
    width: CW, height: stampH,
    color: C.approvedBg,
    borderColor: C.approvedBd,
    borderWidth: 1,
  });
  // Left accent strip
  page.drawRectangle({
    x: ML, y: y - stampH,
    width: 4, height: stampH,
    color: C.approved,
  });

  page.drawText("APPROVED FOR PAYMENT", {
    x: ML + 18, y: y - 22,
    font: bold, size: 14, color: C.approved,
  });
  page.drawText(`This document certifies that bill ${opts.billNumber ?? ""} has been formally`, {
    x: ML + 18, y: y - 38,
    font: regular, size: 8.5, color: C.approved,
  });
  page.drawText(`approved for payment by ${opts.approverName ?? "an authorised approver"} on ${fmtApprovedAt(opts.approvedAt)}.`, {
    x: ML + 18, y: y - 51,
    font: regular, size: 8.5, color: C.approved,
  });

  // Document ID (bottom-right of stamp)
  const docId = `DOC-${Date.now().toString(36).toUpperCase()}`;
  page.drawText(docId, {
    x: ML + CW - regular.widthOfTextAtSize(docId, 7.5) - 10,
    y: y - stampH + 8,
    font: oblique, size: 7.5, color: C.approvedBd,
  });

  // ── 7. Footer ──────────────────────────────────────────────────────────────
  const footerY = 36;
  page.drawLine({
    start: { x: ML, y: footerY + 12 }, end: { x: ML + CW, y: footerY + 12 },
    thickness: 0.4, color: C.lightGray,
  });
  page.drawRectangle({ x: 0, y: 0, width, height: 5, color: C.navy });

  page.drawText(orgName, {
    x: ML, y: footerY,
    font: bold, size: 7.5, color: C.midGray,
  });
  page.drawText("CONFIDENTIAL — This is a system-generated approval record. Unauthorised distribution is prohibited.", {
    x: ML, y: footerY - 11,
    font: regular, size: 6.5, color: C.lightGray,
  });

  const pageLabel = "Page 1 of 1";
  page.drawText(pageLabel, {
    x: width - MR - regular.widthOfTextAtSize(pageLabel, 7.5),
    y: footerY,
    font: regular, size: 7.5, color: C.midGray,
  });

  return Buffer.from(await doc.save());
}

/** Naive word-wrap for a single paragraph. Returns array of lines. */
function wrapText(text: string, font: any, size: number, maxWidth: number): string[] {
  const words  = text.split(" ");
  const lines: string[] = [];
  let   line   = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
