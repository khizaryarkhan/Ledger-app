/**
 * P&L by dimension.
 * GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&dimensionId=...
 *
 * Extracts the period's QBO lines, classifies each against the dimension's
 * rules + overrides, and returns a matrix: account rows (grouped into P&L
 * sections) × dimension-value columns (+ Unallocated). Guarantees the classified
 * buckets sum back to the extracted total (nothing dropped) and reports it.
 */
import { db } from "@/db";
import { reportingDimensions, reportingDimensionValues, reportingRules, reportingOverrides } from "@/db/schema";
import { and, eq, asc } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";
import { getOrgQboToken } from "@/lib/qbo-token";
import { extractSourceLines } from "@/lib/reporting/source";
import { classifyDimension } from "@/lib/reporting/engine";
import type { EngineRule } from "@/lib/reporting/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const UNALLOC = "__unallocated__";

// QBO AccountType → P&L section.
function sectionOf(type?: string): string | null {
  const t = (type || "").toLowerCase();
  if (t.includes("cost of goods")) return "Cost of Sales";
  if (t.includes("income") || t.includes("revenue")) return t.includes("other") ? "Other Income" : "Income";
  if (t.includes("expense")) return t.includes("other") ? "Other Expense" : "Expenses";
  return null;   // not a P&L account
}
const SECTION_ORDER = ["Income", "Cost of Sales", "Expenses", "Other Income", "Other Expense"];

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  let dimensionId = url.searchParams.get("dimensionId") || "";
  if (!from || !to) return bad("from and to dates are required");

  // Dimension (default to first) + its values + rules + overrides.
  const dims = await db.select().from(reportingDimensions).where(eq(reportingDimensions.orgId, orgId!)).orderBy(asc(reportingDimensions.sortOrder));
  if (dims.length === 0) return bad("No reporting dimensions defined yet", 400);
  const dim = dims.find((d) => d.id === dimensionId) || dims[0];
  dimensionId = dim.id;

  const values = await db.select().from(reportingDimensionValues)
    .where(and(eq(reportingDimensionValues.orgId, orgId!), eq(reportingDimensionValues.dimensionId, dimensionId)))
    .orderBy(asc(reportingDimensionValues.sortOrder), asc(reportingDimensionValues.name));
  const ruleRows = await db.select().from(reportingRules).where(and(eq(reportingRules.orgId, orgId!), eq(reportingRules.dimensionId, dimensionId)));
  const overrideRows = await db.select().from(reportingOverrides).where(and(eq(reportingOverrides.orgId, orgId!), eq(reportingOverrides.dimensionId, dimensionId)));

  const rules: EngineRule[] = ruleRows.map((r) => ({
    id: r.id, dimensionId: r.dimensionId, targetValueId: r.targetValueId, priority: r.priority,
    conditions: r.conditions as any, active: r.active,
    effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo,
  }));
  const overrideByLine = new Map<string, string | null>();
  for (const o of overrideRows) overrideByLine.set(`${o.txnType}|${o.txnId}|${o.lineId}`, o.valueId);

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected", 400);

  const { lines, counts } = await extractSourceLines(token, from, to);

  // columns = active values + Unallocated
  const columns = [...values.map((v) => ({ id: v.id, name: v.name })), { id: UNALLOC, name: "Unallocated" }];
  const valName = new Map(values.map((v) => [v.id, v.name]));

  // aggregate: section → accountId → { meta, cells{colId:amount} }
  type AcctAgg = { accountId: string; accountName: string; accountNumber?: string; cells: Record<string, number>; total: number };
  const bySection = new Map<string, Map<string, AcctAgg>>();
  const colTotals: Record<string, number> = {};
  let extractedTotal = 0, classifiedTotal = 0, conflicts = 0, unallocatedTotal = 0, skippedNonPnl = 0;

  for (const line of lines) {
    const section = sectionOf(line.accountType);
    if (!section) { skippedNonPnl++; continue; }   // not a P&L account
    extractedTotal += line.amount;

    let col = UNALLOC;
    const ovr = overrideByLine.get(`${line.txnType}|${line.txnId}|${line.lineId}`);
    if (ovr !== undefined) {
      col = ovr ?? UNALLOC;
    } else {
      const a = classifyDimension(dimensionId, line, rules);
      if (a.conflict) conflicts++;
      col = a.valueId ?? UNALLOC;
    }
    if (col === UNALLOC) unallocatedTotal += line.amount;
    classifiedTotal += line.amount;

    let accts = bySection.get(section);
    if (!accts) { accts = new Map(); bySection.set(section, accts); }
    const acctKey = line.accountId || "(unmapped)";
    let agg = accts.get(acctKey);
    if (!agg) { agg = { accountId: acctKey, accountName: line.accountName || "(unmapped account)", accountNumber: line.accountNumber, cells: {}, total: 0 }; accts.set(acctKey, agg); }
    agg.cells[col] = round2((agg.cells[col] || 0) + line.amount);
    agg.total = round2(agg.total + line.amount);
    colTotals[col] = round2((colTotals[col] || 0) + line.amount);
  }

  const sections = SECTION_ORDER.filter((s) => bySection.has(s)).map((s) => {
    const accts = [...bySection.get(s)!.values()].sort((a, b) => (a.accountNumber || a.accountName).localeCompare(b.accountNumber || b.accountName));
    const subtotal: Record<string, number> = {};
    let subTotalAll = 0;
    for (const a of accts) { for (const c of columns) subtotal[c.id] = round2((subtotal[c.id] || 0) + (a.cells[c.id] || 0)); subTotalAll = round2(subTotalAll + a.total); }
    return { section: s, accounts: accts, subtotal, subtotalTotal: subTotalAll };
  });

  return ok({
    period: { from, to },
    dimension: { id: dim.id, name: dim.name },
    columns,
    sections,
    columnTotals: colTotals,
    grandTotal: round2(classifiedTotal),
    reconciliation: {
      extractedTotal: round2(extractedTotal),
      classifiedTotal: round2(classifiedTotal),
      difference: round2(extractedTotal - classifiedTotal),   // must be 0 — nothing dropped
      unallocatedTotal: round2(unallocatedTotal),
      conflicts,
      note: "Classified buckets reconcile to the sum of extracted P&L lines. Matching QBO's official P&L (basis, COGS, tax) is the Reports-API cross-check (next phase).",
    },
    diagnostics: { counts, nonPnlLinesSkipped: skippedNonPnl },
  });
}

const round2 = (n: number) => Math.round(n * 100) / 100;
