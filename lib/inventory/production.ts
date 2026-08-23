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
import { apItems, itemSkus, productionRuns, productionConsumptions } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { postJournalEntry, LedgerValidationError, type PostLine } from "@/lib/ledger";
import { systemAccountId, INV_SUBTYPE, ensureSystemAccounts } from "@/lib/accounting/system-accounts";
import { loadItemCostInfo, planIssue, commitIssue, commitReceipt, type IssuePlan } from "@/lib/inventory/valuation";
import { kindOf } from "@/lib/inventory/item-kinds";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const round4 = (n: number) => Math.round((Number(n) || 0) * 1e4) / 1e4;
const err = (m: string): never => { throw new LedgerValidationError(m); };

export type ProductionInput = {
  bomId?: string | null;
  outputItemId: string;
  outputSkuId?: string | null;     // which packaging SKU is produced (FP with multiple SKUs)
  qtyToProduce: number;            // in SKU packs when outputSkuId set, else item base UoM
  producedDate: string;            // YYYY-MM-DD
  lotNo?: string | null;           // output lot number
  expiryDate?: string | null;
  notes?: string | null;
  inputs: { itemId: string; qty: number; skuId?: string | null; lotPicks?: { lotId: string; qty: number }[] }[];
};

export async function buildProduction(orgId: string, input: ProductionInput, actorId: string | null) {
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
    lotNo: input.lotNo ?? runNo, expiryDate: input.expiryDate ?? null,
    sourceType: "production", receivedDate: date, refType: "ProductionRun", refId: entry.id, entryId: entry.id,
    createdBy: actorId, note: `Build ${runNo}`,
  }).catch(e => { console.error("[production output]", e); return null; });

  if (producedLotId) await db.update(productionRuns).set({ producedLotId }).where(and(eq(productionRuns.id, runId), eq(productionRuns.orgId, orgId)));

  return { id: runId, entryId: entry.id, runNo, totalInputCost: totalCost, unitCost: round2(baseQty > 0 ? totalCost / baseQty : 0), producedLotId, baseQty };
}
