/** GET /api/trade-documents/[kind]/[id]/lines → lines with per-line remaining. */

import { requireOrg, ok } from "@/lib/api";
import { tradeDocLines } from "@/lib/accounting/trade-documents";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  return ok(await tradeDocLines(orgId!, params.id));
}
