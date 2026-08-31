/** GET /api/production/mos → list MOs · POST → create an MO */

import { requireOrg, ok, bad, canPostInventoryTxn } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { listMOs, createMO } from "@/lib/inventory/manufacturing-orders";
import { LedgerValidationError } from "@/lib/ledger";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  return ok(await listMOs(orgId!));
}

export async function POST(req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!canPostInventoryTxn(role)) return bad("You don't have permission for this action", 403);
  try { return ok(await createMO(orgId!, await req.json().catch(() => ({})), (session?.user as any)?.id ?? null)); }
  catch (e: any) { if (e instanceof LedgerValidationError) return bad(e.message); console.error("[mo create]", e); return bad("Could not create MO", 500); }
}
