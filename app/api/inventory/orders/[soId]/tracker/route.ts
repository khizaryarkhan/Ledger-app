/**
 * GET /api/inventory/orders/[soId]/tracker
 *
 * Assembles the full "what's happening for this Sales Order" picture in one
 * call — every Purchase Order / Manufacturing Order / Job Work order tagged
 * with this SO's id (Phase 1's salesOrderId links), plus shipments already
 * linked via shipment_lines.so_id, plus any open supply-chain alert for each
 * step (Phase 3). Powers the Order Production Tracker page.
 */

import { db } from "@/db";
import { tradeDocuments, manufacturingOrders, jobWorkOrders, salesShipments, shipmentLines, apItems, supplyChainAlerts } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq, inArray, isNull } from "drizzle-orm";

export async function GET(_req: Request, { params }: { params: { soId: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;

  const [so] = await db.select().from(tradeDocuments)
    .where(and(eq(tradeDocuments.id, params.soId), eq(tradeDocuments.orgId, orgId!), eq(tradeDocuments.kind, "SalesOrder")))
    .limit(1);
  if (!so) return bad("Sales Order not found", 404);

  const [pos, mos, jwos, shipLines, alerts] = await Promise.all([
    db.select().from(tradeDocuments).where(and(eq(tradeDocuments.orgId, orgId!), eq(tradeDocuments.kind, "PurchaseOrder"), eq(tradeDocuments.salesOrderId, params.soId))),
    db.select().from(manufacturingOrders).where(and(eq(manufacturingOrders.orgId, orgId!), eq(manufacturingOrders.salesOrderId, params.soId))),
    db.select().from(jobWorkOrders).where(and(eq(jobWorkOrders.orgId, orgId!), eq(jobWorkOrders.salesOrderId, params.soId))),
    db.select().from(shipmentLines).where(and(eq(shipmentLines.orgId, orgId!), eq(shipmentLines.soId, params.soId))),
    db.select().from(supplyChainAlerts).where(and(eq(supplyChainAlerts.orgId, orgId!), eq(supplyChainAlerts.salesOrderId, params.soId), isNull(supplyChainAlerts.resolvedAt))),
  ]);

  const shipmentIds = [...new Set(shipLines.map(l => l.shipmentId))];
  const shipments = shipmentIds.length
    ? await db.select().from(salesShipments).where(and(eq(salesShipments.orgId, orgId!), inArray(salesShipments.id, shipmentIds)))
    : [];

  const itemIds = [...new Set([...mos.map(m => m.outputItemId), ...jwos.map(j => j.sentItemId)].filter(Boolean) as string[])];
  const items = itemIds.length
    ? await db.select({ id: apItems.id, name: apItems.name }).from(apItems).where(and(eq(apItems.orgId, orgId!), inArray(apItems.id, itemIds)))
    : [];
  const itemName = new Map(items.map(i => [i.id, i.name]));

  const alertBySource = new Map(alerts.map(a => [`${a.sourceType}:${a.sourceId}`, { message: a.message, severity: a.severity, detectedAt: a.detectedAt }]));

  return ok({
    salesOrder: {
      id: so.id, docNumber: so.docNumber, partyLabel: so.partyLabel,
      issueDate: so.issueDate, status: so.status, total: Number(so.total),
    },
    procurement: pos.map(p => ({
      id: p.id, docNumber: p.docNumber, status: p.status, total: Number(p.total),
      expectedDate: p.expiryDate, alert: alertBySource.get(`po:${p.id}`) ?? null,
    })),
    manufacturing: mos.map(m => ({
      id: m.id, moNo: m.moNo, itemName: itemName.get(m.outputItemId) ?? null,
      qty: Number(m.qty), status: m.status, scheduledDate: m.scheduledDate, dueDate: m.dueDate,
      alert: alertBySource.get(`mo:${m.id}`) ?? null,
    })),
    jobWork: jwos.map(j => ({
      id: j.id, docNumber: j.docNumber, itemName: itemName.get(j.sentItemId) ?? null,
      sentQty: Number(j.sentQty), status: j.status, vendorLabel: j.vendorLabel,
      dispatchDate: j.dispatchDate, expectedReturnDate: j.expectedReturnDate,
      alert: alertBySource.get(`jobwork:${j.id}`) ?? null,
    })),
    shipments: shipments.map(s => ({
      id: s.id, shipmentNo: s.shipmentNo, shipmentDate: s.shipmentDate,
      saleTotal: Number(s.saleTotal), invoicedAmount: Number(s.invoicedAmount), status: s.status,
    })),
  });
}
