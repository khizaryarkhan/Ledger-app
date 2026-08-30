/**
 * GET  /api/inventory/boms   → list bills of material (with output item + line counts)
 * POST /api/inventory/boms   → create a BOM header
 */

import { db } from "@/db";
import { boms, bomLines, apItems } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq, asc, inArray, sql } from "drizzle-orm";

const s = (v: any, n = 255) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));
const numStr = (v: any, d = "0") => (v == null || v === "" || isNaN(Number(v)) ? d : String(Number(v)));

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  const rows = await db.select().from(boms).where(eq(boms.orgId, orgId!)).orderBy(asc(boms.name));
  const outIds = [...new Set(rows.map(r => r.outputItemId).filter(Boolean) as string[])];
  const items = outIds.length ? await db.select({ id: apItems.id, name: apItems.name, productType: apItems.productType }).from(apItems).where(and(eq(apItems.orgId, orgId!), inArray(apItems.id, outIds))) : [];
  const itemById = new Map(items.map(i => [i.id, i]));
  const counts = await db.select({ bomId: bomLines.bomId, role: bomLines.role, c: sql<number>`count(*)::int` })
    .from(bomLines).where(eq(bomLines.orgId, orgId!)).groupBy(bomLines.bomId, bomLines.role);
  const countFor = (id: string, role: string) => counts.find(c => c.bomId === id && c.role === role)?.c ?? 0;
  return ok(rows.map(r => ({
    ...r,
    outputItemName: r.outputItemId ? itemById.get(r.outputItemId)?.name ?? null : null,
    inputCount: countFor(r.id, "input"), outputCount: countFor(r.id, "output"),
  })));
}

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const b = await req.json().catch(() => ({}));
  const name = s(b?.name); if (!name) return bad("A BOM name is required");
  const [row] = await db.insert(boms).values({
    orgId: orgId!, code: s(b?.code, 64), name,
    outputItemId: s(b?.outputItemId, 64) as any,
    outputSkuId: s(b?.outputSkuId, 64) as any,
    status: s(b?.status, 16) || "Active",
    batchType: b?.batchType === "Input" ? "Input" : "Output",
    batchSize: numStr(b?.batchSize, "1"),
    expYield: b?.expYield == null || b?.expYield === "" ? null : numStr(b?.expYield),
    processingStep: s(b?.processingStep, 64),
    notes: s(b?.notes, 2000),
  } as any).returning();
  return ok(row);
}
