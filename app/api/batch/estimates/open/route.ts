/**
 * GET /api/batch/estimates/open?status=&from=&to=
 * Estimates (default Accepted) with per-line already-invoiced / remaining,
 * for the interactive Invoice-from-Estimates screen.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { getOrgQboToken } from "@/lib/qbo-token";
import { getOpenEstimates } from "@/lib/batch/estimate-invoicing";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected for this organisation", 400);

  const sp = new URL(req.url).searchParams;
  try {
    const estimates = await getOpenEstimates(token, {
      status: sp.get("status") || undefined,
      from: sp.get("from") || undefined,
      to: sp.get("to") || undefined,
    });
    return ok({ estimates });
  } catch (e: any) {
    return bad(e?.message || "Failed to load estimates", 502);
  }
}
