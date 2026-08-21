/**
 * POST /api/documents/[type]  → post a native transaction document to the GL.
 * type ∈ Invoice | SalesReceipt | CreditNote | RefundReceipt | Bill | Expense |
 *        VendorCredit | Payment | BillPayment | Deposit | Transfer
 *
 * Outside /api/accounting to avoid the [entity] dynamic-route collision. All
 * double-entry rules live in lib/accounting/documents — this is a thin wrapper.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { postDocument } from "@/lib/accounting/documents";
import { DOC_TYPES, type DocType } from "@/lib/accounting/numbering";
import { LedgerValidationError } from "@/lib/ledger";

const POSTABLE = new Set<DocType>(DOC_TYPES.map(d => d.type).filter(t => t !== "Journal" && t !== "Estimate"));

export async function POST(req: Request, { params }: { params: { type: string } }) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  if (!POSTABLE.has(params.type as DocType)) return bad("Unknown document type", 404);

  const body = await req.json().catch(() => ({}));
  const actorId = (session?.user as any)?.id ?? null;

  try {
    const entry = await postDocument(orgId!, { ...body, type: params.type as DocType }, actorId);
    return ok(entry);
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error(`[documents] post ${params.type} failed:`, e);
    return bad("Failed to post document", 500);
  }
}
