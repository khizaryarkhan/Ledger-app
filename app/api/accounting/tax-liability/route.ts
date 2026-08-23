/** GET /api/accounting/tax-liability?from=YYYY-MM-DD&to=YYYY-MM-DD */

import { requireOrg, ok } from "@/lib/api";
import { taxLiability } from "@/lib/accounting/analysis";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const p = new URL(req.url).searchParams;
  const to = p.get("to") || new Date().toISOString().slice(0, 10);
  const from = p.get("from") || `${to.slice(0, 4)}-01-01`;
  return ok(await taxLiability(orgId!, from, to));
}
