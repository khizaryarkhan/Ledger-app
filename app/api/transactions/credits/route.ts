/** GET /api/transactions/credits?side=customer|vendor&partyId= → available credits. */

import { requireOrg, ok, bad } from "@/lib/api";
import { availableCreditsForParty } from "@/lib/accounting/payments";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const u = new URL(req.url);
  const side = u.searchParams.get("side");
  const partyId = u.searchParams.get("partyId");
  if ((side !== "customer" && side !== "vendor") || !partyId) return bad("side and partyId are required");
  return ok(await availableCreditsForParty(orgId!, side, partyId));
}
