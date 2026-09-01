/**
 * Builds the "Invoice from Estimates" working spreadsheet: accepted estimates
 * exploded to one row per line, with Already Invoiced / Remaining computed from
 * linked invoices and blank Qty/Amount-to-Invoice columns for the user to fill.
 *
 * Used as the template download for the "estimateinvoice" batch entity.
 */

import type { OrgQboToken } from "@/lib/qbo-token";
import { qboQueryAll } from "./qbo-client";
import { RefResolver, refDisplayName } from "./ref-resolver";
import { PROGRESS_COLUMNS, PROGRESS_FILL_COLUMNS, PROGRESS_COMPUTED_COLUMNS } from "./convert";
import { fetchLinkedInvoices, invoicedByLineIndex } from "./estimate-invoicing";
import { buildDropdownPlan, applyDropdowns } from "./dropdowns";
import { getEntity } from "./entities";

export interface EstimateExportOpts { status?: string; from?: string; to?: string; }

export async function buildEstimateInvoiceExport(
  token: OrgQboToken,
  opts: EstimateExportOpts = {}
): Promise<ArrayBuffer> {
  // NB: QBO does not allow filtering estimates by TxnStatus in the query
  // ("property 'TxnStatus' is not queryable"), so we filter by date in the
  // query and by status in code.
  const clauses: string[] = [];
  if (opts.from) clauses.push(`TxnDate >= '${opts.from}'`);
  if (opts.to) clauses.push(`TxnDate <= '${opts.to}'`);

  let estimates = await qboQueryAll(token, "Estimate", clauses.join(" AND "));
  const status = opts.status ?? "Accepted";
  if (status && status !== "Any") estimates = estimates.filter((e: any) => e.TxnStatus === status);

  const resolver = new RefResolver(token);
  await resolver.preload(["Item", "Class", "Department", "TaxCode"]);

  // Fetch invoices linked to these estimates → already-invoiced per line
  // (shared, corrected computation matching on item id).
  const invoiceById = await fetchLinkedInvoices(token, estimates);

  const rows: Record<string, any>[] = [];
  for (const est of estimates) {
    const customer = est.CustomerRef?.name ?? "";
    const location = await refDisplayName(est.DepartmentRef, "Department", resolver);
    const headerClass = await refDisplayName(est.ClassRef, "Class", resolver);
    const currency = est.CurrencyRef?.value ?? "";
    const already = invoicedByLineIndex(est, invoiceById);
    const salesLines = (est.Line || []).filter((l: any) => l.DetailType === "SalesItemLineDetail");
    for (let li = 0; li < salesLines.length; li++) {
      const line = salesLines[li];
      const d = line.SalesItemLineDetail || {};
      const item = (await refDisplayName(d.ItemRef, "Item", resolver)) ?? "";
      const lineClass = (await refDisplayName(d.ClassRef, "Class", resolver)) ?? headerClass;
      const taxCode = await refDisplayName(d.TaxCodeRef, "TaxCode", resolver);

      const estAmt = Number(line.Amount) || 0;
      const alreadyAmt = already[li] ?? 0;
      const remaining = Math.round((estAmt - alreadyAmt) * 100) / 100;

      rows.push({
        "Estimate Id": est.Id,
        "Estimate No": est.DocNumber ?? "",
        "Customer": customer,
        "Invoice Date": "",
        "Invoice No": "",
        "Class": lineClass ?? "",
        "Location": location ?? "",
        "Currency": currency,
        "Product/Service": item,
        "Description": line.Description ?? "",
        "Estimated Qty": d.Qty ?? "",
        "Estimated Rate": d.UnitPrice ?? "",
        "Estimated Amount": line.Amount ?? "",
        "Already Invoiced": alreadyAmt ? alreadyAmt : "",
        "Remaining": remaining,
        "Sales Tax Code": taxCode ?? "",
        "Qty to Invoice": "",
        "Amount to Invoice": "",
      });
    }
  }

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Invoice from Estimates", { views: [{ state: "frozen", ySplit: 1 }] });
  const header = ws.addRow(PROGRESS_COLUMNS);
  header.eachCell((c: any) => {
    const name = String(c.value);
    const fill = PROGRESS_FILL_COLUMNS.includes(name);
    const computed = PROGRESS_COMPUTED_COLUMNS.includes(name);
    const bg = fill ? "FFFDEBC8" : computed ? "FFE6F0FA" : "FFF0F0F0";
    const fg = fill ? "FF7A4E00" : computed ? "FF1E4E79" : undefined;
    c.font = { name: "Calibri", bold: true, color: fg ? { argb: fg } : undefined };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
    c.border = { bottom: { style: "thin" } };
  });
  for (const r of rows) ws.addRow(PROGRESS_COLUMNS.map((c) => r[c] ?? ""));
  const WIDTH: Record<string, number> = {
    "Estimate Id": 14, "Estimate No": 12, "Customer": 26, "Invoice Date": 13, "Invoice No": 12,
    "Class": 16, "Location": 16, "Currency": 9, "Product/Service": 24, "Description": 30,
    "Estimated Qty": 12, "Estimated Rate": 13, "Estimated Amount": 15,
    "Already Invoiced": 15, "Remaining": 13, "Sales Tax Code": 16,
    "Qty to Invoice": 14, "Amount to Invoice": 16,
  };
  ws.columns.forEach((col: any, i: number) => { col.width = WIDTH[PROGRESS_COLUMNS[i]] ?? 16; });
  ws.getColumn(1).font = { name: "Calibri", color: { argb: "FF999999" } };

  // This entity builds its own workbook (a working sheet of exploded estimate
  // lines, not a plain entity template), so it never went through the
  // shared dropdown plumbing every other entity's template/export gets —
  // Customer/Class/Location/Product-Service/Sales Tax Code had no dropdowns
  // at all. Reuse the same lib/batch/dropdowns.ts plan so this file validates
  // the same way as everything else.
  const entity = getEntity("estimateinvoice");
  if (entity) {
    try {
      const plan = await buildDropdownPlan(PROGRESS_COLUMNS, entity, resolver);
      applyDropdowns(wb, ws, PROGRESS_COLUMNS, plan, rows.length + 100);
    } catch {
      // Dropdowns are an aid, not the payload. Never lose the export over one.
    }
  }

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
