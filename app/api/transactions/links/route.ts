/** GET /api/transactions/links?type=&id= → all documents linked to (type,id). */

import { requireOrg, ok, bad } from "@/lib/api";
import { linksFor } from "@/lib/accounting/links";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const u = new URL(req.url);
  const type = u.searchParams.get("type");
  const id = u.searchParams.get("id");
  if (!type || !id) return bad("type and id are required");
  return ok(await linksFor(orgId!, type, id));
}
