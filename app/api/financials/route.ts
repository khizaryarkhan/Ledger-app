/**
 * GET /api/financials?statement=trial-balance|profit-loss|balance-sheet
 *   &from=YYYY-MM-DD&to=YYYY-MM-DD&asOf=YYYY-MM-DD
 *
 * Native financial statements computed from the general ledger. Scope-aware:
 * in a Head-Office group view it consolidates across all branches.
 */

import { requireReadScope, ok, bad } from "@/lib/api";
import { trialBalance, profitAndLoss, balanceSheet, generalLedger } from "@/lib/accounting/financials";
import { db } from "@/db";
import { organisations, orgGroups } from "@/db/schema";
import { inArray, eq } from "drizzle-orm";

export const runtime = "nodejs";

const isDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

// Entity name + currency for the statement header (the way a CA presents it).
async function buildMeta(orgIds: string[], groupId: string | null) {
  const orgs = orgIds.length
    ? await db.select({ name: organisations.name, displayName: organisations.displayName, currency: organisations.currency })
        .from(organisations).where(inArray(organisations.id, orgIds))
    : [];
  let entity = "—";
  if (orgIds.length > 1) {
    let gname: string | null = null;
    if (groupId) { const [g] = await db.select({ name: orgGroups.name }).from(orgGroups).where(eq(orgGroups.id, groupId)).limit(1); gname = g?.name ?? null; }
    entity = gname ? `${gname} — Consolidated` : `Consolidated (${orgIds.length} entities)`;
  } else {
    entity = orgs[0]?.displayName || orgs[0]?.name || "—";
  }
  return { entity, currency: orgs[0]?.currency || "PKR", consolidated: orgIds.length > 1 };
}

export async function GET(req: Request) {
  const { error, orgIds, groupId } = await requireReadScope();
  if (error) return error;

  const url = new URL(req.url);
  const statement = url.searchParams.get("statement") || "trial-balance";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const asOf = url.searchParams.get("asOf");

  try {
    const meta = await buildMeta(orgIds, groupId ?? null);
    if (statement === "trial-balance") {
      return ok({ ...(await trialBalance(orgIds, isDate(asOf) ? asOf! : undefined)), meta });
    }
    if (statement === "profit-loss") {
      return ok({ ...(await profitAndLoss(orgIds, isDate(from) ? from! : undefined, isDate(to) ? to! : undefined)), meta });
    }
    if (statement === "balance-sheet") {
      const [org] = orgIds.length
        ? await db.select({ fym: organisations.fiscalYearStartMonth }).from(organisations).where(eq(organisations.id, orgIds[0])).limit(1)
        : [];
      return ok({ ...(await balanceSheet(orgIds, isDate(asOf) ? asOf! : undefined, org?.fym ?? 1)), meta });
    }
    if (statement === "general-ledger") {
      const accountId = url.searchParams.get("accountId") || undefined;
      return ok({ ...(await generalLedger(orgIds, { accountId, from: isDate(from) ? from! : undefined, to: isDate(to) ? to! : undefined })), meta });
    }
    return bad("Unknown statement", 404);
  } catch (e: any) {
    console.error("[financials]", e);
    return bad(e?.message || "Failed to build statement", 500);
  }
}
