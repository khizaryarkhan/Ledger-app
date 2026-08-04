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

  // Fetch invoices already linked to these estimates → already-invoiced per line.
  const invIds = new Set<string>();
  for (const est of estimates)
    for (const lt of est.LinkedTxn || [])
      if (lt.TxnType === "Invoice" && lt.TxnId) invIds.add(String(lt.TxnId));

  const invoiceById = new Map<string, any>();
  if (invIds.size > 0) {
    const ids = [...invIds];
    for (let i = 0; i < ids.length; i += 80) {
      const inList = ids.slice(i, i + 80).map((x) => `'${x}'`).join(",");
      const recs = await qboQueryAll(token, "Invoice", `Id IN (${inList})`).catch(() => []);
      for (const r of recs) invoiceById.set(String(r.Id), r);
    }
  }

  const lineKey = (itemName: string, desc: any) => `${itemName}||${String(desc ?? "").trim().toLowerCase()}`;
  async function invoicedPool(est: any): Promise<Map<string, number>> {
    const m = new Map<string, number>();
    for (const lt of est.LinkedTxn || []) {
      if (lt.TxnType !== "Invoice") continue;
      const inv = invoiceById.get(String(lt.TxnId));
      if (!inv) continue;
      for (const line of inv.Line || []) {
        if (line.DetailType !== "SalesItemLineDetail") continue;
        const d = line.SalesItemLineDetail || {};
        const name = (await refDisplayName(d.ItemRef, "Item", resolver)) ?? "";
        const k = lineKey(name, line.Description);
        m.set(k, (m.get(k) ?? 0) + (Number(line.Amount) || 0));
      }
    }
    return m;
  }

  const rows: Record<string, any>[] = [];
  for (const est of estimates) {
    const customer = est.CustomerRef?.name ?? "";
    const location = await refDisplayName(est.DepartmentRef, "Department", resolver);
    const headerClass = await refDisplayName(est.ClassRef, "Class", resolver);
    const currency = est.CurrencyRef?.value ?? "";
    const pool = await invoicedPool(est);
    for (const line of est.Line || []) {
      if (line.DetailType !== "SalesItemLineDetail") continue;
      const d = line.SalesItemLineDetail || {};
      const item = (await refDisplayName(d.ItemRef, "Item", resolver)) ?? "";
      const lineClass = (await refDisplayName(d.ClassRef, "Class", resolver)) ?? headerClass;
      const taxCode = await refDisplayName(d.TaxCodeRef, "TaxCode", resolver);

      const estAmt = Number(line.Amount) || 0;
      const key = lineKey(item, line.Description);
      const available = pool.get(key) ?? 0;
      const already = Math.min(available, estAmt);
      pool.set(key, available - already);
      const remaining = Math.round((estAmt - already) * 100) / 100;

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
        "Already Invoiced": already ? Math.round(already * 100) / 100 : "",
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

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
