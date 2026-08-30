/**
 * Lot traceability — given one FIFO cost lot, walk its complete history:
 * what it was made from (ancestors, all the way back to the originating
 * purchase — supplier, PO, receipt date, cost, who received it) and what it
 * became (descendants, down to a sale or remaining on-hand), with the
 * processing step and who performed/recorded it at every hop.
 *
 * No new schema needed: inventory_movements already records one row PER
 * FIFO PICK (commitIssue in valuation.ts writes one per pick), so lot-level
 * consumption detail already exists. What's missing is pairing "lot
 * consumed" with "lot produced" — movements alone don't link them; every
 * transformation hop requires joining out to the domain table that made the
 * pairing: job_work_orders (dispatch <-> receive) or
 * production_runs/production_outputs/production_consumptions (inputs <->
 * outputs). Purchases and sales are terminal (no further hop needed) —
 * a purchase-sourced lot's origin (supplier/PO/receiver/cost) is resolved
 * via goods_receipt_lines/goods_receipts/trade_documents and attached
 * directly onto its LotSummary, so it shows up wherever that lot appears
 * in the tree, not just at the root.
 */

import { db } from "@/db";
import {
  inventoryLots, inventoryMovements, apItems, users,
  jobWorkOrders, jobWorkReceipts, productionRuns, productionOutputs, productionConsumptions,
  salesShipments, shipmentLines, goodsReceipts, goodsReceiptLines, tradeDocuments, customers,
} from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { linksFor } from "@/lib/accounting/links";

const MAX_DEPTH = 15; // backstop against bad/cyclic data, not a realistic supply chain depth
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type OriginInfo = {
  receiptNo: string | null; poNumber: string | null;
  poId: string | null; receiptEntryId: string | null;
  supplierId: string | null; supplierLabel: string | null;
  date: string | null; receivedBy: string | null;
  unitCost: number; qty: number;
};

export type LotSummary = {
  id: string; itemId: string; itemName: string; lotNo: string | null;
  origQty: number; remainingQty: number; unitCost: number; sourceType: string;
  origin?: OriginInfo | null; // set whenever sourceType === "purchase"
};

export type AncestorEdge = {
  lot: LotSummary;
  qtyConsumed: number;
  costContribution: number; // qtyConsumed × lot.unitCost — what this input added to the new lot's cost
  via: { kind: "production" | "jobwork"; label: string; refId: string; date: string | null; by: string | null; notes: string | null; feeAmount?: number; entryId?: string | null };
  ancestors: AncestorEdge[];
};

export type DescendantEdge = {
  kind: "production" | "jobwork" | "sale";
  label: string; refId: string; date: string | null; qtyConsumed: number;
  by: string | null; notes: string | null;
  producedLots?: LotSummary[];
  descendants?: DescendantEdge[];
  sale?: { customerLabel: string | null; shipmentNo: string | null; shipmentId: string | null; invoiceNo: string | null; invoiceEntryId: string | null };
};

async function userName(orgId: string, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const [row] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.name ?? null;
}

/** Supplier/PO/receiver/cost for a purchase-sourced lot — resolved from the
 *  Goods Receipt line that created it (works whether or not the receipt was
 *  raised against a PO). */
async function getOrigin(orgId: string, lotId: string): Promise<OriginInfo | null> {
  const [line] = await db.select({
    receiptId: goodsReceiptLines.receiptId, poId: goodsReceiptLines.poId,
    unitCost: goodsReceiptLines.unitCost, qtyBase: goodsReceiptLines.qtyBase,
  }).from(goodsReceiptLines).where(and(eq(goodsReceiptLines.orgId, orgId), eq(goodsReceiptLines.lotId, lotId))).limit(1);
  if (!line) return null;
  const [receipt] = await db.select().from(goodsReceipts).where(and(eq(goodsReceipts.orgId, orgId), eq(goodsReceipts.id, line.receiptId))).limit(1);
  if (!receipt) return null;
  let poNumber: string | null = null;
  if (line.poId) {
    const [po] = await db.select({ docNumber: tradeDocuments.docNumber }).from(tradeDocuments)
      .where(and(eq(tradeDocuments.orgId, orgId), eq(tradeDocuments.id, line.poId))).limit(1);
    poNumber = po?.docNumber ?? null;
  }
  return {
    receiptNo: receipt.receiptNo, poNumber, poId: line.poId ?? null, receiptEntryId: receipt.entryId ?? null,
    supplierId: receipt.supplierId ?? null, supplierLabel: receipt.supplierLabel,
    date: receipt.receiptDate, receivedBy: await userName(orgId, receipt.createdBy),
    unitCost: Number(line.unitCost), qty: Number(line.qtyBase),
  };
}

async function getLotSummary(orgId: string, lotId: string): Promise<LotSummary | null> {
  const [row] = await db.select({
    id: inventoryLots.id, itemId: inventoryLots.itemId, itemName: apItems.name,
    lotNo: inventoryLots.lotNo, origQty: inventoryLots.origQty, remainingQty: inventoryLots.remainingQty,
    unitCost: inventoryLots.unitCost, sourceType: inventoryLots.sourceType,
  }).from(inventoryLots).innerJoin(apItems, eq(apItems.id, inventoryLots.itemId))
    .where(and(eq(inventoryLots.id, lotId), eq(inventoryLots.orgId, orgId))).limit(1);
  if (!row) return null;
  const origin = row.sourceType === "purchase" ? await getOrigin(orgId, lotId) : null;
  return { ...row, origQty: Number(row.origQty), remainingQty: Number(row.remainingQty), unitCost: Number(row.unitCost), origin };
}

/** What this lot was made from — recurses back to the originating purchase(s). */
export async function lotAncestors(orgId: string, lotId: string, depth = 0): Promise<AncestorEdge[]> {
  if (depth >= MAX_DEPTH) return [];
  const [lot] = await db.select({ sourceType: inventoryLots.sourceType }).from(inventoryLots)
    .where(and(eq(inventoryLots.id, lotId), eq(inventoryLots.orgId, orgId))).limit(1);
  if (!lot) return [];

  if (lot.sourceType === "production") {
    let [run] = await db.select().from(productionRuns).where(and(eq(productionRuns.orgId, orgId), eq(productionRuns.producedLotId, lotId))).limit(1);
    if (!run) {
      const [out] = await db.select().from(productionOutputs).where(and(eq(productionOutputs.orgId, orgId), eq(productionOutputs.lotId, lotId))).limit(1);
      if (out) [run] = await db.select().from(productionRuns).where(and(eq(productionRuns.orgId, orgId), eq(productionRuns.id, out.runId))).limit(1);
    }
    if (!run) return [];
    const by = await userName(orgId, run.createdBy);
    const consumptions = await db.select().from(productionConsumptions).where(and(eq(productionConsumptions.orgId, orgId), eq(productionConsumptions.runId, run.id)));
    const edges: AncestorEdge[] = [];
    for (const c of consumptions) {
      const consumedLot = await getLotSummary(orgId, c.lotId);
      if (!consumedLot) continue;
      const qtyConsumed = Number(c.qty);
      edges.push({
        lot: consumedLot, qtyConsumed, costContribution: round2(qtyConsumed * consumedLot.unitCost),
        via: { kind: "production", label: `Production ${run.runNo ?? ""}`, refId: run.id, date: run.producedDate, by, notes: run.notes ?? null },
        ancestors: await lotAncestors(orgId, c.lotId, depth + 1),
      });
    }
    return edges;
  }

  if (lot.sourceType === "jobwork") {
    // Find which RECEIPT TRANCHE produced this lot (a dispatch may be received
    // across several), then its parent order.
    const [receipt] = await db.select().from(jobWorkReceipts).where(and(eq(jobWorkReceipts.orgId, orgId), eq(jobWorkReceipts.receivedLotId, lotId))).limit(1);
    if (!receipt) return [];
    const [jwo] = await db.select().from(jobWorkOrders).where(and(eq(jobWorkOrders.orgId, orgId), eq(jobWorkOrders.id, receipt.jobWorkOrderId))).limit(1);
    if (!jwo || !jwo.dispatchEntryId) return [];
    const by = await userName(orgId, jwo.createdBy);

    // This tranche's share of the whole dispatch — the dispatched material's
    // qty/cost must be prorated by it, or receiving in N tranches would
    // attribute the FULL dispatch to each one and multiply the material cost.
    // The share is this tranche's DISPATCHED-material-equivalent qty over the
    // order's SENT qty (its own dispatched amount) — NOT over the tranches'
    // combined total, which is smaller whenever the order later closes with
    // wastage. Dividing by the combined total would smear that wastage
    // proportionally across every tranche's ancestry instead of leaving it
    // correctly unattributed to any specific output lot (it's already
    // accounted for, separately and visibly, by the order's own close-time
    // wastage write-off) — confirmed by a real reconciliation mismatch this
    // produced on a genuinely multi-tranche order (fractions summed to 1
    // instead of to sentQty-proportion, over-attributing cost to every lot).
    const allReceipts = await db.select().from(jobWorkReceipts).where(and(eq(jobWorkReceipts.orgId, orgId), eq(jobWorkReceipts.jobWorkOrderId, jwo.id))).orderBy(jobWorkReceipts.createdAt);
    const materialQtyOf = (r: typeof allReceipts[number]) => Number(r.materialQtyConsumed ?? r.receivedQty);
    const sentQty = Number(jwo.sentQty);
    // Normally: this tranche's dispatched-material-equivalent qty over the
    // order's sentQty — correctly reflects any real yield loss/gain for a
    // SAME-substance conversion (e.g. dyeing losing 10 of 600kg), even for a
    // single-tranche order, so it must NOT be special-cased away in general.
    // The one genuine exception: a receipt backfilled from the old
    // single-receipt model (migration 0071, before job_work_receipts or
    // materialQtyConsumed existed) has no reliable materialQtyConsumed and
    // falls back to raw receivedQty — which for a knitting-style process with
    // real weight gain (kg yarn in, more kg fabric out) is NOT comparable to
    // sentQty at all. For that specific case only, skip the division: a
    // single legacy receipt got 100% of its dispatch by definition anyway.
    const isLegacyBackfill = receipt.notes === "Backfilled from single-receipt legacy record";
    const fraction = isLegacyBackfill ? 1 : (sentQty > 0 ? materialQtyOf(receipt) / sentQty : 1);
    const tranche = allReceipts.length > 1 ? ` (receipt ${allReceipts.findIndex(r => r.id === receipt.id) + 1} of ${allReceipts.length})` : "";

    const moves = await db.select().from(inventoryMovements)
      .where(and(eq(inventoryMovements.orgId, orgId), eq(inventoryMovements.movementType, "issue_jobwork"), eq(inventoryMovements.refId, jwo.dispatchEntryId)));
    const edges: AncestorEdge[] = [];
    for (const m of moves) {
      if (!m.lotId) continue;
      const consumedLot = await getLotSummary(orgId, m.lotId);
      if (!consumedLot) continue;
      const qtyConsumed = round2(Math.abs(Number(m.qty)) * fraction);
      edges.push({
        lot: consumedLot, qtyConsumed, costContribution: round2(qtyConsumed * consumedLot.unitCost),
        via: { kind: "jobwork", label: `Job Work ${jwo.docNumber ?? ""} — sent to ${jwo.vendorLabel ?? "job worker"}${tranche}`, refId: jwo.id, date: jwo.dispatchDate, by, notes: jwo.notes ?? null, feeAmount: round2(Number(receipt.processingFeeAmount ?? 0)), entryId: receipt.receiveEntryId ?? null },
        ancestors: await lotAncestors(orgId, m.lotId, depth + 1),
      });
    }
    return edges;
  }

  // purchase / opening / adjustment: terminal — its supplier/PO/cost is
  // already attached to the lot itself (getLotSummary's `origin`), not
  // modeled as a further ancestor edge.
  return [];
}

/** What this lot became — recurses forward to final sale or remaining on-hand. */
export async function lotDescendants(orgId: string, lotId: string, depth = 0): Promise<DescendantEdge[]> {
  if (depth >= MAX_DEPTH) return [];
  const moves = await db.select().from(inventoryMovements)
    .where(and(eq(inventoryMovements.orgId, orgId), eq(inventoryMovements.lotId, lotId), sql`${inventoryMovements.movementType} LIKE 'issue_%'`));

  const groups = new Map<string, typeof moves>();
  for (const m of moves) {
    const key = `${m.movementType}:${m.refId}`;
    const g = groups.get(key);
    if (g) g.push(m); else groups.set(key, [m]);
  }

  const edges: DescendantEdge[] = [];
  for (const group of groups.values()) {
    const m0 = group[0];
    const qtyConsumed = group.reduce((s, m) => s + Math.abs(Number(m.qty)), 0);

    if (m0.movementType === "issue_jobwork" && m0.refId) {
      const [jwo] = await db.select().from(jobWorkOrders).where(and(eq(jobWorkOrders.orgId, orgId), eq(jobWorkOrders.dispatchEntryId, m0.refId))).limit(1);
      let producedLots: LotSummary[] = [];
      let sub: DescendantEdge[] = [];
      if (jwo) {
        // A single dispatch may come back across several partial receipts —
        // fan out to every tranche's lot, not just "the" received lot.
        const receiptRows = await db.select().from(jobWorkReceipts).where(and(eq(jobWorkReceipts.orgId, orgId), eq(jobWorkReceipts.jobWorkOrderId, jwo.id)));
        for (const rr of receiptRows) {
          if (!rr.receivedLotId) continue;
          const pl = await getLotSummary(orgId, rr.receivedLotId);
          if (pl) { producedLots.push(pl); sub = sub.concat(await lotDescendants(orgId, rr.receivedLotId, depth + 1)); }
        }
      }
      edges.push({
        kind: "jobwork", label: `Job Work ${jwo?.docNumber ?? ""} — sent to ${jwo?.vendorLabel ?? "job worker"}`,
        refId: jwo?.id ?? m0.refId, date: jwo?.dispatchDate ?? m0.movementDate, qtyConsumed,
        by: await userName(orgId, jwo?.createdBy), notes: jwo?.notes ?? null,
        producedLots, descendants: sub,
      });
    } else if (m0.movementType === "issue_production" && m0.refId) {
      const [run] = await db.select().from(productionRuns).where(and(eq(productionRuns.orgId, orgId), eq(productionRuns.entryId, m0.refId))).limit(1);
      const producedLots: LotSummary[] = [];
      let sub: DescendantEdge[] = [];
      if (run) {
        const lotIds = run.producedLotId ? [run.producedLotId]
          : (await db.select({ lotId: productionOutputs.lotId }).from(productionOutputs).where(and(eq(productionOutputs.orgId, orgId), eq(productionOutputs.runId, run.id))))
              .map(o => o.lotId).filter((id): id is string => !!id);
        for (const lid of lotIds) {
          const pl = await getLotSummary(orgId, lid);
          if (pl) { producedLots.push(pl); sub = sub.concat(await lotDescendants(orgId, lid, depth + 1)); }
        }
      }
      edges.push({
        kind: "production", label: `Production ${run?.runNo ?? ""}`,
        refId: run?.id ?? m0.refId, date: run?.producedDate ?? m0.movementDate, qtyConsumed,
        by: await userName(orgId, run?.createdBy), notes: run?.notes ?? null,
        producedLots, descendants: sub,
      });
    } else if (m0.movementType === "issue_sale" && m0.refId) {
      const [shipment] = await db.select().from(salesShipments).where(and(eq(salesShipments.orgId, orgId), eq(salesShipments.entryId, m0.refId))).limit(1);
      let invoiceNo: string | null = null;
      let invoiceEntryId: string | null = null;
      let customerLabel = shipment?.customerLabel ?? null;
      if (shipment) {
        const related = await linksFor(orgId, "Shipment", shipment.id).catch(() => []);
        const inv = related.find(r => r.type === "Invoice");
        invoiceNo = inv?.docNumber ?? null;
        invoiceEntryId = inv?.id ?? null;
        // Older/scripted shipments can carry a customerId with no
        // customerLabel snapshot (postShipment now backfills it going
        // forward) — resolve any gap here too.
        if (!customerLabel && shipment.customerId) {
          const [customer] = await db.select({ name: customers.name }).from(customers).where(and(eq(customers.orgId, orgId), eq(customers.id, shipment.customerId))).limit(1);
          customerLabel = customer?.name ?? null;
        }
      }
      edges.push({
        kind: "sale", label: `Shipment ${shipment?.shipmentNo ?? ""} — sold to ${customerLabel ?? "customer"}`,
        refId: shipment?.id ?? m0.refId, date: shipment?.shipmentDate ?? m0.movementDate, qtyConsumed,
        by: await userName(orgId, shipment?.createdBy), notes: shipment?.notes ?? null,
        sale: { customerLabel, shipmentNo: shipment?.shipmentNo ?? null, shipmentId: shipment?.id ?? null, invoiceNo, invoiceEntryId },
      });
    }
  }
  return edges;
}

export async function lotFullGenealogy(orgId: string, lotId: string) {
  const lot = await getLotSummary(orgId, lotId);
  if (!lot) return null;
  const [ancestors, descendants] = await Promise.all([
    lotAncestors(orgId, lotId),
    lotDescendants(orgId, lotId),
  ]);
  return { lot, origin: lot.origin ?? null, ancestors, descendants };
}

// ── Printable batch traceability report ─────────────────────────────────────
// A flat, tabular reshaping of the same ancestor/descendant tree above, for a
// formal audit-style document: raw materials in/consumed/remaining, every
// subcontract/internal processing step with its cost, a cost rollup by
// category, and outbound distribution — the shape a cost accountant expects,
// not a nested tree.

/** Only the portion of this raw material actually attributable to the lot
 *  being reported on — never the purchase lot's full original quantity,
 *  which may span many unrelated builds and would overstate this one. */
export type RawMaterialRow = {
  itemName: string; lotNo: string | null; uom: string | null;
  qty: number; rate: number; amount: number;
  supplierId: string | null; supplierLabel: string | null;
  poNumber: string | null; poId: string | null;
  receiptNo: string | null; receiptEntryId: string | null;
  issuedTo: string;
};

export type ProcessingRow = {
  orderId: string; entryId: string | null; activity: string; qty: number; uom: string | null;
  rate: number; amount: number; provider: string; date: string | null;
  orderTotalQty: number | null;       // the job-work order's full sent qty — lets the UI show "this build got X% of the order"
  orderWastagePct: number | null;     // set only if that order is Closed with nonzero wastage/gain
};

export type CostRollupRow = { label: string; detail: string; amount: number; sharePct: number };

export type DistributionRow = {
  shipmentNo: string | null; shipmentEntryId: string | null;
  invoiceNo: string | null; invoiceEntryId: string | null;
  customerLabel: string | null;
  qty: number; uom: string | null; unitPrice: number; amount: number; date: string | null;
};

export type LotTraceReport = {
  lot: LotSummary; operator: string | null;
  rawMaterials: RawMaterialRow[]; processing: ProcessingRow[];
  costRollup: CostRollupRow[]; distribution: DistributionRow[];
};

async function itemBaseUom(itemId: string): Promise<string | null> {
  const [row] = await db.select({ baseUom: apItems.baseUom }).from(apItems).where(eq(apItems.id, itemId)).limit(1);
  return row?.baseUom ?? null;
}

/**
 * Every edge's qtyConsumed/costContribution describes how much of e.lot went
 * into producing its PARENT's ENTIRE original batch — not scaled to however
 * much of that parent later feeds this specific finished lot. When a parent
 * lot was only partially consumed further downstream (e.g. a job-work batch
 * split across two later processes), naively summing raw edges double-counts
 * material/fees that never actually reached this lot. `fraction` carries the
 * cumulative share of the current edge list's parent that is attributable to
 * the report's target lot, compounding as we descend (edge's own
 * qtyConsumed/lot.origQty ratio) so every deeper contribution is prorated to
 * match.
 */
async function flattenAncestorsForReport(
  orgId: string, edges: AncestorEdge[],
  rawByLotId: Map<string, RawMaterialRow>, processing: ProcessingRow[],
  fraction: number = 1,
  rawQtyByOrder: Map<string, number> = new Map(),
): Promise<void> {
  for (const e of edges) {
    const qtyAttrib = e.qtyConsumed * fraction;
    const costAttrib = e.costContribution * fraction;
    if (e.lot.sourceType === "purchase" && e.lot.origin) {
      const existing = rawByLotId.get(e.lot.id);
      if (existing) {
        existing.qty = round2(existing.qty + qtyAttrib);
        existing.amount = round2(existing.amount + costAttrib);
      } else {
        rawByLotId.set(e.lot.id, {
          itemName: e.lot.itemName, lotNo: e.lot.lotNo, uom: await itemBaseUom(e.lot.itemId),
          qty: round2(qtyAttrib), rate: e.lot.unitCost, amount: round2(costAttrib),
          supplierId: e.lot.origin.supplierId, supplierLabel: e.lot.origin.supplierLabel,
          poNumber: e.lot.origin.poNumber, poId: e.lot.origin.poId,
          receiptNo: e.lot.origin.receiptNo, receiptEntryId: e.lot.origin.receiptEntryId,
          issuedTo: e.via.label,
        });
      }
    }
    if (e.via.kind === "jobwork") {
      // `via.feeAmount`/`via.entryId` are the SPECIFIC receipt tranche's own
      // fee/entry (set in lotAncestors) — never re-derive from the parent
      // order's aggregate columns, which only reflect the most recent tranche.
      //
      // A single job-work order can appear as MULTIPLE edges here when its
      // dispatch drew from more than one upstream lot (e.g. FIFO picking
      // across two knitting tranches to fill one dyeing dispatch) — every
      // edge references the SAME receipt/fee. The fee must be attributed
      // ONCE in total, proportional to how much of the order's sentQty this
      // lot's chain accounts for overall — never independently per edge and
      // summed, which double(or N-)counts the same fee for the same order.
      //
      // The correct denominator is NOT the order's sentQty — it's the sum of
      // every sibling edge's own RAW qtyConsumed (before this call's incoming
      // fraction is applied), which by construction always sums to exactly
      // this receipt's own materialQtyConsumed (or receivedQty), regardless
      // of how many upstream lots the dispatch was split across. Tracked
      // incrementally in rawQtyByOrder as sibling edges are visited; only the
      // value after ALL siblings are processed is actually correct, but only
      // the final state (after the whole recursion) is ever read by callers.
      const [jwo] = await db.select().from(jobWorkOrders).where(and(eq(jobWorkOrders.orgId, orgId), eq(jobWorkOrders.id, e.via.refId))).limit(1);
      const feeTotal = round2(e.via.feeAmount ?? 0);
      const orderKey = e.via.refId;
      const rawQtySoFar = round2((rawQtyByOrder.get(orderKey) ?? 0) + e.qtyConsumed);
      rawQtyByOrder.set(orderKey, rawQtySoFar);
      const existing = processing.find(p => p.orderId === (jwo?.docNumber ?? e.via.refId.slice(0, 8)));
      const qty = round2(qtyAttrib);
      const sentQtyForOrder = jwo ? Number(jwo.sentQty) : 0;
      const orderTotalQty = jwo ? round2(sentQtyForOrder) : null;
      const orderWastagePct = jwo && jwo.status === "Closed" && sentQtyForOrder > 0 && Math.abs(Number(jwo.wastageQty ?? 0)) > 0.0001
        ? round2((Number(jwo.wastageQty) / sentQtyForOrder) * 100) : null;
      if (existing) {
        existing.qty = round2(existing.qty + qty);
        existing.amount = rawQtySoFar > 0 ? round2(feeTotal * (existing.qty / rawQtySoFar)) : existing.amount;
        existing.rate = existing.qty > 0 ? round2(existing.amount / existing.qty) : 0;
      } else {
        const amount = rawQtySoFar > 0 ? round2(feeTotal * (qty / rawQtySoFar)) : 0;
        processing.push({
          orderId: jwo?.docNumber ?? e.via.refId.slice(0, 8),
          entryId: e.via.entryId ?? null,
          activity: jwo?.notes || `${e.lot.itemName} → processing`,
          qty, uom: await itemBaseUom(e.lot.itemId),
          rate: qty > 0 ? round2(amount / qty) : 0, amount,
          provider: jwo?.vendorLabel ?? "—", date: e.via.date,
          orderTotalQty, orderWastagePct,
        });
      }
    }
    const nextFraction = e.lot.origQty > 0 ? fraction * (e.qtyConsumed / e.lot.origQty) : fraction;
    await flattenAncestorsForReport(orgId, e.ancestors, rawByLotId, processing, nextFraction, rawQtyByOrder);
  }
}

function flattenSalesForReport(edges: DescendantEdge[], out: DistributionRow[]) {
  for (const e of edges) {
    if (e.kind === "sale" && e.sale) out.push({
      shipmentNo: e.sale.shipmentNo, shipmentEntryId: null, invoiceNo: e.sale.invoiceNo, invoiceEntryId: e.sale.invoiceEntryId,
      customerLabel: e.sale.customerLabel, qty: e.qtyConsumed, uom: null, unitPrice: 0, amount: 0, date: e.date,
    });
    flattenSalesForReport(e.descendants ?? [], out);
  }
}

export async function buildLotTraceReport(orgId: string, lotId: string): Promise<LotTraceReport | null> {
  const lot = await getLotSummary(orgId, lotId);
  if (!lot) return null;
  const [ancestors, descendantsTree] = await Promise.all([lotAncestors(orgId, lotId), lotDescendants(orgId, lotId)]);

  const rawByLotId = new Map<string, RawMaterialRow>();
  const processing: ProcessingRow[] = [];
  await flattenAncestorsForReport(orgId, ancestors, rawByLotId, processing);

  let operator: string | null = null;
  if (lot.sourceType === "production") {
    let [run] = await db.select().from(productionRuns).where(and(eq(productionRuns.orgId, orgId), eq(productionRuns.producedLotId, lotId))).limit(1);
    if (!run) {
      const [out] = await db.select().from(productionOutputs).where(and(eq(productionOutputs.orgId, orgId), eq(productionOutputs.lotId, lotId))).limit(1);
      if (out) [run] = await db.select().from(productionRuns).where(and(eq(productionRuns.orgId, orgId), eq(productionRuns.id, out.runId))).limit(1);
    }
    if (run) operator = await userName(orgId, run.createdBy);
  } else if (lot.sourceType === "jobwork") {
    const [receipt] = await db.select({ createdBy: jobWorkReceipts.createdBy }).from(jobWorkReceipts).where(and(eq(jobWorkReceipts.orgId, orgId), eq(jobWorkReceipts.receivedLotId, lotId))).limit(1);
    operator = await userName(orgId, receipt?.createdBy);
  } else if (lot.origin) {
    operator = lot.origin.receivedBy;
  }

  const rawMaterials = [...rawByLotId.values()];
  const directMaterials = round2(rawMaterials.reduce((s, r) => s + r.amount, 0));
  const conversionFees = round2(processing.reduce((s, p) => s + p.amount, 0));
  const totalCost = round2(directMaterials + conversionFees);
  const pct = (n: number) => (totalCost > 0.005 ? round2((n / totalCost) * 100) : 0);
  const costRollup: CostRollupRow[] = [
    { label: "Direct Materials Consumed", detail: rawMaterials.map(r => `${r.itemName} (${r.qty} ${r.uom ?? ""} issued @ ${r.rate})`).join("; ") || "—", amount: directMaterials, sharePct: pct(directMaterials) },
    { label: "Outsource Conversion Fees", detail: processing.filter(p => p.amount > 0.005).map(p => `${p.activity} (${p.orderId})`).join("; ") || "—", amount: conversionFees, sharePct: pct(conversionFees) },
    { label: "Total Cost of Goods Manufactured", detail: `${lot.itemName} — Lot ${lot.lotNo ?? lot.id.slice(0, 8)} (${lot.origQty} units)`, amount: totalCost, sharePct: 100 },
  ];

  const distribution: DistributionRow[] = [];
  flattenSalesForReport(descendantsTree, distribution);
  for (const d of distribution) {
    if (!d.shipmentNo) continue;
    const [shipment] = await db.select({ id: salesShipments.id, entryId: salesShipments.entryId }).from(salesShipments).where(and(eq(salesShipments.orgId, orgId), eq(salesShipments.shipmentNo, d.shipmentNo))).limit(1);
    if (!shipment) continue;
    d.shipmentEntryId = shipment.entryId ?? null;
    const [line] = await db.select().from(shipmentLines).where(and(eq(shipmentLines.orgId, orgId), eq(shipmentLines.shipmentId, shipment.id), eq(shipmentLines.itemId, lot.itemId))).limit(1);
    if (line) {
      d.uom = await itemBaseUom(lot.itemId);
      d.unitPrice = round2(Number(line.saleRate ?? 0));
      d.amount = round2(Number(line.saleRate ?? 0) * d.qty);
    }
  }

  return { lot, operator, rawMaterials, processing, costRollup, distribution };
}
