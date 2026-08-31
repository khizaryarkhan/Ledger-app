/**
 * GET /api/inventory/alerts — every open (unresolved) supply-chain delay
 * alert for this org, enriched with the source document's number and the
 * Sales Order it's for (when tagged). Powers the Delivery Risk report and
 * the header alert bell — both just read this one list.
 */

import { db } from "@/db";
import { supplyChainAlerts, jobWorkOrders, tradeDocuments, manufacturingOrders } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq, isNull, inArray, asc } from "drizzle-orm";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;

  const alerts = await db.select().from(supplyChainAlerts)
    .where(and(eq(supplyChainAlerts.orgId, orgId!), isNull(supplyChainAlerts.resolvedAt)))
    .orderBy(asc(supplyChainAlerts.severity), supplyChainAlerts.detectedAt); // "critical" sorts before "warning" alphabetically
  if (!alerts.length) return ok({ alerts: [] });

  const jwIds = alerts.filter(a => a.sourceType === "jobwork").map(a => a.sourceId);
  const poIds = alerts.filter(a => a.sourceType === "po").map(a => a.sourceId);
  const moIds = alerts.filter(a => a.sourceType === "mo").map(a => a.sourceId);
  const soIds = [...new Set(alerts.map(a => a.salesOrderId).filter(Boolean) as string[])];

  const [jwRows, poRows, moRows, soRows] = await Promise.all([
    jwIds.length ? db.select({ id: jobWorkOrders.id, docNumber: jobWorkOrders.docNumber }).from(jobWorkOrders).where(inArray(jobWorkOrders.id, jwIds)) : [],
    poIds.length ? db.select({ id: tradeDocuments.id, docNumber: tradeDocuments.docNumber }).from(tradeDocuments).where(inArray(tradeDocuments.id, poIds)) : [],
    moIds.length ? db.select({ id: manufacturingOrders.id, docNumber: manufacturingOrders.moNo }).from(manufacturingOrders).where(inArray(manufacturingOrders.id, moIds)) : [],
    soIds.length ? db.select({ id: tradeDocuments.id, docNumber: tradeDocuments.docNumber }).from(tradeDocuments).where(inArray(tradeDocuments.id, soIds)) : [],
  ]);
  const docNumberById = new Map<string, string | null>([...jwRows, ...poRows, ...moRows].map((r): [string, string | null] => [r.id, r.docNumber]));
  const soDocNumberById = new Map<string, string | null>(soRows.map((r): [string, string | null] => [r.id, r.docNumber]));

  return ok({
    alerts: alerts.map(a => ({
      id: a.id, sourceType: a.sourceType, sourceId: a.sourceId, sourceDocNumber: docNumberById.get(a.sourceId) ?? null,
      salesOrderId: a.salesOrderId, salesOrderDocNumber: a.salesOrderId ? soDocNumberById.get(a.salesOrderId) ?? null : null,
      kind: a.kind, severity: a.severity, message: a.message, detectedAt: a.detectedAt,
    })),
  });
}
