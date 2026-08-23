/** DELETE /api/inventory/production/[id] → void a production build (guarded). */

import { requireOrg, ok, bad } from "@/lib/api";
import { voidProductionRun } from "@/lib/inventory/void";
import { LedgerValidationError } from "@/lib/ledger";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  try { return ok(await voidProductionRun(orgId!, params.id)); }
  catch (e: any) { if (e instanceof LedgerValidationError) return bad(e.message, 409); console.error("[production void]", e); return bad("Could not void production run", 500); }
}
