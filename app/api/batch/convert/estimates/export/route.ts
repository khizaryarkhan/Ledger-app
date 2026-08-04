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
import { PROGRESS_COLUMNS, PROGRESS_FILL_COLUMNS, PROGRESS_COMPUTED_COLUMNS } from "@/lib/batch/convert";

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

  // Fetch every invoice already linked to these estimates, so we can show how
  // much of each line has been billed and what remains — the guard against
  // double-billing across progress-invoicing rounds.
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

  // Sum already-invoiced amount per (item + description) key for one estimate.
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
    const pool = await invoicedPool(est); // mutable: consumed as we attribute per line
    for (const line of est.Line || []) {
      if (line.DetailType !== "SalesItemLineDetail") continue;
      const d = line.SalesItemLineDetail || {};
      const item = (await refDisplayName(d.ItemRef, "Item", resolver)) ?? "";
      const lineClass = (await refDisplayName(d.ClassRef, "Class", resolver)) ?? headerClass;
      const taxCode = await refDisplayName(d.TaxCodeRef, "TaxCode", resolver);

      // Attribute already-invoiced to this line, capped at its estimated amount,
      // consuming from the pool so duplicate item/description lines don't double count.
      const estAmt = Number(line.Amount) || 0;
      const available = pool.get(lineKey(item, line.Description)) ?? 0;
      const already = Math.min(available, estAmt);
      pool.set(lineKey(item, line.Description), available - already);
      const remaining = Math.round((estAmt - already) * 100) / 100;

      rows.push({
        "Estimate Id": est.Id,
        "Estimate No": est.DocNumber ?? "",
        "Customer": customer,
        "Invoice Date": "",
        "Invoice No": "",                 // blank → QBO auto-numbers
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
  const ws = wb.addWorksheet("Progress Invoicing", { views: [{ state: "frozen", ySplit: 1 }] });
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
  // Grey the Estimate Id column to signal "don't edit".
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
