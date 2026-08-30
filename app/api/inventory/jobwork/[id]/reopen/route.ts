/**
 * POST /api/inventory/jobwork/[id]/reopen → undo a close, reversing the
 * wastage/yield-gain entry (if any) so more receipts can be posted.
 */

import { requireOrg, ok, bad, canPostInventoryTxn } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { reopenJobWorkOrder } from "@/lib/inventory/jobwork";
import { LedgerValidationError } from "@/lib/ledger";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!canPostInventoryTxn(role)) return bad("You don't have permission to reopen job work orders", 403);
  try {
    const res = await reopenJobWorkOrder(orgId!, params.id);
    return ok(res);
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[jobwork] reopen failed:", e);
    return bad("Failed to reopen job work order", 500);
  }
}
