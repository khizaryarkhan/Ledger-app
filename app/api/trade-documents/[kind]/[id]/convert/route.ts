/** POST /api/trade-documents/[kind]/[id]/convert → Estimate→Invoice / PO→Bill. */

import { requireOrg, ok, bad } from "@/lib/api";
import { convertTradeDoc } from "@/lib/accounting/trade-documents";
import { LedgerValidationError } from "@/lib/ledger";

export async function POST(_req: Request, { params }: { params: { kind: string; id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  try {
    return ok(await convertTradeDoc(orgId!, params.id, (session?.user as any)?.id ?? null));
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[trade-documents] convert failed:", e);
    return bad("Failed to convert document", 500);
  }
}
