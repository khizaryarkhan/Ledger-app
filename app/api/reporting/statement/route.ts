/**
 * Management P&L statement (a dimension with kind = "statement").
 * GET  → the org's statement + its lines (ordered), or { statement: null }.
 * POST → seed the standard template if the org has no statement yet.
 */
import { db } from "@/db";
import { reportingDimensions, reportingDimensionValues } from "@/db/schema";
import { and, eq, asc } from "drizzle-orm";
import { requireOrg, ok } from "@/lib/api";
import { MANAGEMENT_PL_TEMPLATE, STATEMENT_SLUG } from "@/lib/reporting/statement-template";

export const runtime = "nodejs";

async function loadStatement(orgId: string) {
  const [dim] = await db.select().from(reportingDimensions)
    .where(and(eq(reportingDimensions.orgId, orgId), eq(reportingDimensions.kind, "statement")))
    .limit(1);
  if (!dim) return null;
  const lines = await db.select().from(reportingDimensionValues)
    .where(and(eq(reportingDimensionValues.orgId, orgId), eq(reportingDimensionValues.dimensionId, dim.id)))
    .orderBy(asc(reportingDimensionValues.sortOrder));
  return { statement: dim, lines };
}

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  return ok((await loadStatement(orgId!)) ?? { statement: null, lines: [] });
}

export async function POST() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const existing = await loadStatement(orgId!);
  if (existing) return ok(existing);   // idempotent

  const [dim] = await db.insert(reportingDimensions).values({
    orgId: orgId!, name: "Management P&L", slug: STATEMENT_SLUG, kind: "statement", sortOrder: -1,
    description: "Your management-reporting P&L layout. QBO accounts map into these lines.",
  }).returning();

  await db.insert(reportingDimensionValues).values(
    MANAGEMENT_PL_TEMPLATE.map((l, i) => ({
      orgId: orgId!, dimensionId: dim.id, name: l.name, code: l.code,
      lineKind: l.lineKind, sign: l.sign, formula: l.formula ?? null, sortOrder: (i + 1) * 10,
    }))
  );
  return ok((await loadStatement(orgId!))!);
}
