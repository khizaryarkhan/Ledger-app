/**
 * GET /api/inventory/lot-suggestion
 *
 * Peeks (doesn't consume) the next Stock-Item/Raw-Material lot code, for
 * pre-filling the lot-number field on Goods Receipt / Bill lines. The user
 * can accept it or overwrite it with a supplier's own batch number — either
 * way lib/inventory/valuation.ts's resolveLotNo (via resolveDocNumber)
 * records what was actually used and advances the series past it.
 * Finished Product / Work in Progress lots are never suggested here — they're
 * always system-generated at commit time, not editable.
 */

import { requireOrg, ok } from "@/lib/api";
import { peekDocNumber } from "@/lib/accounting/numbering";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const code = await peekDocNumber(orgId!, "LotSIRM");
  return ok({ code });
}
