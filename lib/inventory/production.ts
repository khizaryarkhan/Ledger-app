/**
 * Production build — consume input lots to produce a finished/WIP output, moving
 * inventory cost item→item with NO P&L impact:
 *
 *   Dr  Output-item Inventory      (total cost of everything consumed)
 *     Cr  each Input-item Inventory  (that input's exact consumed cost)
 *
 * Inputs are relieved FIFO, or from specific lots the user picks (exact
 * traceability & cost). The output lot's unit cost = total input cost ÷ qty
 * produced, so when the finished item is later sold its COGS reflects the true
 * accumulated cost. neon-http has no transactions — we post the balanced entry
 * first, then commit the lot movements keyed to the entry id.
 */

import { db } from "@/db";
import { apItems, itemSkus, productionRuns, productionConsumptions, productionOutputs, boms, bomLines } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { postJournalEntry, LedgerValidationError, type PostLine } from "@/lib/ledger";
import { systemAccountId, INV_SUBTYPE, ensureSystemAccounts } from "@/lib/accounting/system-accounts";
import { loadItemCostInfo, planIssue, commitIssue, commitReceipt, type IssuePlan } from "@/lib/inventory/valuation";
import { kindOf } from "@/lib/inventory/item-kinds";
import { round2, round4, round6 } from "@/lib/inventory/round";
import { requiresApproval, stagePendingApproval } from "@/lib/inventory/approvals";

const err = (m: string): never => { throw new LedgerValidationError(m); };

export type ProductionInput = {
  bomId?: string | null;
  outputItemId: string;
  outputSkuId?: string | null;     // which packaging SKU is produced (FP with multiple SKUs)
  qtyToProduce: number;            // in SKU packs when outputSkuId set, else item base UoM
  producedDate: string;            // YYYY-MM-DD
  expiryDate?: string | null;
  notes?: string | null;
  inputs: { itemId: string; qty: number; skuId?: string | null; lotPicks?: { lotId: string; qty: number }[] }[];
};

export async function buildProduction(orgId: string, input: ProductionInput, actorId: string | null, opts?: { skipApprovalCheck?: boolean }) {
  const date = input.producedDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) err("A valid production date is required.");
  const qtyOut = Math.max(0, Number(input.qtyToProduce) || 0);
  if (qtyOut <= 0) err("Enter the quantity to produce.");
  if (!input.inputs?.length) err("A production build needs at least one input to consume.");

  await ensureSystemAccounts(orgId);
  const invAssetId = await systemAccountId(orgId, INV_SUBTYPE.asset);

  const itemIds = [input.outputItemId, ...input.inputs.map(i => i.itemId)];
  const itemMap = await loadItemCostInfo(orgId, itemIds);
  const output = itemMap.get(input.outputItemId);
  if (!output) err("Output item not found.");
  if (!kindOf(output!.productType).producible) err(`${output!.name} isn't a producible item (must be Finished Product or Work-in-Progress).`);
  const outAsset = output!.assetAccountId ?? invAssetId;
  if (!outAsset) err("No inventory asset account is set up for the output item.");

  // Plan each input's FIFO/specific-lot issue and build the credit lines. The
  // balancing debit is the SUM OF THE ROUNDED credits so the entry balances to
  // the cent (never round2 of the raw sum).
  const plans: { itemId: string; skuId: string | null; assetAcct: string; plan: IssuePlan; name: string }[] = [];
  const lines: PostLine[] = [];
  let totalCost = 0;
  for (const inp of input.inputs) {
    const item = itemMap.get(inp.itemId);
    if (!item) err(`Input item ${inp.itemId} not found.`);
    if (!item!.tracked) continue; // non-tracked inputs carry no inventory cost
    const qty = Math.max(0, Number(inp.qty) || 0);
    if (qty <= 0) continue;
    const restrict = inp.lotPicks?.length ? inp.lotPicks.map(p => p.lotId) : undefined;
    const plan = await planIssue(orgId, item!, qty, restrict, inp.skuId ?? null);
    const assetAcct = item!.assetAccountId ?? invAssetId;
    if (!assetAcct) err(`No inventory asset account for input ${item!.name}.`);
    plans.push({ itemId: item!.id, skuId: inp.skuId ?? null, assetAcct: assetAcct!, plan, name: item!.name });
    const c = round2(plan.totalCost);
    if (c > 0) { lines.push({ accountId: assetAcct!, credit: c, description: `Consumed in production — ${item!.name}` }); totalCost += c; }
  }
  totalCost = round2(totalCost);
  if (totalCost <= 0) err("The selected inputs have no inventory cost on hand to consume. Receive stock first.");

  if (!opts?.skipApprovalCheck && await requiresApproval(orgId, "production_build", totalCost)) {
    const pending = await stagePendingApproval(orgId, "production_build", input, totalCost, actorId);
    return { pending: true, id: pending.id, amount: totalCost } as any;
  }

  // Dr output inventory for the exact sum of the input credits.
  lines.push({ accountId: outAsset!, debit: totalCost, description: `Produced — ${output!.name}` });

  const entry = await postJournalEntry({
    orgId, entryDate: date, memo: input.notes?.trim() || `Production build — ${output!.name}`,
    series: "Production", sourceType: "Production", createdBy: actorId,
    reference: input.bomId ?? null, lines,
  });
  const runNo = entry.docNumber || `BUILD-${date.replace(/-/g, "")}`;

  // Commit the lot movements: relieve input lots, create the output lot.
  const run = await db.insert(productionRuns).values({
    orgId, bomId: input.bomId ?? null, runNo, outputItemId: input.outputItemId,
    qtyToProduce: qtyOut.toString(), totalInputCost: totalCost.toString(),
    status: "Completed", entryId: entry.id, producedDate: date,
    notes: input.notes?.trim() || null, createdBy: actorId,
  } as any).returning({ id: productionRuns.id });
  const runId = run[0].id;

  for (const p of plans) {
    await commitIssue(orgId, {
      itemId: p.itemId, plan: p.plan, skuId: p.skuId, movementType: "issue_production",
      refType: "ProductionRun", refId: entry.id, entryId: entry.id, date, createdBy: actorId, note: `Build ${runNo}`,
    }).catch(e => console.error("[production consume]", e));
    for (const pick of p.plan.picks) {
      if (!pick.lotId) continue;
      await db.insert(productionConsumptions).values({
        orgId, runId, itemId: p.itemId, lotId: pick.lotId,
        qty: pick.qty.toString(), unitCost: pick.unitCost.toString(), totalCost: round2(pick.qty * pick.unitCost).toString(),
      } as any).catch(() => {});
    }
  }

  // The output is produced into a stock SKU when one is chosen: qtyToProduce is
  // in SKU packs → convert to the item's base UoM for the cost lot & valuation.
  let baseQty = qtyOut, skuId: string | null = null;
  if (input.outputSkuId) {
    const [sku] = await db.select({ id: itemSkus.id, size: itemSkus.innerUnitPackSize })
      .from(itemSkus).where(and(eq(itemSkus.id, input.outputSkuId), eq(itemSkus.orgId, orgId))).limit(1);
    if (!sku) err("Output SKU not found.");
    const packSize = Number(sku.size) || 0;
    if (packSize <= 0) err("The chosen output SKU has no pack size (inner unit pack size) — set it on the SKU first.");
    baseQty = round4(qtyOut * packSize);
    skuId = sku.id;
  }
  const producedLotId = await commitReceipt(orgId, {
    itemId: input.outputItemId, skuId, qty: baseQty, unitCost: baseQty > 0 ? totalCost / baseQty : 0,
    productType: output!.productType, expiryDate: input.expiryDate ?? null,
    sourceType: "production", receivedDate: date, refType: "ProductionRun", refId: entry.id, entryId: entry.id,
    createdBy: actorId, note: `Build ${runNo}`,
  }).catch(e => { console.error("[production output]", e); return null; });

  if (producedLotId) await db.update(productionRuns).set({ producedLotId }).where(and(eq(productionRuns.id, runId), eq(productionRuns.orgId, orgId)));

  return { id: runId, entryId: entry.id, runNo, totalInputCost: totalCost, unitCost: round2(baseQty > 0 ? totalCost / baseQty : 0), producedLotId, baseQty };
}

export type MultiBuildInput = {
  bomId: string;
  outputs: { skuId: string; qty: number }[];   // per-pack quantities to produce
  producedDate: string;
  notes?: string | null;
  moId?: string | null;
};

/**
 * Multi-output (co-product) build from a BOM. Ingredients are one shared recipe
 * scaled to the total base FP required; packaging is consumed per output pack.
 * Cost is allocated per pack = its base-content share of the ingredient cost +
 * its own packaging cost. Balanced GL: Dr each output-SKU inventory (allocated),
 * Cr each consumed ingredient & packaging inventory (blended FIFO cost).
 */
export async function buildProductionMulti(orgId: string, input: MultiBuildInput, actorId: string | null, opts?: { skipApprovalCheck?: boolean }) {
  const date = input.producedDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) err("A valid production date is required.");
  // Aggregate by SKU so a repeated skuId can't split into two mis-costed lots.
  const reqAgg = new Map<string, number>();
  for (const o of (input.outputs ?? [])) if (o.skuId && Number(o.qty) > 0) reqAgg.set(o.skuId, (reqAgg.get(o.skuId) ?? 0) + Number(o.qty));
  const reqOutputs = [...reqAgg.entries()].map(([skuId, qty]) => ({ skuId, qty }));
  if (!reqOutputs.length) err("Enter a quantity for at least one output pack.");

  const [bom] = await db.select().from(boms).where(and(eq(boms.id, input.bomId), eq(boms.orgId, orgId))).limit(1);
  if (!bom) err("BOM not found.");
  const batch = Number(bom!.batchSize) || 1;
  const lines = await db.select().from(bomLines).where(and(eq(bomLines.orgId, orgId), eq(bomLines.bomId, input.bomId)));
  const outLines = lines.filter(l => l.role === "output");
  const inLines = lines.filter(l => l.role === "input");
  const packLines = lines.filter(l => l.role === "pack");
  const unitContent = new Map(outLines.map(l => [l.skuId, Number(l.qty) || 0]));

  await ensureSystemAccounts(orgId);
  const invAssetId = await systemAccountId(orgId, INV_SUBTYPE.asset);

  // Total base FP + per-output base qty.
  const outputs = reqOutputs.map(o => {
    const uc = unitContent.get(o.skuId) || 0;
    if (uc <= 0) err("An output pack has no base content per pack set on the BOM.");
    return { skuId: o.skuId, packs: Number(o.qty), baseQty: round4(Number(o.qty) * uc) };
  });
  const baseTotal = round4(outputs.reduce((s, o) => s + o.baseQty, 0));
  if (baseTotal <= 0) err("Nothing to produce.");
  const factor = batch > 0 ? baseTotal / batch : 0;

  // Aggregate required qty per consumed item (ingredients scaled + packaging per output).
  const required = new Map<string, number>();
  for (const l of inLines) required.set(l.itemId, round4((required.get(l.itemId) ?? 0) + (Number(l.qty) || 0) * factor));
  for (const o of outputs) for (const p of packLines.filter(pl => pl.packagingForSkuId === o.skuId)) {
    required.set(p.itemId, round4((required.get(p.itemId) ?? 0) + (Number(p.qty) || 0) * o.packs));
  }
  const consumedIds = [...required.keys()];
  const itemMap = await loadItemCostInfo(orgId, [...consumedIds, bom!.outputItemId]);

  // Plan one FIFO issue per consumed item → blended unit cost.
  const plans = new Map<string, { plan: IssuePlan; blended: number; assetAcct: string }>();
  for (const id of consumedIds) {
    const item = itemMap.get(id); if (!item || !item.tracked) continue;
    const qty = required.get(id)!;
    if (qty <= 0) continue;
    const plan = await planIssue(orgId, item, qty);
    const assetAcct = item.assetAccountId ?? invAssetId;
    if (!assetAcct) err(`No inventory asset account for ${item.name}.`);
    plans.set(id, { plan, blended: plan.qty > 0 ? plan.totalCost / plan.qty : 0, assetAcct: assetAcct! });
  }

  const ingredientCost = round2(inLines.reduce((s, l) => s + (Number(l.qty) || 0) * factor * (plans.get(l.itemId)?.blended ?? 0), 0));
  const packCostByOutput = new Map<string, number>();
  for (const o of outputs) {
    const c = packLines.filter(pl => pl.packagingForSkuId === o.skuId).reduce((s, p) => s + (Number(p.qty) || 0) * o.packs * (plans.get(p.itemId)?.blended ?? 0), 0);
    packCostByOutput.set(o.skuId, round2(c));
  }

  // Credit lines: each consumed item at its planned (rounded) cost.
  const creditLines: PostLine[] = [];
  let creditSum = 0;
  for (const [id, p] of plans) {
    const c = round2(p.plan.totalCost);
    if (c > 0) { creditLines.push({ accountId: p.assetAcct, credit: c, description: `Consumed — ${itemMap.get(id)?.name ?? ""}` }); creditSum = round2(creditSum + c); }
  }
  if (creditSum <= 0) err("The recipe's inputs have no inventory cost on hand to consume. Receive stock first.");

  if (!opts?.skipApprovalCheck && await requiresApproval(orgId, "production_build", creditSum)) {
    const pending = await stagePendingApproval(orgId, "production_build_multi", input, creditSum, actorId);
    return { pending: true, id: pending.id, amount: creditSum } as any;
  }

  // Debit each output SKU: base-content share of ingredient cost + its packaging cost.
  const outAsset = itemMap.get(bom!.outputItemId)?.assetAccountId ?? invAssetId;
  if (!outAsset) err("No inventory asset account for the output item.");
  const outAlloc = outputs.map(o => {
    const share = baseTotal > 0 ? (o.baseQty / baseTotal) * ingredientCost : 0;
    return { ...o, cost: round2(share + (packCostByOutput.get(o.skuId) ?? 0)) };
  });
  // Reconcile rounding so Σ debits == creditSum (assign residual to the biggest).
  let allocSum = round2(outAlloc.reduce((s, o) => s + o.cost, 0));
  const resid = round2(creditSum - allocSum);
  if (resid !== 0 && outAlloc.length) { const big = outAlloc.reduce((a, b) => (b.cost > a.cost ? b : a)); big.cost = round2(big.cost + resid); }
  // Only cost-bearing outputs get a debit line — a zero-cost pack (free co-product
  // or a sub-cent share) would otherwise be a debit:0 line the ledger rejects.
  // Conservation holds: dropped lines are 0, so Σ debits still equals creditSum.
  const debitLines: PostLine[] = outAlloc.filter(o => o.cost > 0.004).map(o => ({ accountId: outAsset!, debit: o.cost, description: `Produced — ${itemMap.get(bom!.outputItemId)?.name ?? ""}` }));

  const entry = await postJournalEntry({
    orgId, entryDate: date, memo: input.notes?.trim() || `Production build — ${bom!.name}`,
    series: "Production", sourceType: "Production", createdBy: actorId, reference: input.bomId, lines: [...creditLines, ...debitLines],
  });
  const runNo = entry.docNumber || `BUILD-${date.replace(/-/g, "")}`;

  const [run] = await db.insert(productionRuns).values({
    orgId, bomId: input.bomId, runNo, outputItemId: bom!.outputItemId,
    qtyToProduce: baseTotal.toString(), totalInputCost: creditSum.toString(),
    status: "Completed", entryId: entry.id, producedDate: date, notes: input.notes?.trim() || null, createdBy: actorId,
  } as any).returning({ id: productionRuns.id });
  const runId = run.id;

  // Commit consumption + record consumptions.
  for (const [id, p] of plans) {
    await commitIssue(orgId, { itemId: id, plan: p.plan, movementType: "issue_production", refType: "ProductionRun", refId: entry.id, entryId: entry.id, date, createdBy: actorId, note: `Build ${runNo}` }).catch(e => console.error("[multi consume]", e));
    for (const pick of p.plan.picks) if (pick.lotId) await db.insert(productionConsumptions).values({ orgId, runId, itemId: id, lotId: pick.lotId, qty: pick.qty.toString(), unitCost: pick.unitCost.toString(), totalCost: round2(pick.qty * pick.unitCost).toString() } as any).catch(() => {});
  }

  // Produce each output pack as its own SKU lot at the allocated cost.
  for (const o of outAlloc) {
    const unit = o.baseQty > 0 ? round6(o.cost / o.baseQty) : 0;
    const lotId = await commitReceipt(orgId, {
      itemId: bom!.outputItemId, skuId: o.skuId, qty: o.baseQty, unitCost: unit,
      productType: itemMap.get(bom!.outputItemId)!.productType, sourceType: "production", receivedDate: date,
      refType: "ProductionRun", refId: entry.id, entryId: entry.id, createdBy: actorId, note: `Build ${runNo}`,
    }).catch(e => { console.error("[multi output]", e); return null; });
    await db.insert(productionOutputs).values({ orgId, runId, itemId: bom!.outputItemId, skuId: o.skuId, qtyPacks: o.packs.toString(), qtyBase: o.baseQty.toString(), unitCost: unit.toString(), amount: o.cost.toString(), lotId: lotId ?? null } as any).catch(() => {});
  }

  return { id: runId, entryId: entry.id, runNo, totalInputCost: creditSum, baseTotal, outputs: outAlloc.length };
}
