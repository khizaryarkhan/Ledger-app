/** GET /api/production/mos → list MOs · POST → create an MO */

import { requireOrg, ok, bad } from "@/lib/api";
import { listMOs, createMO } from "@/lib/inventory/manufacturing-orders";
import { LedgerValidationError } from "@/lib/ledger";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  return ok(await listMOs(orgId!));
}

export async function POST(req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  try { return ok(await createMO(orgId!, await req.json().catch(() => ({})), (session?.user as any)?.id ?? null)); }
  catch (e: any) { if (e instanceof LedgerValidationError) return bad(e.message); console.error("[mo create]", e); return bad("Could not create MO", 500); }
}
