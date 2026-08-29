/** GET /api/inventory/lots/[id]/genealogy → a lot's full ancestor/descendant chain. */

import { requireOrg, ok, bad } from "@/lib/api";
import { lotFullGenealogy } from "@/lib/inventory/genealogy";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const data = await lotFullGenealogy(orgId!, params.id);
  if (!data) return bad("Lot not found", 404);
  return ok(data);
}
