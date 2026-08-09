/**
 * Account mapping — the grid IS the rules editor. Per QBO account:
 *   - a DEFAULT mapping: account → Management line + Profit Centre, and
 *   - optional SPLIT sub-mappings: account + <field>=<value> → line + PC,
 *     where <field> is user-chosen (Class, Location, Customer, Item, …).
 * Splits are higher priority (200) than the default (100), so the engine
 * applies the most specific match automatically.
 *
 * Stored as engine rules on the statement dimension (line) and profit-centre
 * dimension (PC); a line-rule and pc-rule that share identical conditions are a
 * single grid mapping. No schema change — the report already reads these rules.
 *
 * GET  → accounts (default + splits), the line/PC option lists, and the
 *        splittable fields with their value lists.
 * POST → upsert/clear a mapping (default or a specific split), one or many
 *        accounts (batch). Body: { accountIds[], lineId?, pcId?,
 *        split?: { attribute, value, label? } }.
 */
import { db } from "@/db";
import { reportingDimensions, reportingDimensionValues, reportingRules } from "@/db/schema";
import { and, eq, ne, asc } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";
import { getOrgQboToken } from "@/lib/qbo-token";
import { qboQueryAll } from "@/lib/batch/qbo-client";

export const runtime = "nodejs";
export const maxDuration = 60;

const BASE_PRIORITY = 100;
const SPLIT_PRIORITY = 200;

const SPLIT_FIELDS = [
  { attribute: "classId",    label: "Class",    entity: "Class" },
  { attribute: "locationId", label: "Location", entity: "Department" },
  { attribute: "customerId", label: "Customer", entity: "Customer" },
  { attribute: "itemId",     label: "Item",     entity: "Item" },
];

function sectionOf(type?: string): string | null {
  const t = (type || "").toLowerCase();
  if (t.includes("cost of goods")) return "Cost of Sales";
  if (t.includes("income") || t.includes("revenue")) return t.includes("other") ? "Other Income" : "Income";
  if (t.includes("expense")) return t.includes("other") ? "Other Expense" : "Expenses";
  return null;
}

// Parse an account-mapping rule's conditions → { accountId, splitAttr?, splitValue? }.
// Recognises "accountId = A" and optionally one extra "<attr> = <value>" leaf.
function parseMapping(conditions: any): { accountId: string; splitAttr?: string; splitValue?: string } | null {
  const c = conditions;
  if (!c || c.op !== "AND" || !Array.isArray(c.conditions) || c.conditions.length < 1 || c.conditions.length > 2) return null;
  const acct = c.conditions.find((l: any) => l.attribute === "accountId" && l.operator === "eq");
  if (!acct?.value) return null;
  const other = c.conditions.find((l: any) => l.attribute !== "accountId");
  if (c.conditions.length === 2 && !(other && other.operator === "eq" && other.value != null)) return null;
  return { accountId: String(acct.value), splitAttr: other?.attribute, splitValue: other?.value != null ? String(other.value) : undefined };
}
function condSig(conditions: any): string {
  const leaves = (conditions?.conditions ?? []).map((l: any) => `${l.attribute}:${l.operator}:${l.value}`).sort();
  return `${conditions?.op}|${leaves.join("&")}`;
}
function buildConditions(accountId: string, split?: { attribute: string; value: string }) {
  const leaves: any[] = [{ attribute: "accountId", operator: "eq", value: accountId }];
  if (split) leaves.push({ attribute: split.attribute, operator: "eq", value: split.value });
  return { op: "AND", conditions: leaves };
}

async function dims(orgId: string) {
  const [statement] = await db.select().from(reportingDimensions)
    .where(and(eq(reportingDimensions.orgId, orgId), eq(reportingDimensions.kind, "statement"))).limit(1);
  const others = await db.select().from(reportingDimensions)
    .where(and(eq(reportingDimensions.orgId, orgId), ne(reportingDimensions.kind, "statement"))).orderBy(asc(reportingDimensions.sortOrder));
  return { statement: statement ?? null, pc: others[0] ?? null };
}

// Upsert (or clear) a rule identified by (dim, conditions, priority).
async function setRule(orgId: string, userId: string, dimId: string, conditions: any, priority: number, valueId: string | null) {
  const rules = await db.select().from(reportingRules).where(and(eq(reportingRules.orgId, orgId), eq(reportingRules.dimensionId, dimId)));
  const sig = condSig(conditions);
  const existing = rules.find((r) => r.priority === priority && condSig(r.conditions) === sig);
  if (!valueId) { if (existing) await db.delete(reportingRules).where(eq(reportingRules.id, existing.id)); return; }
  if (existing) await db.update(reportingRules).set({ targetValueId: valueId, conditions, updatedBy: userId, updatedAt: new Date() }).where(eq(reportingRules.id, existing.id));
  else await db.insert(reportingRules).values({ orgId, dimensionId: dimId, targetValueId: valueId, priority, name: "Account map", conditions, createdBy: userId, updatedBy: userId });
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

  // Reconstruct default + split mappings per account from the rules.
  const allRules = await db.select().from(reportingRules).where(eq(reportingRules.orgId, orgId!));
  type Split = { attribute: string; value: string; lineId?: string; pcId?: string };
  const def = new Map<string, { lineId?: string; pcId?: string }>();
  const splits = new Map<string, Map<string, Split>>();  // accountId → key(attr|value) → split
  for (const r of allRules) {
    if (!r.targetValueId) continue;
    const m = parseMapping(r.conditions);
    if (!m) continue;
    const isLine = r.dimensionId === statement.id;
    const isPc = pc && r.dimensionId === pc.id;
    if (!isLine && !isPc) continue;
    if (!m.splitAttr) {
      const d = def.get(m.accountId) ?? {}; if (isLine) d.lineId = r.targetValueId; else d.pcId = r.targetValueId; def.set(m.accountId, d);
    } else {
      const bucket = splits.get(m.accountId) ?? new Map(); splits.set(m.accountId, bucket);
      const key = `${m.splitAttr}|${m.splitValue}`;
      const s = bucket.get(key) ?? { attribute: m.splitAttr, value: m.splitValue! };
      if (isLine) s.lineId = r.targetValueId; else s.pcId = r.targetValueId; bucket.set(key, s);
    }
  }

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected", 400);
  const accounts = (await qboQueryAll(token, "Account").catch(() => []))
    .map((a: any) => ({ id: String(a.Id), name: a.Name, number: a.AcctNum, type: a.AccountType, section: sectionOf(a.AccountType) }))
    .filter((a: any) => a.section)
    .map((a: any) => ({
      ...a,
      mappedLineId: def.get(a.id)?.lineId ?? null,
      mappedPcId: def.get(a.id)?.pcId ?? null,
      splits: [...(splits.get(a.id)?.values() ?? [])],
    }));

  // Splittable fields + their value lists (id → name), for the sub-row pickers.
  const fields = await Promise.all(SPLIT_FIELDS.map(async (f) => {
    const recs = await qboQueryAll(token, f.entity).catch(() => []);
    return { attribute: f.attribute, label: f.label, values: recs.map((r: any) => ({ id: String(r.Id), name: r.FullyQualifiedName || r.DisplayName || r.Name })).sort((a: any, b: any) => a.name.localeCompare(b.name)) };
  }));

  return ok({
    statementId: statement.id,
    profitCentre: pc ? { id: pc.id, name: pc.name } : null,
    lines: lineRows.map((l) => ({ id: l.id, name: l.name })),
    profitCentres: pcValues.map((v) => ({ id: v.id, name: v.name })),
    fields,
    accounts,
  });
}

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id as string;
  const body = await req.json().catch(() => null);
  const accountIds: string[] = Array.isArray(body?.accountIds) ? body.accountIds.map(String) : body?.accountId ? [String(body.accountId)] : [];
  if (accountIds.length === 0) return bad("accountIds is required");

  const { statement, pc } = await dims(orgId!);
  if (!statement) return bad("No statement defined yet", 400);

  const split = body?.split && body.split.attribute && body.split.value ? { attribute: String(body.split.attribute), value: String(body.split.value) } : undefined;
  const priority = split ? SPLIT_PRIORITY : BASE_PRIORITY;

  for (const accountId of accountIds) {
    const conditions = buildConditions(accountId, split);
    if (body.lineId !== undefined) await setRule(orgId!, userId, statement.id, conditions, priority, body.lineId || null);
    if (body.pcId !== undefined && pc) await setRule(orgId!, userId, pc.id, conditions, priority, body.pcId || null);
  }
  return ok({ updated: accountIds.length });
}
