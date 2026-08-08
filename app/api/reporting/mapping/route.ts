/**
 * Account → management-line mapping.
 * A mapping is just a simple account-level rule on the statement dimension:
 *   IF accountId = X THEN line = <detail line>   (priority 100)
 * Class/item split rules created on the Rules screen use higher priority and
 * therefore override this base mapping automatically.
 *
 * GET  → QBO P&L accounts, each with its currently-mapped line + the detail lines.
 * POST { accountId, lineId } → set (or clear, when lineId is null) the mapping.
 */
import { db } from "@/db";
import { reportingDimensions, reportingDimensionValues, reportingRules } from "@/db/schema";
import { and, eq } from "drizzle-orm";
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

// Is this rule a simple "accountId = X" mapping? Returns the accountId or null.
function simpleAccountOf(conditions: any): string | null {
  const c = conditions;
  if (!c || c.op !== "AND" || !Array.isArray(c.conditions) || c.conditions.length !== 1) return null;
  const leaf = c.conditions[0];
  if (leaf?.attribute === "accountId" && leaf?.operator === "eq" && leaf?.value != null) return String(leaf.value);
  return null;
}

async function statementDim(orgId: string) {
  const [dim] = await db.select().from(reportingDimensions)
    .where(and(eq(reportingDimensions.orgId, orgId), eq(reportingDimensions.kind, "statement"))).limit(1);
  return dim ?? null;
}

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const dim = await statementDim(orgId!);
  if (!dim) return ok({ needsSetup: true });

  const lines = (await db.select().from(reportingDimensionValues)
    .where(and(eq(reportingDimensionValues.orgId, orgId!), eq(reportingDimensionValues.dimensionId, dim.id))))
    .filter((l) => l.lineKind === "detail");

  const rules = await db.select().from(reportingRules)
    .where(and(eq(reportingRules.orgId, orgId!), eq(reportingRules.dimensionId, dim.id)));
  const mappedByAccount = new Map<string, string>();
  for (const r of rules) {
    const acctId = simpleAccountOf(r.conditions);
    if (acctId && r.priority === MAP_PRIORITY && r.targetValueId) mappedByAccount.set(acctId, r.targetValueId);
  }

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected", 400);
  const accounts = (await qboQueryAll(token, "Account").catch(() => []))
    .map((a: any) => ({ id: String(a.Id), name: a.Name, number: a.AcctNum, type: a.AccountType, section: sectionOf(a.AccountType) }))
    .filter((a: any) => a.section)
    .map((a: any) => ({ ...a, mappedLineId: mappedByAccount.get(a.id) ?? null }));

  return ok({
    statementId: dim.id,
    lines: lines.map((l) => ({ id: l.id, name: l.name, code: l.code })),
    accounts,
  });
}

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id as string;
  const body = await req.json().catch(() => null);
  const accountId = String(body?.accountId ?? "");
  const lineId = body?.lineId ? String(body.lineId) : null;
  if (!accountId) return bad("accountId is required");

  const dim = await statementDim(orgId!);
  if (!dim) return bad("No statement defined yet", 400);

  // Find an existing base mapping rule for this account.
  const rules = await db.select().from(reportingRules)
    .where(and(eq(reportingRules.orgId, orgId!), eq(reportingRules.dimensionId, dim.id)));
  const existing = rules.find((r) => r.priority === MAP_PRIORITY && simpleAccountOf(r.conditions) === accountId);

  if (!lineId) {
    if (existing) await db.delete(reportingRules).where(eq(reportingRules.id, existing.id));
    return ok({ cleared: true });
  }

  const conditions = { op: "AND", conditions: [{ attribute: "accountId", operator: "eq", value: accountId }] };
  if (existing) {
    await db.update(reportingRules).set({ targetValueId: lineId, conditions, updatedBy: userId, updatedAt: new Date() }).where(eq(reportingRules.id, existing.id));
  } else {
    await db.insert(reportingRules).values({
      orgId: orgId!, dimensionId: dim.id, targetValueId: lineId, priority: MAP_PRIORITY,
      name: `Account map`, conditions, createdBy: userId, updatedBy: userId,
    });
  }
  return ok({ mapped: true });
}
