/** Create a dimension value (member), optionally under a parent (hierarchy). */
import { db } from "@/db";
import { reportingDimensions, reportingDimensionValues } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const body = await req.json().catch(() => null);
  const dimensionId = String(body?.dimensionId ?? "");
  const name = String(body?.name ?? "").trim();
  if (!dimensionId || !name) return bad("dimensionId and name are required");

  // Ensure the dimension belongs to this org.
  const [dim] = await db.select({ id: reportingDimensions.id }).from(reportingDimensions)
    .where(and(eq(reportingDimensions.id, dimensionId), eq(reportingDimensions.orgId, orgId!))).limit(1);
  if (!dim) return bad("Dimension not found", 404);

  const [val] = await db.insert(reportingDimensionValues).values({
    orgId: orgId!, dimensionId, name,
    code: body?.code ?? null,
    parentId: body?.parentId ?? null,
    sortOrder: Number(body?.sortOrder) || 0,
  }).returning();
  return ok({ value: val });
}
