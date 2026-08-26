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
import { RefResolver, type RefKind } from "@/lib/batch/ref-resolver";
import { entityRefColumns } from "@/lib/batch/ref-columns";
import { entityEnumColumns } from "@/lib/batch/enum-columns";
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
  const refCols = entityRefColumns(entity); // [{ column, kind }]

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

  // Pull the valid values for every reference kind used by this entity.
  const usedKinds = [...new Set(refCols.map((r) => r.kind))];
  const listValues: Partial<Record<RefKind, string[]>> = {};
  let resolver: RefResolver | null = null;

  if (token) {
    resolver = new RefResolver(token);
    const preloadKinds = [...new Set([...usedKinds, ...(entity.reverseRefs || [])])];
    await resolver.preload(preloadKinds);
    for (const k of usedKinds) listValues[k] = await resolver.listNames(k);
  }

  // Every template column that should carry a dropdown, and the values behind
  // it. Two sources feed this:
  //   - reference columns (Customer/Item/Account/…) — need a QBO token to
  //     resolve the org's real values, so present only when connected;
  //   - fixed-choice enum columns (Yes/No, statuses, Item Type, Account Type,
  //     Currency Code) — STATIC, so present on every template, connected or not.
  // This is the fix for "only a few templates had dropdowns": enum columns were
  // never handled, so any template without resolvable reference columns came
  // out bare.
  type DropdownSrc = { key: string; label: string; values: string[] };
  const columnSrc = new Map<string, DropdownSrc>();

  for (const rc of refCols) {
    const vals = listValues[rc.kind];
    if (vals && vals.length) columnSrc.set(rc.column, { key: `ref:${rc.kind}`, label: rc.kind, values: vals });
  }
  for (const ec of entityEnumColumns(columns)) {
    if (columnSrc.has(ec.column)) continue; // a ref column already owns it
    columnSrc.set(ec.column, { key: `enum:${ec.values.join("|")}`, label: "value", values: ec.values });
  }

  if (columnSrc.size > 0) {
    const listWs = wb.addWorksheet("Lists");
    listWs.state = "hidden";
    // One Lists column per DISTINCT value set (all Yes/No columns share one, etc.).
    const rangeByKey = new Map<string, string>();
    let listColIdx = 0;
    for (const src of columnSrc.values()) {
      if (rangeByKey.has(src.key)) continue;
      listColIdx++;
      const letter = colLetter(listColIdx);
      listWs.getCell(`${letter}1`).value = src.label;
      src.values.forEach((v, r) => { listWs.getCell(`${letter}${r + 2}`).value = v; });
      rangeByKey.set(src.key, `Lists!$${letter}$2:$${letter}$${src.values.length + 1}`);
    }

    for (const [column, src] of columnSrc) {
      const range = rangeByKey.get(src.key);
      if (!range) continue;
      const idx = columns.indexOf(column);
      if (idx < 0) continue;
      const letter = colLetter(idx + 1);
      const isRef = src.key.startsWith("ref:");
      // Apply the list dropdown to a generous row span.
      (templateWs as any).dataValidations.add(`${letter}2:${letter}5000`, {
        type: "list",
        allowBlank: true,
        formulae: [range],
        showErrorMessage: true,
        errorStyle: "warning",
        errorTitle: isRef ? `Pick a ${src.label} from the list` : "Pick an allowed value",
        error: isRef
          ? `This must match a ${src.label} that exists in QuickBooks. Choose one from the dropdown, or leave blank.`
          : `Choose one of the allowed values from the dropdown, or leave blank.`,
        showInputMessage: true,
        promptTitle: isRef ? src.label : column,
        prompt: isRef ? `Choose an existing QuickBooks ${src.label}.` : `Choose an allowed value.`,
      });
    }
  }

  // Sample sheet — the org's last ~10 real records mapped into the columns.
  if (entity.qboReadName && token && resolver) {
    try {
      const records = await qboQueryTop(token, entity.qboReadName, 10, entity.qboExtraWhere || "");
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
