/**
 * GET /api/financials?statement=trial-balance|profit-loss|balance-sheet
 *   &from=YYYY-MM-DD&to=YYYY-MM-DD&asOf=YYYY-MM-DD
 *
 * Native financial statements computed from the general ledger. Scope-aware:
 * in a Head-Office group view it consolidates across all branches.
 */

import { requireReadScope, ok, bad } from "@/lib/api";
import { trialBalance, profitAndLoss, balanceSheet } from "@/lib/accounting/financials";

export const runtime = "nodejs";

const isDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function GET(req: Request) {
  const { error, orgIds } = await requireReadScope();
  if (error) return error;

  const url = new URL(req.url);
  const statement = url.searchParams.get("statement") || "trial-balance";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const asOf = url.searchParams.get("asOf");

  try {
    if (statement === "trial-balance") {
      return ok(await trialBalance(orgIds, isDate(asOf) ? asOf! : undefined));
    }
    if (statement === "profit-loss") {
      return ok(await profitAndLoss(orgIds, isDate(from) ? from! : undefined, isDate(to) ? to! : undefined));
    }
    if (statement === "balance-sheet") {
      return ok(await balanceSheet(orgIds, isDate(asOf) ? asOf! : undefined));
    }
    return bad("Unknown statement", 404);
  } catch (e: any) {
    console.error("[financials]", e);
    return bad(e?.message || "Failed to build statement", 500);
  }
}
