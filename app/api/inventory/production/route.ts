/**
 * GET  /api/inventory/production   → list production runs
 * POST /api/inventory/production   → run a build (consume input lots → produce output)
 */

import { db } from "@/db";
import { productionRuns, apItems } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, desc, inArray } from "drizzle-orm";
import { buildProduction, type ProductionInput } from "@/lib/inventory/production";
import { LedgerValidationError } from "@/lib/ledger";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const rows = await db.select().from(productionRuns).where(eq(productionRuns.orgId, orgId!)).orderBy(desc(productionRuns.createdAt)).limit(200);
  const ids = [...new Set(rows.map(r => r.outputItemId).filter(Boolean) as string[])];
  const items = ids.length ? await db.select({ id: apItems.id, name: apItems.name, baseUom: apItems.baseUom }).from(apItems).where(and(eq(apItems.orgId, orgId!), inArray(apItems.id, ids))) : [];
  const byId = new Map(items.map(i => [i.id, i]));
  return ok(rows.map(r => ({ ...r, outputItem: r.outputItemId ? byId.get(r.outputItemId) ?? null : null })));
}

export async function POST(req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const body = (await req.json().catch(() => ({}))) as ProductionInput;
  try {
    const res = await buildProduction(orgId!, body, (session?.user as any)?.id ?? null);
    return ok(res);
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[production] build failed:", e);
    return bad("Failed to run production build", 500);
  }
}
