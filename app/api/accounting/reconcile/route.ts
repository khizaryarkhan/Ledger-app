/**
 * GET    /api/accounting/reconcile              → bank/credit-card accounts
 * GET    /api/accounting/reconcile?accountId=   → working view for one account
 * POST   /api/accounting/reconcile              → finalize a reconciliation
 * DELETE /api/accounting/reconcile?id=          → undo a reconciliation
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { bankAccounts, reconcileView, finalizeReconciliation, unreconcile, type FinalizeInput } from "@/lib/accounting/reconciliation";
import { LedgerValidationError } from "@/lib/ledger";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const accountId = new URL(req.url).searchParams.get("accountId");
  if (!accountId) return ok(await bankAccounts(orgId!));
  return ok(await reconcileView(orgId!, accountId));
}

export async function POST(req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const b = (await req.json().catch(() => ({}))) as FinalizeInput;
  try { return ok(await finalizeReconciliation(orgId!, b, (session?.user as any)?.id ?? null)); }
  catch (e: any) { if (e instanceof LedgerValidationError) return bad(e.message); console.error("[reconcile]", e); return bad("Could not reconcile", 500); }
}

export async function DELETE(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  return ok(await unreconcile(orgId!, id));
}
