/** POST /api/production/mos/[id]/complete → run the build & complete the MO. */

import { requireOrg, ok, bad, canPostInventoryTxn } from "@/lib/api";
import { completeMO } from "@/lib/inventory/manufacturing-orders";
import { LedgerValidationError } from "@/lib/ledger";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (!canPostInventoryTxn(role)) return bad("You don't have permission for this action", 403);
  const b = await req.json().catch(() => ({}));
  try { return ok(await completeMO(orgId!, params.id, (session?.user as any)?.id ?? null, b)); }
  catch (e: any) { if (e instanceof LedgerValidationError) return bad(e.message); console.error("[mo complete]", e); return bad("Could not complete MO", 500); }
}
