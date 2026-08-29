/**
 * POST /api/approvals/[id]/approve
 *
 * Segregation of duties: role >= company_admin AND the approver must be a
 * DIFFERENT user from whoever requested it. Re-invokes the original posting
 * function with the stored payload (skipApprovalCheck: true, so it can't
 * loop back into another pending row) — this is the only place the actual
 * inventory/GL write happens for a gated transaction.
 */

import { db } from "@/db";
import { pendingApprovals, manufacturingOrders } from "@/db/schema";
import { requireOrg, ok, bad, requireRole } from "@/lib/api";
import { and, eq } from "drizzle-orm";
import { LedgerValidationError } from "@/lib/ledger";
import { dispatchToJobWorker } from "@/lib/inventory/jobwork";
import { buildProduction, buildProductionMulti } from "@/lib/inventory/production";
import { postGoodsReceipt } from "@/lib/inventory/receiving";
import { postShipment } from "@/lib/inventory/shipping";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (!role || !requireRole(role, "company_admin")) return bad("Admins only", 403);
  const approverId = (session?.user as any)?.id ?? null;

  const [pending] = await db.select().from(pendingApprovals)
    .where(and(eq(pendingApprovals.id, params.id), eq(pendingApprovals.orgId, orgId!))).limit(1);
  if (!pending) return bad("Approval request not found", 404);
  if (pending.status !== "Pending") return bad("This request has already been decided", 409);
  if (pending.requestedBy && approverId && pending.requestedBy === approverId) {
    return bad("You can't approve your own request — a different user must approve it", 403);
  }

  try {
    let result: any;
    const opts = { skipApprovalCheck: true } as const;
    switch (pending.entityType) {
      case "jobwork_dispatch": result = await dispatchToJobWorker(orgId!, pending.payloadJson as any, pending.requestedBy, opts); break;
      case "production_build": result = await buildProduction(orgId!, pending.payloadJson as any, pending.requestedBy, opts); break;
      case "production_build_multi": {
        const payload = pending.payloadJson as any;
        result = await buildProductionMulti(orgId!, payload, pending.requestedBy, opts);
        if (payload?.moId) {
          await db.update(manufacturingOrders).set({ status: "Completed", productionRunId: result.id, updatedAt: new Date() })
            .where(and(eq(manufacturingOrders.id, payload.moId), eq(manufacturingOrders.orgId, orgId!)));
        }
        break;
      }
      case "goods_receipt": result = await postGoodsReceipt(orgId!, pending.payloadJson as any, pending.requestedBy, opts); break;
      case "shipment": result = await postShipment(orgId!, pending.payloadJson as any, pending.requestedBy, opts); break;
      default: return bad(`Unknown approval entity type: ${pending.entityType}`, 500);
    }
    await db.update(pendingApprovals).set({
      status: "Approved", approvedBy: approverId, approvedAt: new Date(), resultId: result?.id ?? null,
    }).where(and(eq(pendingApprovals.id, pending.id), eq(pendingApprovals.orgId, orgId!)));
    return ok({ approved: true, result });
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[approval approve]", e);
    return bad("Could not post the approved transaction", 500);
  }
}
