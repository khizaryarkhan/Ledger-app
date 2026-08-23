/** GET /api/accounting/aging?side=receivable|payable[&asOf=YYYY-MM-DD] */

import { requireOrg, ok } from "@/lib/api";
import { aging } from "@/lib/accounting/analysis";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const p = new URL(req.url).searchParams;
  const side = p.get("side") === "payable" ? "payable" : "receivable";
  const asOf = p.get("asOf") || undefined;
  return ok(await aging(orgId!, side, asOf));
}
