/**
 * POST /api/inventory/jobwork/[id]/receive → receive the transformed good back
 * from the job worker, closing out that dispatch.
 */

import { requireOrg, ok, bad, canPostInventoryTxn } from "@/lib/api";
import { receiveFromJobWork, type ReceiveInput } from "@/lib/inventory/jobwork";
import { LedgerValidationError } from "@/lib/ledger";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (!canPostInventoryTxn(role)) return bad("You don't have permission to post job work receipts", 403);
  const body = (await req.json().catch(() => ({}))) as Omit<ReceiveInput, "jobWorkOrderId">;
  try {
    const res = await receiveFromJobWork(orgId!, { ...body, jobWorkOrderId: params.id }, (session?.user as any)?.id ?? null);
    return ok(res);
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[jobwork] receive failed:", e);
    return bad("Failed to post job work receipt", 500);
  }
}
