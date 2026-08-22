/**
 * GET /api/documents/[type]/[id]  → the stored form payload, for reopen-to-edit.
 * PUT /api/documents/[type]/[id]  → edit a line-item document in place.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { documentPayload, updateDocument } from "@/lib/accounting/documents";
import { DocType } from "@/lib/accounting/numbering";
import { LedgerValidationError } from "@/lib/ledger";

export async function GET(_req: Request, { params }: { params: { type: string; id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const d = await documentPayload(orgId!, params.id);
  if (!d) return bad("Transaction not found", 404);
  return ok(d);
}

export async function PUT(req: Request, { params }: { params: { type: string; id: string } }) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  try {
    const entry = await updateDocument(orgId!, params.id, { ...body, type: params.type as DocType }, (session?.user as any)?.id ?? null);
    return ok(entry);
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error(`[documents] edit ${params.type} failed:`, e);
    return bad("Failed to save changes", 500);
  }
}
