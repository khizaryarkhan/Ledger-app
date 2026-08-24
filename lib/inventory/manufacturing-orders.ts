/**
 * Manufacturing Orders — plan, schedule & monitor production jobs. An MO moves
 * Draft → Scheduled → Released → In Progress → Completed (or Cancelled).
 * Completing it runs a production build (lib/inventory/production.buildProduction)
 * which consumes input lots, produces the output and posts the GL — so the MO
 * is the planning/monitoring wrapper over the existing execution engine.
 */

import { db } from "@/db";
import { manufacturingOrders, boms, bomLines, apItems } from "@/db/schema";
import { and, eq, asc, desc, inArray } from "drizzle-orm";
import { LedgerValidationError } from "@/lib/ledger";
import { nextDocNumber } from "@/lib/accounting/numbering";
import { buildProduction } from "@/lib/inventory/production";

const err = (m: string): never => { throw new LedgerValidationError(m); };
const num = (v: any) => Number(v ?? 0);
const s = (v: any, n = 255) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));

export const MO_STATUSES = ["Draft", "Scheduled", "Released", "InProgress", "Completed", "Cancelled"] as const;
export type MoStatus = (typeof MO_STATUSES)[number];
// Allowed forward/back transitions (Completed is terminal — void the build to undo).
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

/** Required input materials (BOM scaled to the MO qty) vs current on-hand. */
export async function materialAvailability(orgId: string, bomId: string | null, qty: number) {
  if (!bomId) return { lines: [] as any[], anyShort: false };
  const [bom] = await db.select().from(boms).where(and(eq(boms.id, bomId), eq(boms.orgId, orgId))).limit(1);
  if (!bom) return { lines: [], anyShort: false };
  const batch = num(bom.batchSize) || 1;
  const factor = batch > 0 ? qty / batch : 0;
  const inputs = await db.select().from(bomLines).where(and(eq(bomLines.orgId, orgId), eq(bomLines.bomId, bomId), eq(bomLines.role, "input")));
  const itemIds = [...new Set(inputs.map(l => l.itemId))];
  const items = itemIds.length ? await db.select({ id: apItems.id, name: apItems.name, baseUom: apItems.baseUom, onHand: apItems.onHandQty }).from(apItems).where(and(eq(apItems.orgId, orgId), inArray(apItems.id, itemIds))) : [];
  const byId = new Map(items.map(i => [i.id, i]));
  const lines = inputs.map(l => {
    const required = Math.round(num(l.qty) * factor * 1e4) / 1e4;
    const it = byId.get(l.itemId);
    const onHand = num(it?.onHand);
    return { itemId: l.itemId, name: it?.name ?? "Item", baseUom: it?.baseUom ?? l.uom ?? null, required, onHand, short: Math.round((required - onHand) * 1e4) / 1e4, ok: onHand + 0.0001 >= required };
  });
  return { lines, anyShort: lines.some(l => !l.ok) };
}

export async function moDetail(orgId: string, id: string) {
  const [mo] = await db.select().from(manufacturingOrders).where(and(eq(manufacturingOrders.id, id), eq(manufacturingOrders.orgId, orgId))).limit(1);
  if (!mo) return null;
  const [item] = mo.outputItemId ? await db.select({ id: apItems.id, name: apItems.name, baseUom: apItems.baseUom }).from(apItems).where(eq(apItems.id, mo.outputItemId)).limit(1) : [null];
  const materials = await materialAvailability(orgId, mo.bomId, num(mo.qty));
  return { mo: { ...mo, qty: num(mo.qty) }, outputItem: item ?? null, materials };
}

export async function createMO(orgId: string, b: any, actorId: string | null) {
  if (!s(b?.outputItemId)) err("Choose the item to produce.");
  if (!(num(b?.qty) > 0)) err("Enter a quantity to produce.");
  const moNo = await nextDocNumber(orgId, "MO");
  const [row] = await db.insert(manufacturingOrders).values({
    orgId, moNo, bomId: s(b?.bomId, 64) as any, outputItemId: s(b?.outputItemId, 64)!, outputSkuId: s(b?.outputSkuId, 64) as any,
    qty: String(num(b?.qty)), scheduledDate: s(b?.scheduledDate, 16), dueDate: s(b?.dueDate, 16),
    priority: ["Low", "Normal", "High"].includes(b?.priority) ? b.priority : "Normal",
    status: b?.status === "Scheduled" ? "Scheduled" : "Draft", notes: s(b?.notes, 2000), createdBy: actorId,
  } as any).returning();
  return row;
}

export async function updateMO(orgId: string, id: string, b: any) {
  const [mo] = await db.select().from(manufacturingOrders).where(and(eq(manufacturingOrders.id, id), eq(manufacturingOrders.orgId, orgId))).limit(1);
  if (!mo) err("MO not found.");
  if (mo!.status === "Completed") err("A completed MO can't be edited — void its build first.");
  const set: Record<string, any> = { updatedAt: new Date() };
  if (b.bomId !== undefined) set.bomId = s(b.bomId, 64);
  if (b.outputItemId !== undefined) set.outputItemId = s(b.outputItemId, 64);
  if (b.outputSkuId !== undefined) set.outputSkuId = s(b.outputSkuId, 64);
  if (b.qty !== undefined) set.qty = String(num(b.qty));
  if (b.scheduledDate !== undefined) set.scheduledDate = s(b.scheduledDate, 16);
  if (b.dueDate !== undefined) set.dueDate = s(b.dueDate, 16);
  if (b.priority !== undefined && ["Low", "Normal", "High"].includes(b.priority)) set.priority = b.priority;
  if (b.notes !== undefined) set.notes = s(b.notes, 2000);
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
  await db.delete(manufacturingOrders).where(and(eq(manufacturingOrders.id, id), eq(manufacturingOrders.orgId, orgId)));
  return { id, deleted: true };
}

/**
 * Complete an MO by running the build. Inputs default to the BOM scaled to the
 * MO qty (FIFO auto); the caller may pass explicit inputs with lot picks.
 */
export async function completeMO(orgId: string, id: string, actorId: string | null, opts?: { producedDate?: string; inputs?: any[]; lotNo?: string }) {
  const [mo] = await db.select().from(manufacturingOrders).where(and(eq(manufacturingOrders.id, id), eq(manufacturingOrders.orgId, orgId))).limit(1);
  if (!mo) err("MO not found.");
  if (mo!.status === "Completed") err("This MO is already completed.");
  if (mo!.status === "Cancelled") err("This MO was cancelled.");

  let inputs = opts?.inputs;
  if (!inputs?.length) {
    const mat = await materialAvailability(orgId, mo!.bomId, num(mo!.qty));
    inputs = mat.lines.map(l => ({ itemId: l.itemId, qty: l.required }));
  }
  const date = opts?.producedDate || mo!.scheduledDate || new Date().toISOString().slice(0, 10);
  const res = await buildProduction(orgId, {
    bomId: mo!.bomId, outputItemId: mo!.outputItemId, outputSkuId: mo!.outputSkuId ?? null,
    qtyToProduce: num(mo!.qty), producedDate: date, lotNo: opts?.lotNo ?? mo!.moNo, inputs: inputs as any,
  }, actorId);

  await db.update(manufacturingOrders).set({ status: "Completed", productionRunId: res.id, updatedAt: new Date() })
    .where(and(eq(manufacturingOrders.id, id), eq(manufacturingOrders.orgId, orgId)));
  return { id, status: "Completed", runId: res.id, runNo: res.runNo, unitCost: res.unitCost };
}
