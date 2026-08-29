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
  jobWorkOrders, productionRuns, productionOutputs, productionConsumptions,
  salesShipments, goodsReceipts, goodsReceiptLines, tradeDocuments,
} from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { linksFor } from "@/lib/accounting/links";

const MAX_DEPTH = 15; // backstop against bad/cyclic data, not a realistic supply chain depth
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type OriginInfo = {
  receiptNo: string | null; poNumber: string | null;
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
  via: { kind: "production" | "jobwork"; label: string; refId: string; date: string | null; by: string | null; notes: string | null };
  ancestors: AncestorEdge[];
};

export type DescendantEdge = {
  kind: "production" | "jobwork" | "sale";
  label: string; refId: string; date: string | null; qtyConsumed: number;
  by: string | null; notes: string | null;
  producedLots?: LotSummary[];
  descendants?: DescendantEdge[];
  sale?: { customerLabel: string | null; shipmentNo: string | null; invoiceNo: string | null };
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
    receiptNo: receipt.receiptNo, poNumber,
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
    const [jwo] = await db.select().from(jobWorkOrders).where(and(eq(jobWorkOrders.orgId, orgId), eq(jobWorkOrders.receivedLotId, lotId))).limit(1);
    if (!jwo || !jwo.dispatchEntryId) return [];
    const by = await userName(orgId, jwo.createdBy);
    const moves = await db.select().from(inventoryMovements)
      .where(and(eq(inventoryMovements.orgId, orgId), eq(inventoryMovements.movementType, "issue_jobwork"), eq(inventoryMovements.refId, jwo.dispatchEntryId)));
    const edges: AncestorEdge[] = [];
    for (const m of moves) {
      if (!m.lotId) continue;
      const consumedLot = await getLotSummary(orgId, m.lotId);
      if (!consumedLot) continue;
      const qtyConsumed = Math.abs(Number(m.qty));
      edges.push({
        lot: consumedLot, qtyConsumed, costContribution: round2(qtyConsumed * consumedLot.unitCost),
        via: { kind: "jobwork", label: `Job Work ${jwo.docNumber ?? ""} — sent to ${jwo.vendorLabel ?? "job worker"}`, refId: jwo.id, date: jwo.dispatchDate, by, notes: jwo.notes ?? null },
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
      if (jwo?.status === "Received" && jwo.receivedLotId) {
        const pl = await getLotSummary(orgId, jwo.receivedLotId);
        if (pl) { producedLots = [pl]; sub = await lotDescendants(orgId, jwo.receivedLotId, depth + 1); }
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
      if (shipment) {
        const related = await linksFor(orgId, "Shipment", shipment.id).catch(() => []);
        invoiceNo = related.find(r => r.type === "Invoice")?.docNumber ?? null;
      }
      edges.push({
        kind: "sale", label: `Shipment ${shipment?.shipmentNo ?? ""} — sold to ${shipment?.customerLabel ?? "customer"}`,
        refId: shipment?.id ?? m0.refId, date: shipment?.shipmentDate ?? m0.movementDate, qtyConsumed,
        by: await userName(orgId, shipment?.createdBy), notes: shipment?.notes ?? null,
        sale: { customerLabel: shipment?.customerLabel ?? null, shipmentNo: shipment?.shipmentNo ?? null, invoiceNo },
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
