/**
 * Reporting dimensions API.
 * GET  → all dimensions for the org, each with its values (hierarchy via parentId).
 * POST → create a dimension (optionally with initial values).
 */
import { db } from "@/db";
import { reportingDimensions, reportingDimensionValues } from "@/db/schema";
import { and, eq, asc } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";

export const runtime = "nodejs";

const slugify = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "dimension";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const dims = await db.select().from(reportingDimensions)
    .where(eq(reportingDimensions.orgId, orgId!))
    .orderBy(asc(reportingDimensions.sortOrder), asc(reportingDimensions.name));
  const values = await db.select().from(reportingDimensionValues)
    .where(eq(reportingDimensionValues.orgId, orgId!))
    .orderBy(asc(reportingDimensionValues.sortOrder), asc(reportingDimensionValues.name));

  const byDim = new Map<string, any[]>();
  for (const v of values) {
    const arr = byDim.get(v.dimensionId) ?? [];
    arr.push(v);
    byDim.set(v.dimensionId, arr);
  }

  return ok({ dimensions: dims.map((d) => ({ ...d, values: byDim.get(d.id) ?? [] })) });
}

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? "").trim();
  if (!name) return bad("Dimension name is required");

  const slug = slugify(body?.slug || name);
  const [existing] = await db.select({ id: reportingDimensions.id }).from(reportingDimensions)
    .where(and(eq(reportingDimensions.orgId, orgId!), eq(reportingDimensions.slug, slug))).limit(1);
  if (existing) return bad(`A dimension with key "${slug}" already exists`, 409);

  const [dim] = await db.insert(reportingDimensions).values({
    orgId: orgId!, name, slug,
    description: body?.description ?? null,
    sortOrder: Number(body?.sortOrder) || 0,
  }).returning();

  const names: string[] = Array.isArray(body?.values) ? body.values.map((v: any) => String(v).trim()).filter(Boolean) : [];
  if (names.length) {
    await db.insert(reportingDimensionValues).values(
      names.map((n, i) => ({ orgId: orgId!, dimensionId: dim.id, name: n, sortOrder: i }))
    );
  }
  return ok({ dimension: dim });
}
