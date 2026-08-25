/**
 * GET /api/print/document?kind=ledger|trade&id=…
 *   → the complete, print-ready shape of one business document.
 *
 * One endpoint for both document families so the printed output is identical in
 * structure whether it came from the ledger (Invoice/Bill) or from a trade
 * document (Quote/PO/SO).
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { loadLedgerDocumentForPrint, loadTradeDocumentForPrint } from "@/lib/accounting/document-print";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const kind = url.searchParams.get("kind") ?? "ledger";
  if (!id) return bad("A document id is required");

  const doc = kind === "trade"
    ? await loadTradeDocumentForPrint(orgId!, id)
    : await loadLedgerDocumentForPrint(orgId!, id);

  if (!doc) return bad("Document not found", 404);
  return ok(doc);
}
