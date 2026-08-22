/** GET /api/transactions/open?side=customer|vendor&partyId= → open invoices/bills. */

import { requireOrg, ok, bad } from "@/lib/api";
import { openDocsForParty } from "@/lib/accounting/payments";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const u = new URL(req.url);
  const side = u.searchParams.get("side");
  const partyId = u.searchParams.get("partyId");
  if ((side !== "customer" && side !== "vendor") || !partyId) return bad("side and partyId are required");
  return ok(await openDocsForParty(orgId!, side, partyId, u.searchParams.get("excludeContext") || undefined));
}
