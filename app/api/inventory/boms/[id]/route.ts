/**
 * GET    /api/inventory/boms/[id]  → BOM header + its input/output lines
 * PATCH  /api/inventory/boms/[id]  → update header
 * DELETE /api/inventory/boms/[id]  → delete BOM (lines cascade)
 */

import { db } from "@/db";
import { boms, bomLines, apItems, itemSkus } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, asc, inArray } from "drizzle-orm";
import { bomReferences, blockerMessage } from "@/lib/inventory/references";
import { NextResponse } from "next/server";

const s = (v: any, n = 255) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));
const numStr = (v: any) => (v == null || v === "" || isNaN(Number(v)) ? null : String(Number(v)));

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const [bom] = await db.select().from(boms).where(and(eq(boms.id, params.id), eq(boms.orgId, orgId!))).limit(1);
  if (!bom) return bad("BOM not found", 404);
  const lines = await db.select().from(bomLines).where(eq(bomLines.bomId, params.id)).orderBy(asc(bomLines.sortOrder), asc(bomLines.createdAt));
  const ids = [...new Set(lines.map(l => l.itemId).filter(Boolean) as string[])];
  const items = ids.length ? await db.select({ id: apItems.id, name: apItems.name, code: apItems.code, productType: apItems.productType, baseUom: apItems.baseUom }).from(apItems).where(and(eq(apItems.orgId, orgId!), inArray(apItems.id, ids))) : [];
  const byId = new Map(items.map(i => [i.id, i]));
  const decorate = (l: any) => ({ ...l, item: byId.get(l.itemId) ?? null });
  // SKUs of the output item, so the UI can pick which packaging this BOM makes.
  const outputSkus = bom.outputItemId
    ? await db.select().from(itemSkus).where(and(eq(itemSkus.orgId, orgId!), eq(itemSkus.itemId, bom.outputItemId))).orderBy(asc(itemSkus.createdAt))
    : [];
  return ok({
    bom,
    outputSkus,
    outputs: lines.filter(l => l.role === "output").map(decorate),
    inputs: lines.filter(l => l.role === "input").map(decorate),
  });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const b = await req.json().catch(() => ({}));
  const set: Record<string, any> = { updatedAt: new Date() };
  if (b.code !== undefined) set.code = s(b.code, 64);
  if (b.name !== undefined) set.name = s(b.name);
  if (b.outputItemId !== undefined) set.outputItemId = s(b.outputItemId, 64);
  if (b.outputSkuId !== undefined) set.outputSkuId = s(b.outputSkuId, 64);
  if (b.status !== undefined) set.status = s(b.status, 16);
  if (b.batchType !== undefined) set.batchType = b.batchType === "Input" ? "Input" : "Output";
  if (b.batchSize !== undefined) set.batchSize = numStr(b.batchSize) ?? "1";
  if (b.expYield !== undefined) set.expYield = numStr(b.expYield);
  if (b.processingStep !== undefined) set.processingStep = s(b.processingStep, 64);
  if (b.notes !== undefined) set.notes = s(b.notes, 2000);
  await db.update(boms).set(set).where(and(eq(boms.id, params.id), eq(boms.orgId, orgId!)));
  return ok({ id: params.id, updated: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const blockers = await bomReferences(orgId!, params.id);
  if (blockers.length) return NextResponse.json({ error: blockerMessage("BOM", blockers), blockers }, { status: 409 });
  await db.delete(boms).where(and(eq(boms.id, params.id), eq(boms.orgId, orgId!)));
  return ok({ id: params.id, deleted: true });
}
