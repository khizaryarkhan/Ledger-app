/** POST /api/inventory/receiving/bill → create a Bill from receipts (clears GR/IR → A/P). */

import { requireOrg, ok, bad } from "@/lib/api";
import { billFromReceipts, type BillFromReceiptsInput } from "@/lib/inventory/receiving";
import { LedgerValidationError } from "@/lib/ledger";

export async function POST(req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const body = (await req.json().catch(() => ({}))) as BillFromReceiptsInput;
  try {
    const res = await billFromReceipts(orgId!, body, (session?.user as any)?.id ?? null);
    return ok(res);
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[receiving] bill failed:", e);
    return bad("Failed to create bill", 500);
  }
}
