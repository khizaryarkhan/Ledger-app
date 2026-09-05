/**
 * GET /api/batch/template?entity=invoice — download a spreadsheet template.
 *
 * Sheet 1 "Template" — the header row the user fills in. Two kinds of column
 *   carry an Excel dropdown so the file can be filled offline with valid picks:
 *     • reference columns (Customer, Supplier, Item, Account, Tax Code, Class,
 *       Location, Payment Method, Terms) — sourced from the org's real
 *       QuickBooks values (needs a connection);
 *     • fixed-choice enum columns (Yes/No flags, Item Type, Account Type,
 *       Estimate/PO/Billable/Print/Email status, Currency Code) — static
 *       values from lib/batch/enum-columns, so they appear on EVERY template
 *       whether or not QBO is connected.
 * Sheet 2 "Sample (Your QuickBooks)" — the last ~10 real records for reference.
 * Sheet 3 "Lists" (hidden) — the dropdown source values.
 *
 * The reference dropdowns + sample are best-effort (need a token); the enum
 * dropdowns always render, so a template is never returned with bare headers
 * when it has any fixed-choice column.
 */

import { requireOrg, bad } from "@/lib/api";
import { getEntity } from "@/lib/batch/entities";
import { getOrgQboToken } from "@/lib/qbo-token";
import { qboQueryTop } from "@/lib/batch/qbo-client";
import { RefResolver } from "@/lib/batch/ref-resolver";
import { buildDropdownPlan, applyDropdowns, entityDropdownKinds } from "@/lib/batch/dropdowns";
import { buildEstimateInvoiceExport } from "@/lib/batch/estimate-export";

export const runtime = "nodejs";
export const maxDuration = 120;

function colLetter(n: number): string {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const entityId = new URL(req.url).searchParams.get("entity") || "";

  // ── Xero: headers-only template ──
  const { detectProvider } = await import("@/lib/batch/provider");
  if ((await detectProvider(orgId!)) === "xero") {
    const { getXeroEntity } = await import("@/lib/batch/xero/registry");
    const xe = getXeroEntity(entityId);
    if (!xe) return bad("Unknown entity", 404);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Template");
    const header = ws.addRow(xe.columns);
    header.eachCell((c: any) => { c.font = { bold: true }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F0F0" } }; });
    ws.columns.forEach((col: any) => { col.width = 20; });
    const buf = await wb.xlsx.writeBuffer();
    return new Response(buf as ArrayBuffer, {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${xe.id}-template.xlsx"` },
    });
  }

  const entity = getEntity(entityId);
  if (!entity) return bad("Unknown entity", 404);

  // "Invoice from Estimates" — the template IS the org's accepted estimate lines
  // (with Already Invoiced / Remaining), ready to fill and re-upload.
  if (entity.id === "estimateinvoice") {
    const token = await getOrgQboToken(orgId!).catch(() => null);
    if (token) {
      const buf = await buildEstimateInvoiceExport(token, {});
      return new Response(buf as ArrayBuffer, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="invoice-from-estimates.xlsx"`,
        },
      });
    }
    // fall through → headers-only template if not connected
  }

  const columns = entity.columns.map((c) => c.trim());

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();

  const templateWs = wb.addWorksheet("Template", { views: [{ state: "frozen", ySplit: 1 }] });
  const headerRow = templateWs.addRow(columns);
  headerRow.eachCell((c: any) => {
    c.font = { name: "Calibri", bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F0F0" } };
    c.border = { bottom: { style: "thin" } };
  });
  templateWs.columns.forEach((col: any) => { col.width = 22; });

  const token = await getOrgQboToken(orgId!).catch(() => null);

  let resolver: RefResolver | null = null;
  if (token) {
    resolver = new RefResolver(token);
    await resolver.preload(entityDropdownKinds(entity));
  }

  // Dropdowns come from lib/batch/dropdowns, shared with the data export, so
  // the two can't drift apart — a template and an export of the same entity
  // should validate identically. Without a token the reference lists are
  // unavailable but the fixed-choice (enum) dropdowns still render.
  const plan = await buildDropdownPlan(columns, entity, resolver);
  applyDropdowns(wb, templateWs, columns, plan, 5000);

  // Sample sheet — the org's last ~10 real records mapped into the columns.
  if (entity.qboReadName && token && resolver) {
    try {
      // qboClientFilter can't be expressed as a server-side WHERE (see
      // types.ts) — fetch a larger unfiltered top-N and filter+truncate
      // client-side instead of the usual top-10 direct from QBO.
      let records = entity.qboClientFilter
        ? (await qboQueryTop(token, entity.qboReadName, 50, "")).filter(entity.qboClientFilter).slice(0, 10)
        : await qboQueryTop(token, entity.qboReadName, 10, entity.qboExtraWhere || "");
      if (records.length > 0) {
        const mapped: Record<string, any>[] = [];
        for (const r of records) {
          const rows = entity.toRows ? await entity.toRows(r, resolver) : [];
          mapped.push(...rows);
        }
        if (mapped.length > 0) {
          const sampleWs = wb.addWorksheet("Sample (Your QuickBooks)", { views: [{ state: "frozen", ySplit: 1 }] });
          const sh = sampleWs.addRow(columns);
          sh.eachCell((c: any) => { c.font = { name: "Calibri", bold: true }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F7F7" } }; });
          for (const row of mapped) sampleWs.addRow(columns.map((c) => row[c] ?? ""));
          sampleWs.columns.forEach((col: any) => { col.width = 22; });
        }
      }
    } catch {
      // Sample is a convenience — never block the download.
    }
  }

  const buf = await wb.xlsx.writeBuffer();

  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${entity.id}-template.xlsx"`,
    },
  });
}
