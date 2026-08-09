/**
 * Account mapping — the single place mapping happens (the grid IS the rules
 * editor). Per QBO account it sets, as base rules (priority 100):
 *   - Management P&L line  → rule on the statement dimension
 *   - Profit Centre        → rule on the profit-centre dimension
 * Class/field sub-rules (higher priority, added next) override these.
 *
 * GET  → P&L accounts with current line + PC, plus the line + PC option lists.
 * POST { accountIds[], lineId?, pcId? } → set/clear either axis for one or many
 *        accounts (batch classify). `undefined` = leave that axis untouched;
 *        `null` = clear it.
 */
import { db } from "@/db";
import { reportingDimensions, reportingDimensionValues, reportingRules } from "@/db/schema";
import { and, eq, ne, asc } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";
import { getOrgQboToken } from "@/lib/qbo-token";
import { qboQueryAll } from "@/lib/batch/qbo-client";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAP_PRIORITY = 100;

function sectionOf(type?: string): string | null {
  const t = (type || "").toLowerCase();
  if (t.includes("cost of goods")) return "Cost of Sales";
  if (t.includes("income") || t.includes("revenue")) return t.includes("other") ? "Other Income" : "Income";
  if (t.includes("expense")) return t.includes("other") ? "Other Expense" : "Expenses";
  return null;
}

// Simple "accountId = X" base-mapping rule? → the accountId, else null.
function simpleAccountOf(conditions: any): string | null {
  const c = conditions;
  if (!c || c.op !== "AND" || !Array.isArray(c.conditions) || c.conditions.length !== 1) return null;
  const leaf = c.conditions[0];
  return leaf?.attribute === "accountId" && leaf?.operator === "eq" && leaf?.value != null ? String(leaf.value) : null;
}

async function dims(orgId: string) {
  const [statement] = await db.select().from(reportingDimensions)
    .where(and(eq(reportingDimensions.orgId, orgId), eq(reportingDimensions.kind, "statement"))).limit(1);
  const others = await db.select().from(reportingDimensions)
    .where(and(eq(reportingDimensions.orgId, orgId), ne(reportingDimensions.kind, "statement")))
    .orderBy(asc(reportingDimensions.sortOrder));
  return { statement: statement ?? null, pc: others[0] ?? null };
}

// Upsert (or clear when valueId is null) the base account→value rule for a dim.
async function setBaseRule(orgId: string, userId: string, dimId: string, accountId: string, valueId: string | null) {
  const rules = await db.select().from(reportingRules)
    .where(and(eq(reportingRules.orgId, orgId), eq(reportingRules.dimensionId, dimId)));
  const existing = rules.find((r) => r.priority === MAP_PRIORITY && simpleAccountOf(r.conditions) === accountId);
  if (!valueId) { if (existing) await db.delete(reportingRules).where(eq(reportingRules.id, existing.id)); return; }
  const conditions = { op: "AND", conditions: [{ attribute: "accountId", operator: "eq", value: accountId }] };
  if (existing) await db.update(reportingRules).set({ targetValueId: valueId, conditions, updatedBy: userId, updatedAt: new Date() }).where(eq(reportingRules.id, existing.id));
  else await db.insert(reportingRules).values({ orgId, dimensionId: dimId, targetValueId: valueId, priority: MAP_PRIORITY, name: "Account map", conditions, createdBy: userId, updatedBy: userId });
}

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { statement, pc } = await dims(orgId!);
  if (!statement) return ok({ needsSetup: true });

  const lineRows = (await db.select().from(reportingDimensionValues)
    .where(and(eq(reportingDimensionValues.orgId, orgId!), eq(reportingDimensionValues.dimensionId, statement.id)))
    .orderBy(asc(reportingDimensionValues.sortOrder))).filter((l) => l.lineKind === "detail");
  const pcValues = pc ? await db.select().from(reportingDimensionValues)
    .where(and(eq(reportingDimensionValues.orgId, orgId!), eq(reportingDimensionValues.dimensionId, pc.id)))
    .orderBy(asc(reportingDimensionValues.sortOrder)) : [];

  // Current base mappings for each axis.
  const allRules = await db.select().from(reportingRules).where(eq(reportingRules.orgId, orgId!));
  const lineByAcct = new Map<string, string>(), pcByAcct = new Map<string, string>();
  for (const r of allRules) {
    if (r.priority !== MAP_PRIORITY || !r.targetValueId) continue;
    const acctId = simpleAccountOf(r.conditions);
    if (!acctId) continue;
    if (r.dimensionId === statement.id) lineByAcct.set(acctId, r.targetValueId);
    else if (pc && r.dimensionId === pc.id) pcByAcct.set(acctId, r.targetValueId);
  }

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected", 400);
  const accounts = (await qboQueryAll(token, "Account").catch(() => []))
    .map((a: any) => ({ id: String(a.Id), name: a.Name, number: a.AcctNum, type: a.AccountType, section: sectionOf(a.AccountType) }))
    .filter((a: any) => a.section)
    .map((a: any) => ({ ...a, mappedLineId: lineByAcct.get(a.id) ?? null, mappedPcId: pcByAcct.get(a.id) ?? null }));

  return ok({
    statementId: statement.id,
    profitCentre: pc ? { id: pc.id, name: pc.name } : null,
    lines: lineRows.map((l) => ({ id: l.id, name: l.name })),
    profitCentres: pcValues.map((v) => ({ id: v.id, name: v.name })),
    accounts,
  });
}

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id as string;
  const body = await req.json().catch(() => null);
  const accountIds: string[] = Array.isArray(body?.accountIds) ? body.accountIds.map(String)
    : body?.accountId ? [String(body.accountId)] : [];
  if (accountIds.length === 0) return bad("accountIds is required");

  const { statement, pc } = await dims(orgId!);
  if (!statement) return bad("No statement defined yet", 400);

  for (const accountId of accountIds) {
    if (body.lineId !== undefined) await setBaseRule(orgId!, userId, statement.id, accountId, body.lineId || null);
    if (body.pcId !== undefined && pc) await setBaseRule(orgId!, userId, pc.id, accountId, body.pcId || null);
  }
  return ok({ updated: accountIds.length });
}
