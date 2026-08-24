/**
 * GET    /api/production/mos/[id]  → MO + output item + material availability
 * PATCH  /api/production/mos/[id]  → edit fields, or { status } to transition
 * DELETE /api/production/mos/[id]  → delete (guarded: not once built)
 */

import { requireOrg, ok, bad, canPostInventoryTxn } from "@/lib/api";
import { moDetail, updateMO, setMoStatus, deleteMO, type MoStatus } from "@/lib/inventory/manufacturing-orders";
import { LedgerValidationError } from "@/lib/ledger";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const d = await moDetail(orgId!, params.id);
  if (!d) return bad("MO not found", 404);
  return ok(d);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!canPostInventoryTxn(role)) return bad("You don't have permission for this action", 403);
  const b = await req.json().catch(() => ({}));
  try {
    if (b?.status) return ok(await setMoStatus(orgId!, params.id, b.status as MoStatus));
    return ok(await updateMO(orgId!, params.id, b));
  } catch (e: any) { if (e instanceof LedgerValidationError) return bad(e.message); console.error("[mo patch]", e); return bad("Could not update MO", 500); }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!canPostInventoryTxn(role)) return bad("You don't have permission for this action", 403);
  try { return ok(await deleteMO(orgId!, params.id)); }
  catch (e: any) { if (e instanceof LedgerValidationError) return bad(e.message, 409); console.error("[mo delete]", e); return bad("Could not delete MO", 500); }
}
