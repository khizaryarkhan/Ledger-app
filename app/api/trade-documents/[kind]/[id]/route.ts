/** DELETE /api/trade-documents/[kind]/[id] → delete an estimate / PO / SO (guarded). */

import { requireOrg, ok, bad } from "@/lib/api";
import { deleteTradeDoc } from "@/lib/accounting/trade-documents";
import { LedgerValidationError } from "@/lib/ledger";

export async function DELETE(_req: Request, { params }: { params: { kind: string; id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  try { return ok(await deleteTradeDoc(orgId!, params.id)); }
  catch (e: any) { if (e instanceof LedgerValidationError) return bad(e.message, 409); console.error("[trade-doc delete]", e); return bad("Could not delete document", 500); }
}
