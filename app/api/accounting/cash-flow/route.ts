/** GET /api/accounting/cash-flow?from=&to= → indirect-method cash flow statement. */

import { requireOrg, ok } from "@/lib/api";
import { cashFlow } from "@/lib/accounting/analysis";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const p = new URL(req.url).searchParams;
  const to = p.get("to") || new Date().toISOString().slice(0, 10);
  const from = p.get("from") || `${to.slice(0, 4)}-01-01`;
  return ok(await cashFlow(orgId!, from, to));
}
