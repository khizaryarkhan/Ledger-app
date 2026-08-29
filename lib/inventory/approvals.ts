/**
 * Maker-checker: should this posting be staged for a second, different
 * user's approval instead of posting immediately? Job Work dispatch is
 * gated unconditionally (material leaves custody with no offsetting
 * document in hand — the highest-risk step); Production/Goods Receipt/
 * Shipment are gated above an org-configurable value threshold. Checked by
 * each posting function (lib/inventory/jobwork.ts, production.ts,
 * receiving.ts, shipping.ts) BEFORE any write — if gated, the caller stages
 * the request via stagePendingApproval and returns `{ pending: true, id }`
 * instead of posting.
 */

import { db } from "@/db";
import { approvalThresholds, pendingApprovals } from "@/db/schema";
import { and, eq } from "drizzle-orm";

// "production_build_multi" (Manufacturing Order multi-output builds) has no
// threshold row of its own — it shares "production_build"'s configured
// threshold (checked via requiresApproval) but is stored under its own
// entityType so the approval route knows to re-invoke buildProductionMulti
// (not buildProduction) and, if the build came from an MO, finalize that MO.
export type ApprovalEntityType = "jobwork_dispatch" | "production_build" | "production_build_multi" | "goods_receipt" | "shipment";

export async function requiresApproval(orgId: string, entityType: ApprovalEntityType, amount: number): Promise<boolean> {
  const [row] = await db.select().from(approvalThresholds)
    .where(and(eq(approvalThresholds.orgId, orgId), eq(approvalThresholds.entityType, entityType))).limit(1);
  if (row?.alwaysRequire) return true;
  if (row?.thresholdAmount != null && amount >= Number(row.thresholdAmount)) return true;
  // Before an admin has configured anything, Job Work dispatch still gates —
  // it's the one control that should never silently be "off by default".
  if (!row && entityType === "jobwork_dispatch") return true;
  return false;
}

export async function stagePendingApproval(orgId: string, entityType: ApprovalEntityType, payload: unknown, amount: number, requestedBy: string | null) {
  const [row] = await db.insert(pendingApprovals).values({
    orgId, entityType, payloadJson: payload as any, amount: amount.toFixed(2), requestedBy: requestedBy ?? null,
  } as any).returning();
  return row;
}
