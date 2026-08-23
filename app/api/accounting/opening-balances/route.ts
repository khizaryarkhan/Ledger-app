/**
 * GET  /api/accounting/opening-balances → current opening entry
 * POST /api/accounting/opening-balances → set/replace opening balances
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { getOpeningBalances, setOpeningBalances } from "@/lib/accounting/opening-balances";
import { LedgerValidationError } from "@/lib/ledger";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  return ok(await getOpeningBalances(orgId!));
}

export async function POST(req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const b = await req.json().catch(() => ({}));
  try {
    const res = await setOpeningBalances(orgId!, String(b?.date ?? ""), Array.isArray(b?.entries) ? b.entries : [], (session?.user as any)?.id ?? null);
    return ok(res);
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[opening-balances]", e);
    return bad("Could not save opening balances", 500);
  }
}
