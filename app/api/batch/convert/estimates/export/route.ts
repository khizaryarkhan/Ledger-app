/**
 * POST /api/batch/convert/estimates/export
 * JSON body: { status?, from?, to? }  (defaults to Accepted estimates)
 *
 * Returns an xlsx with one row per estimate line and blank "Qty to Invoice" /
 * "Amount to Invoice" columns. The user fills how much of each line to bill,
 * then re-uploads to create linked invoices — enabling precise progress billing.
 */

import { requireOrg, bad } from "@/lib/api";
import { getOrgQboToken } from "@/lib/qbo-token";
import { qboQueryAll } from "@/lib/batch/qbo-client";
import { RefResolver, refDisplayName } from "@/lib/batch/ref-resolver";
import { PROGRESS_COLUMNS, PROGRESS_FILL_COLUMNS } from "@/lib/batch/convert";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected for this organisation", 400);

  const clauses: string[] = [];
  const status = body.status || "Accepted";
  if (status && status !== "Any") clauses.push(`TxnStatus = '${String(status).replace(/'/g, "\\'")}'`);
  if (body.from) clauses.push(`TxnDate >= '${body.from}'`);
  if (body.to) clauses.push(`TxnDate <= '${body.to}'`);

  let estimates: any[];
  try {
    estimates = await qboQueryAll(token, "Estimate", clauses.join(" AND "));
  } catch (e: any) {
    return bad(e?.message || "QBO query failed", 502);
  }

  const resolver = new RefResolver(token);
  await resolver.preload(["Item", "Class", "Department", "TaxCode"]);

  const rows: any[][] = [];
  for (const est of estimates) {
    const customer = est.CustomerRef?.name ?? "";
    const location = await refDisplayName(est.DepartmentRef, "Department", resolver);
    const headerClass = await refDisplayName(est.ClassRef, "Class", resolver);
    const currency = est.CurrencyRef?.value ?? "";
    for (const line of est.Line || []) {
      if (line.DetailType !== "SalesItemLineDetail") continue;
      const d = line.SalesItemLineDetail || {};
      const item = await refDisplayName(d.ItemRef, "Item", resolver);
      const lineClass = (await refDisplayName(d.ClassRef, "Class", resolver)) ?? headerClass;
      const taxCode = await refDisplayName(d.TaxCodeRef, "TaxCode", resolver);
      rows.push([
        est.Id, est.DocNumber ?? "", customer, "",
        lineClass ?? "", location ?? "", currency,
        item ?? "", line.Description ?? "",
        d.Qty ?? "", d.UnitPrice ?? "", line.Amount ?? "", taxCode ?? "",
        "", "", // Qty to Invoice, Amount to Invoice — blank for the user
      ]);
    }
  }

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Progress Invoicing", { views: [{ state: "frozen", ySplit: 1 }] });
  const header = ws.addRow(PROGRESS_COLUMNS);
  header.eachCell((c: any) => {
    const fill = PROGRESS_FILL_COLUMNS.includes(String(c.value));
    c.font = { name: "Calibri", bold: true, color: fill ? { argb: "FF7A4E00" } : undefined };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill ? "FFFDEBC8" : "FFF0F0F0" } };
    c.border = { bottom: { style: "thin" } };
  });
  for (const r of rows) ws.addRow(r);
  ws.columns.forEach((col: any, i: number) => { col.width = [14, 12, 26, 13, 16, 16, 9, 24, 30, 12, 13, 15, 16, 14, 16][i] ?? 16; });
  // Grey the reference columns lightly to signal "don't edit these".
  ws.getColumn(1).font = { name: "Calibri", color: { argb: "FF999999" } };

  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="estimates-to-invoice.xlsx"`,
      "X-Row-Count": String(estimates.length),
    },
  });
}
