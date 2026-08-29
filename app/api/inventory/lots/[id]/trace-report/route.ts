/** GET /api/inventory/lots/[id]/trace-report — the printable batch traceability report. */

import { requireOrg, ok, bad } from "@/lib/api";
import { buildLotTraceReport } from "@/lib/inventory/genealogy";
import { loadCompany } from "@/lib/accounting/document-print";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const report = await buildLotTraceReport(orgId!, params.id);
  if (!report) return bad("Lot not found", 404);
  const company = await loadCompany(orgId!);
  return ok({ ...report, company });
}
