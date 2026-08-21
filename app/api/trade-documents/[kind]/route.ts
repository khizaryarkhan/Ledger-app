/**
 * GET  /api/trade-documents/[kind]  → list  (kind = estimates | purchase-orders)
 * POST /api/trade-documents/[kind]  → create a non-posting trade document
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { createTradeDoc, listTradeDocs, type TradeKind } from "@/lib/accounting/trade-documents";
import { LedgerValidationError } from "@/lib/ledger";

function kindOf(slug: string): TradeKind | null {
  if (slug === "estimates") return "Estimate";
  if (slug === "purchase-orders") return "PurchaseOrder";
  return null;
}

export async function GET(_req: Request, { params }: { params: { kind: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const kind = kindOf(params.kind);
  if (!kind) return bad("Unknown document kind", 404);
  return ok(await listTradeDocs(orgId!, kind));
}

export async function POST(req: Request, { params }: { params: { kind: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const kind = kindOf(params.kind);
  if (!kind) return bad("Unknown document kind", 404);

  const body = await req.json().catch(() => ({}));
  try {
    return ok(await createTradeDoc(orgId!, kind, body, (session?.user as any)?.id ?? null));
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error(`[trade-documents] create ${kind} failed:`, e);
    return bad("Failed to save document", 500);
  }
}
