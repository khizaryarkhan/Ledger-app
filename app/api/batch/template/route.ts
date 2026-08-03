/**
 * GET /api/batch/template?entity=invoice — download a spreadsheet template.
 *
 * Sheet 1 "Template" — the header row the user fills in. Reference columns
 *   (Customer, Supplier, Item, Account, Tax Code, Class, Location, Payment
 *   Method, Terms) carry Excel dropdown validation sourced from the real
 *   QuickBooks values, so the file can be filled offline with valid picks.
 * Sheet 2 "Sample (Your QuickBooks)" — the last ~10 real records for reference.
 * Sheet 3 "Lists" (hidden) — the dropdown source values.
 *
 * Dropdowns + sample are best-effort: with no QBO connection the template is
 * returned with headers alone.
 */

import { requireOrg, bad } from "@/lib/api";
import { getEntity } from "@/lib/batch/entities";
import { getOrgQboToken } from "@/lib/qbo-token";
import { qboQueryTop } from "@/lib/batch/qbo-client";
import { RefResolver, type RefKind } from "@/lib/batch/ref-resolver";
import { entityRefColumns } from "@/lib/batch/ref-columns";

export const runtime = "nodejs";
export const maxDuration = 60;

function colLetter(n: number): string {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const entityId = new URL(req.url).searchParams.get("entity") || "";
  const entity = getEntity(entityId);
  if (!entity) return bad("Unknown entity", 404);

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

  // Hidden "Lists" sheet + dropdown validations.
  const kindsWithValues = usedKinds.filter((k) => (listValues[k]?.length ?? 0) > 0);
  if (kindsWithValues.length > 0) {
    const listWs = wb.addWorksheet("Lists");
    listWs.state = "hidden";
    const rangeForKind: Partial<Record<RefKind, string>> = {};
    kindsWithValues.forEach((kind, i) => {
      const letter = colLetter(i + 1);
      const vals = listValues[kind]!;
      listWs.getCell(`${letter}1`).value = kind;
      vals.forEach((v, r) => { listWs.getCell(`${letter}${r + 2}`).value = v; });
      rangeForKind[kind] = `Lists!$${letter}$2:$${letter}$${vals.length + 1}`;
    });

    for (const rc of refCols) {
      const range = rangeForKind[rc.kind];
      if (!range) continue;
      const idx = columns.indexOf(rc.column);
      if (idx < 0) continue;
      const letter = colLetter(idx + 1);
      // Apply the list dropdown to a generous row span.
      (templateWs as any).dataValidations.add(`${letter}2:${letter}5000`, {
        type: "list",
        allowBlank: true,
        formulae: [range],
        showErrorMessage: true,
        errorStyle: "warning",
        errorTitle: `Pick a ${rc.kind} from the list`,
        error: `This must match a ${rc.kind} that exists in QuickBooks. Choose one from the dropdown, or leave blank.`,
        showInputMessage: true,
        promptTitle: rc.kind,
        prompt: `Choose an existing QuickBooks ${rc.kind}.`,
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
