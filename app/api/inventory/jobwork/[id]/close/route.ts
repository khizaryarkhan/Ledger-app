/**
 * POST /api/inventory/jobwork/[id]/close → declare no more receipts are
 * expected against this dispatch; recognizes any wastage/yield gain.
 */

import { requireOrg, ok, bad, canPostInventoryTxn } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { closeJobWorkOrder } from "@/lib/inventory/jobwork";
import { LedgerValidationError } from "@/lib/ledger";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!canPostInventoryTxn(role)) return bad("You don't have permission to close job work orders", 403);
  const body = (await req.json().catch(() => ({}))) as { confirmGain?: boolean };
  try {
    const res = await closeJobWorkOrder(orgId!, params.id, (session?.user as any)?.id ?? null, { confirmGain: body.confirmGain });
    return ok(res);
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[jobwork] close failed:", e);
    return bad("Failed to close job work order", 500);
  }
}
