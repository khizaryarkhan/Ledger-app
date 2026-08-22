/**
 * POST /api/ledger/journal/[id]/reverse — reverse a posted entry.
 * Entries are never edited or deleted; this posts a mirrored entry and links
 * the pair.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { reverseJournalEntry, LedgerValidationError } from "@/lib/ledger";
import { onEntryReversed } from "@/lib/accounting/documents";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  try {
    const body = await req.json().catch(() => ({}));
    const reversal = await reverseJournalEntry(
      orgId!,
      params.id,
      (session?.user as any)?.id ?? null,
      typeof body?.entryDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.entryDate) ? body.entryDate : undefined,
    );
    await onEntryReversed(orgId!, params.id).catch((e) => console.error("[reverse bridge]", e));
    return ok(reversal);
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[ledger] reverse failed:", e);
    return bad("Failed to reverse entry", 500);
  }
}
