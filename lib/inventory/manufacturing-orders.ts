/**
 * Manufacturing Orders — plan, schedule & monitor production jobs. An MO moves
 * Draft → Scheduled → Released → In Progress → Completed (or Cancelled).
 *
 * Multi-output: an MO carries a quantity PER output pack (mo_outputs). Material
 * planning derives the total base FP from the packs (× each pack's base content
 * on the BOM), scales the shared ingredients to it, and computes packaging per
 * pack — all vs on-hand. Completing runs buildProductionMulti (posts the GL &
 * moves stock, allocating cost per pack).
 */

import { db } from "@/db";
import { manufacturingOrders, moOutputs, boms, bomLines, apItems, itemSkus } from "@/db/schema";
import { and, eq, asc, desc, inArray } from "drizzle-orm";
import { LedgerValidationError } from "@/lib/ledger";
import { nextDocNumber } from "@/lib/accounting/numbering";
import { buildProductionMulti } from "@/lib/inventory/production";

const err = (m: string): never => { throw new LedgerValidationError(m); };
const num = (v: any) => Number(v ?? 0);
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const s = (v: any, n = 255) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));

export const MO_STATUSES = ["Draft", "Scheduled", "Released", "InProgress", "Completed", "Cancelled"] as const;
export type MoStatus = (typeof MO_STATUSES)[number];
const TRANSITIONS: Record<MoStatus, MoStatus[]> = {
  Draft: ["Scheduled", "Cancelled"],
  Scheduled: ["Released", "Draft", "Cancelled"],
  Released: ["InProgress", "Scheduled", "Cancelled"],
  InProgress: ["Completed", "Released", "Cancelled"],
  Completed: [],
  Cancelled: ["Draft"],
};

export async function listMOs(orgId: string) {
  const rows = await db.select().from(manufacturingOrders).where(eq(manufacturingOrders.orgId, orgId))
    .orderBy(asc(manufacturingOrders.scheduledDate), desc(manufacturingOrders.createdAt));
  const ids = [...new Set(rows.map(r => r.outputItemId).filter(Boolean) as string[])];
  const items = ids.length ? await db.select({ id: apItems.id, name: apItems.name, baseUom: apItems.baseUom }).from(apItems).where(and(eq(apItems.orgId, orgId), inArray(apItems.id, ids))) : [];
  const byId = new Map(items.map(i => [i.id, i]));
  return rows.map(r => ({ ...r, qty: num(r.qty), outputItem: r.outputItemId ? byId.get(r.outputItemId) ?? null : null }));
}

/** Materials required to produce a set of output packs on a BOM, vs on-hand. */
export async function materialsForOutputs(orgId: string, bomId: string | null, outputs: { skuId: string; qty: number }[]) {
  const empty = { baseTotal: 0, lines: [] as any[], anyShort: false };
  if (!bomId || !outputs.length) return empty;
  const [bom] = await db.select().from(boms).where(and(eq(boms.id, bomId), eq(boms.orgId, orgId))).limit(1);
  if (!bom) return empty;
  const batch = num(bom.batchSize) || 1;
  const lines = await db.select().from(bomLines).where(and(eq(bomLines.orgId, orgId), eq(bomLines.bomId, bomId)));
  const outLines = lines.filter(l => l.role === "output");
  const inLines = lines.filter(l => l.role === "input");
  const packLines = lines.filter(l => l.role === "pack");
  const unitContent = new Map(outLines.map(l => [l.skuId, num(l.qty)]));

  const baseTotal = r4(outputs.reduce((sum, o) => sum + num(o.qty) * (unitContent.get(o.skuId) || 0), 0));
  const factor = batch > 0 ? baseTotal / batch : 0;

  const req = new Map<string, { qty: number; kind: "ingredient" | "packaging" }>();
  for (const l of inLines) { const cur = req.get(l.itemId) ?? { qty: 0, kind: "ingredient" as const }; cur.qty = r4(cur.qty + num(l.qty) * factor); req.set(l.itemId, cur); }
  for (const o of outputs) for (const p of packLines.filter(pl => pl.packagingForSkuId === o.skuId)) {
    const cur = req.get(p.itemId) ?? { qty: 0, kind: "packaging" as const }; cur.qty = r4(cur.qty + num(p.qty) * num(o.qty)); req.set(p.itemId, cur);
  }
  const ids = [...req.keys()];
  const items = ids.length ? await db.select({ id: apItems.id, name: apItems.name, baseUom: apItems.baseUom, onHand: apItems.onHandQty }).from(apItems).where(and(eq(apItems.orgId, orgId), inArray(apItems.id, ids))) : [];
  const byId = new Map(items.map(i => [i.id, i]));
  const outLinesList = ids.map(id => {
    const r = req.get(id)!; const it = byId.get(id); const onHand = num(it?.onHand);
    return { itemId: id, name: it?.name ?? "Item", baseUom: it?.baseUom ?? null, kind: r.kind, required: r.qty, onHand, short: r4(r.qty - onHand), ok: onHand + 0.0001 >= r.qty };
  });
  return { baseTotal, lines: outLinesList, anyShort: outLinesList.some(l => !l.ok) };
}

/** Read an MO's output packs (with SKU names + unit content from the BOM). */
async function outputsForMO(orgId: string, mo: any) {
  const rows = await db.select().from(moOutputs).where(and(eq(moOutputs.orgId, orgId), eq(moOutputs.moId, mo.id))).orderBy(asc(moOutputs.createdAt));
  const skuIds = rows.map(r => r.skuId).filter(Boolean) as string[];
  const skus = skuIds.length ? await db.select().from(itemSkus).where(inArray(itemSkus.id, skuIds)) : [];
  const skuById = new Map(skus.map(s2 => [s2.id, s2]));
  let unitContent = new Map<string, number>();
  if (mo.bomId) {
    const outLines = await db.select().from(bomLines).where(and(eq(bomLines.orgId, orgId), eq(bomLines.bomId, mo.bomId), eq(bomLines.role, "output")));
    unitContent = new Map(outLines.map(l => [l.skuId, num(l.qty)]));
  }
  return rows.map(r => {
    const sku = r.skuId ? skuById.get(r.skuId) : null;
    return { id: r.id, skuId: r.skuId, qty: num(r.qty), skuName: sku?.skuName ?? sku?.skuCode ?? null, unitContent: r.skuId ? (unitContent.get(r.skuId) || 0) : 0 };
  });
}

export async function moDetail(orgId: string, id: string) {
  const [mo] = await db.select().from(manufacturingOrders).where(and(eq(manufacturingOrders.id, id), eq(manufacturingOrders.orgId, orgId))).limit(1);
  if (!mo) return null;
  const [item] = mo.outputItemId ? await db.select({ id: apItems.id, name: apItems.name, baseUom: apItems.baseUom }).from(apItems).where(eq(apItems.id, mo.outputItemId)).limit(1) : [null];
  const outputs = await outputsForMO(orgId, mo);
  const materials = await materialsForOutputs(orgId, mo.bomId, outputs.map(o => ({ skuId: o.skuId!, qty: o.qty })));
  return { mo: { ...mo, qty: num(mo.qty) }, outputItem: item ?? null, outputs, materials };
}

/** Normalise create/edit output packs from the request body. */
function readOutputs(b: any): { skuId: string; qty: number }[] {
  if (Array.isArray(b?.outputs)) return b.outputs.filter((o: any) => o?.skuId && num(o.qty) > 0).map((o: any) => ({ skuId: String(o.skuId), qty: num(o.qty) }));
  if (b?.outputSkuId && num(b?.qty) > 0) return [{ skuId: String(b.outputSkuId), qty: num(b.qty) }];
  return [];
}

export async function createMO(orgId: string, b: any, actorId: string | null) {
  if (!s(b?.outputItemId)) err("Choose the item to produce.");
  const outs = readOutputs(b);
  if (!outs.length) err("Add at least one output pack with a quantity.");
  const mat = await materialsForOutputs(orgId, s(b?.bomId, 64), outs);
  const moNo = await nextDocNumber(orgId, "MO");
  const [row] = await db.insert(manufacturingOrders).values({
    orgId, moNo, bomId: s(b?.bomId, 64) as any, outputItemId: s(b?.outputItemId, 64)!, outputSkuId: outs[0].skuId,
    qty: String(mat.baseTotal || outs.reduce((sm, o) => sm + o.qty, 0)),
    scheduledDate: s(b?.scheduledDate, 16), dueDate: s(b?.dueDate, 16),
    priority: ["Low", "Normal", "High"].includes(b?.priority) ? b.priority : "Normal",
    status: b?.status === "Scheduled" ? "Scheduled" : "Draft", notes: s(b?.notes, 2000), createdBy: actorId,
  } as any).returning();
  await db.insert(moOutputs).values(outs.map(o => ({ orgId, moId: row.id, itemId: s(b?.outputItemId, 64)!, skuId: o.skuId, qty: String(o.qty) })) as any);
  return row;
}

export async function updateMO(orgId: string, id: string, b: any) {
  const [mo] = await db.select().from(manufacturingOrders).where(and(eq(manufacturingOrders.id, id), eq(manufacturingOrders.orgId, orgId))).limit(1);
  if (!mo) err("MO not found.");
  if (mo!.status === "Completed") err("A completed MO can't be edited — void its build first.");
  const set: Record<string, any> = { updatedAt: new Date() };
  if (b.bomId !== undefined) set.bomId = s(b.bomId, 64);
  if (b.outputItemId !== undefined) set.outputItemId = s(b.outputItemId, 64);
  if (b.scheduledDate !== undefined) set.scheduledDate = s(b.scheduledDate, 16);
  if (b.dueDate !== undefined) set.dueDate = s(b.dueDate, 16);
  if (b.priority !== undefined && ["Low", "Normal", "High"].includes(b.priority)) set.priority = b.priority;
  if (b.notes !== undefined) set.notes = s(b.notes, 2000);
  if (Array.isArray(b.outputs)) {
    const outs = readOutputs(b);
    const mat = await materialsForOutputs(orgId, s(b?.bomId, 64) ?? mo!.bomId, outs);
    set.qty = String(mat.baseTotal || 0); set.outputSkuId = outs[0]?.skuId ?? null;
    await db.delete(moOutputs).where(and(eq(moOutputs.orgId, orgId), eq(moOutputs.moId, id)));
    if (outs.length) await db.insert(moOutputs).values(outs.map(o => ({ orgId, moId: id, itemId: (set.outputItemId ?? mo!.outputItemId), skuId: o.skuId, qty: String(o.qty) })) as any);
  }
  await db.update(manufacturingOrders).set(set).where(and(eq(manufacturingOrders.id, id), eq(manufacturingOrders.orgId, orgId)));
  return { id, updated: true };
}

export async function setMoStatus(orgId: string, id: string, status: MoStatus) {
  const [mo] = await db.select().from(manufacturingOrders).where(and(eq(manufacturingOrders.id, id), eq(manufacturingOrders.orgId, orgId))).limit(1);
  if (!mo) err("MO not found.");
  if (status === "Completed") err("Use Complete build to finish an MO.");
  if (!(MO_STATUSES as readonly string[]).includes(status)) err("Unknown status.");
  const allowed = TRANSITIONS[mo!.status as MoStatus] ?? [];
  if (!allowed.includes(status)) err(`Can't move a ${mo!.status} order to ${status}.`);
  await db.update(manufacturingOrders).set({ status, updatedAt: new Date() }).where(and(eq(manufacturingOrders.id, id), eq(manufacturingOrders.orgId, orgId)));
  return { id, status };
}

export async function deleteMO(orgId: string, id: string) {
  const [mo] = await db.select().from(manufacturingOrders).where(and(eq(manufacturingOrders.id, id), eq(manufacturingOrders.orgId, orgId))).limit(1);
  if (!mo) err("MO not found.");
  if (mo!.status === "Completed" || mo!.productionRunId) err("This MO has been built — void the build from Production first.");
  await db.delete(manufacturingOrders).where(and(eq(manufacturingOrders.id, id), eq(manufacturingOrders.orgId, orgId))); // mo_outputs cascade
  return { id, deleted: true };
}

/** Complete an MO by running the multi-output build (FIFO). */
export async function completeMO(orgId: string, id: string, actorId: string | null, opts?: { producedDate?: string }) {
  const [mo] = await db.select().from(manufacturingOrders).where(and(eq(manufacturingOrders.id, id), eq(manufacturingOrders.orgId, orgId))).limit(1);
  if (!mo) err("MO not found.");
  if (mo!.status === "Completed") err("This MO is already completed.");
  if (mo!.status === "Cancelled") err("This MO was cancelled.");
  if (!mo!.bomId) err("This MO has no BOM — a build needs a recipe.");
  const outs = await outputsForMO(orgId, mo!);
  if (!outs.length) err("This MO has no output packs.");

  const res: any = await buildProductionMulti(orgId, {
    bomId: mo!.bomId!, outputs: outs.map(o => ({ skuId: o.skuId!, qty: o.qty })),
    producedDate: opts?.producedDate || mo!.scheduledDate || new Date().toISOString().slice(0, 10),
    moId: id,
  }, actorId);

  if (res.pending) return { id, pending: true, approvalId: res.id, amount: res.amount };

  await db.update(manufacturingOrders).set({ status: "Completed", productionRunId: res.id, updatedAt: new Date() })
    .where(and(eq(manufacturingOrders.id, id), eq(manufacturingOrders.orgId, orgId)));
  return { id, status: "Completed", runId: res.id, runNo: res.runNo, totalCost: res.totalInputCost };
}
