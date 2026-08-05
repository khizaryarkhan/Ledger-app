/**
 * POST /api/batch/estimates/invoiced  { ids: [qboEstimateId] }
 * Returns per-line already-invoiced amounts for the given estimates (from their
 * linked QBO invoices), plus whether QBO honours custom invoice numbers. Called
 * by the worksheet after the fast DB load to hydrate Already / Remaining.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { getOrgQboToken } from "@/lib/qbo-token";
import { qboQueryAll } from "@/lib/batch/qbo-client";
import { fetchLinkedInvoices, invoicedByLineIndex } from "@/lib/batch/estimate-invoicing";
import { RefResolver } from "@/lib/batch/ref-resolver";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.map(String) : [];

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected for this organisation", 400);

  const customTxnNumbers = await new RefResolver(token).company().then((c) => c.customTxnNumbers).catch(() => false);

  const invoiced: Record<string, number[]> = {};
  if (ids.length > 0) {
    // Pull just these estimates (chunked) so we have their LinkedTxn + lines.
    const estimatesById = new Map<string, any>();
    for (let i = 0; i < ids.length; i += 80) {
      const inList = ids.slice(i, i + 80).map((x) => `'${x}'`).join(",");
      const recs = await qboQueryAll(token, "Estimate", `Id IN (${inList})`).catch(() => []);
      for (const r of recs) estimatesById.set(String(r.Id), r);
    }
    const invoiceById = await fetchLinkedInvoices(token, [...estimatesById.values()]);
    for (const [id, est] of estimatesById) invoiced[id] = invoicedByLineIndex(est, invoiceById);
  }

  return ok({ invoiced, customTxnNumbers });
}
