/**
 * Management P&L report — statement lines (rows) × profit centre (columns).
 * GET ?from&to&dimensionId=<profit-centre dimension, optional>
 *
 * Each QBO line is classified twice: against the STATEMENT dimension (→ which
 * P&L line / row, via mapping rules) and against the chosen PROFIT-CENTRE
 * dimension (→ which column). Detail rows sum the matched lines; computed rows
 * (Gross Profit, EBITDA, …) evaluate their formula per column. Anything a
 * statement rule doesn't match is surfaced as "Not mapped to a P&L line" — never
 * dropped — and the whole thing reconciles to the extracted total.
 */
import { db } from "@/db";
import { reportingDimensions, reportingDimensionValues, reportingRules, reportingOverrides } from "@/db/schema";
import { and, eq, ne, asc } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";
import { getOrgQboToken } from "@/lib/qbo-token";
import { extractSourceLines } from "@/lib/reporting/source";
import { classifyDimension } from "@/lib/reporting/engine";
import type { EngineRule } from "@/lib/reporting/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const UNALLOC = "__unallocated__";
const NOLINE = "__noline__";
const round2 = (n: number) => Math.round(n * 100) / 100;

const toEngineRules = (rows: any[]): EngineRule[] => rows.map((r) => ({
  id: r.id, dimensionId: r.dimensionId, targetValueId: r.targetValueId, priority: r.priority,
  conditions: r.conditions, active: r.active, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo,
}));

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) return bad("from and to dates are required");

  // Statement dimension + its lines.
  const [statementDim] = await db.select().from(reportingDimensions)
    .where(and(eq(reportingDimensions.orgId, orgId!), eq(reportingDimensions.kind, "statement"))).limit(1);
  if (!statementDim) return bad("No management P&L structure yet — set one up under P&L Structure.", 400);
  const statementLines = await db.select().from(reportingDimensionValues)
    .where(and(eq(reportingDimensionValues.orgId, orgId!), eq(reportingDimensionValues.dimensionId, statementDim.id)))
    .orderBy(asc(reportingDimensionValues.sortOrder));
  const statementRules = toEngineRules(await db.select().from(reportingRules)
    .where(and(eq(reportingRules.orgId, orgId!), eq(reportingRules.dimensionId, statementDim.id))));

  // Profit-centre dimension (columns) — chosen, else first non-statement, else none.
  const otherDims = await db.select().from(reportingDimensions)
    .where(and(eq(reportingDimensions.orgId, orgId!), ne(reportingDimensions.kind, "statement")))
    .orderBy(asc(reportingDimensions.sortOrder));
  const pcDim = otherDims.find((d) => d.id === url.searchParams.get("dimensionId")) || otherDims[0] || null;
  const pcValues = pcDim ? await db.select().from(reportingDimensionValues)
    .where(and(eq(reportingDimensionValues.orgId, orgId!), eq(reportingDimensionValues.dimensionId, pcDim.id)))
    .orderBy(asc(reportingDimensionValues.sortOrder)) : [];
  const pcRules = pcDim ? toEngineRules(await db.select().from(reportingRules)
    .where(and(eq(reportingRules.orgId, orgId!), eq(reportingRules.dimensionId, pcDim.id)))) : [];

  // Overrides for both dimensions, keyed by line.
  const ovrRows = await db.select().from(reportingOverrides).where(eq(reportingOverrides.orgId, orgId!));
  const ovr = (dimId: string, key: string) => ovrRows.find((o) => o.dimensionId === dimId && `${o.txnType}|${o.txnId}|${o.lineId}` === key);

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected", 400);
  const { lines, counts } = await extractSourceLines(token, from, to);

  // Columns = profit-centre values + Unallocated (only when a PC dimension exists).
  const columns = pcDim
    ? [...pcValues.map((v) => ({ id: v.id, name: v.name })), { id: UNALLOC, name: "Unallocated" }]
    : [{ id: "__all__", name: "Total" }];

  // Aggregate detail cells by statement-line CODE × column.
  const cellsByCode: Record<string, Record<string, number>> = {};
  const codeById = new Map(statementLines.map((l) => [l.id, l.code || l.id]));
  let extractedTotal = 0, mappedTotal = 0, unmappedTotal = 0, pcUnallocTotal = 0, conflicts = 0;

  for (const line of lines) {
    extractedTotal += line.amount;
    const key = `${line.txnType}|${line.txnId}|${line.lineId}`;

    // Row: statement line.
    const sOvr = ovr(statementDim.id, key);
    let lineId: string | null;
    if (sOvr) lineId = sOvr.valueId;
    else { const a = classifyDimension(statementDim.id, line, statementRules); if (a.conflict) conflicts++; lineId = a.valueId; }
    if (!lineId) { unmappedTotal += line.amount; continue; }   // not in any P&L line
    const code = codeById.get(lineId);
    if (!code) { unmappedTotal += line.amount; continue; }
    mappedTotal += line.amount;

    // Column: profit centre.
    let col = "__all__";
    if (pcDim) {
      const pOvr = ovr(pcDim.id, key);
      const pc = pOvr ? pOvr.valueId : classifyDimension(pcDim.id, line, pcRules).valueId;
      col = pc ?? UNALLOC;
      if (col === UNALLOC) pcUnallocTotal += line.amount;
    }
    (cellsByCode[code] ??= {})[col] = round2((cellsByCode[code]?.[col] || 0) + line.amount);
  }

  // Build rows in statement order; evaluate computed lines from formulas.
  const rows = statementLines.map((l) => {
    const code = l.code || l.id;
    let cells: Record<string, number> = {};
    if (l.lineKind === "computed" && Array.isArray(l.formula)) {
      for (const part of l.formula as { code: string; op: string }[]) {
        const ref = cellsByCode[part.code] || {};
        for (const c of columns) cells[c.id] = round2((cells[c.id] || 0) + (part.op === "-" ? -1 : 1) * (ref[c.id] || 0));
      }
    } else {
      cells = { ...(cellsByCode[code] || {}) };
    }
    const total = round2(columns.reduce((s, c) => s + (cells[c.id] || 0), 0));
    return { code, name: l.name, lineKind: l.lineKind, cells, total };
  });

  const columnTotals: Record<string, number> = {};
  for (const c of columns) columnTotals[c.id] = round2(rows.filter((r) => r.lineKind === "detail").reduce((s, r) => s + (r.cells[c.id] || 0), 0));

  return ok({
    period: { from, to },
    statement: { id: statementDim.id, name: statementDim.name },
    dimension: pcDim ? { id: pcDim.id, name: pcDim.name } : null,
    columns,
    rows,
    columnTotals,
    reconciliation: {
      extractedTotal: round2(extractedTotal),
      mappedTotal: round2(mappedTotal),
      unmappedToLineTotal: round2(unmappedTotal),   // activity no statement rule matched
      difference: round2(extractedTotal - mappedTotal - unmappedTotal),  // must be 0
      profitCentreUnallocatedTotal: round2(pcUnallocTotal),
      conflicts,
      note: "Rows are your management P&L lines; unmatched activity is shown as 'Not mapped to a P&L line' and reconciles to the extracted total. QBO-official-P&L basis reconciliation (cash/accrual, COGS, tax) is the next refinement.",
    },
    diagnostics: { counts },
  });
}
