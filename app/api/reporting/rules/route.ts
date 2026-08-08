/**
 * Classification rules API.
 * GET  → all rules for the org (optionally ?dimensionId=), highest priority first.
 * POST → create a rule (IF conditions THEN dimension = targetValue).
 */
import { db } from "@/db";
import { reportingRules, reportingDimensions, reportingDimensionValues } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const dimId = new URL(req.url).searchParams.get("dimensionId");
  const where = dimId
    ? and(eq(reportingRules.orgId, orgId!), eq(reportingRules.dimensionId, dimId))
    : eq(reportingRules.orgId, orgId!);
  const rules = await db.select().from(reportingRules).where(where).orderBy(desc(reportingRules.priority));
  return ok({ rules });
}

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id as string;
  const body = await req.json().catch(() => null);

  const dimensionId = String(body?.dimensionId ?? "");
  const targetValueId = body?.targetValueId ? String(body.targetValueId) : null;
  if (!dimensionId) return bad("dimensionId is required");
  if (!targetValueId) return bad("A target value is required");

  // Validate dimension + value belong to this org and to each other.
  const [dim] = await db.select({ id: reportingDimensions.id }).from(reportingDimensions)
    .where(and(eq(reportingDimensions.id, dimensionId), eq(reportingDimensions.orgId, orgId!))).limit(1);
  if (!dim) return bad("Dimension not found", 404);
  const [val] = await db.select({ id: reportingDimensionValues.id }).from(reportingDimensionValues)
    .where(and(eq(reportingDimensionValues.id, targetValueId), eq(reportingDimensionValues.orgId, orgId!), eq(reportingDimensionValues.dimensionId, dimensionId))).limit(1);
  if (!val) return bad("Target value does not belong to this dimension", 400);

  const conditions = body?.conditions ?? { op: "AND", conditions: [] };

  const [rule] = await db.insert(reportingRules).values({
    orgId: orgId!, dimensionId, targetValueId,
    name: body?.name ?? null,
    description: body?.description ?? null,
    priority: Number(body?.priority) || 100,
    conditions,
    active: body?.active === undefined ? true : !!body.active,
    effectiveFrom: body?.effectiveFrom || null,
    effectiveTo: body?.effectiveTo || null,
    createdBy: userId, updatedBy: userId,
  }).returning();
  return ok({ rule });
}
