/**
 * GET /api/batch/debug/deposit-reduce?id=<Id or DocNumber>
 *
 * DIAGNOSTIC (mutates ONE deposit — run only on a throwaway test deposit).
 *
 * Reduces a deposit to just its FIRST line, using QuickBooks' OWN line objects
 * (so our builder/download is NOT a variable), via a canonical full update, and
 * returns before → sent → QBO response → after. This answers, definitively,
 * whether QuickBooks deletes a deposit's omitted lines on a full update at all.
 *
 * ?mode=operation adds the ?operation=update query param the importer uses;
 * default sends a plain full update (no operation param) to compare.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { getOrgQboToken } from "@/lib/qbo-token";
import { qboReadOne, qboQueryAll, qboPost } from "@/lib/batch/qbo-client";

export const runtime = "nodejs";
export const maxDuration = 60;

const lineView = (L: any[] = []) => L.map((l) => ({ lineId: l.Id ?? null, detailType: l.DetailType ?? null, amount: l.Amount ?? null }));

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const url = new URL(req.url);
  const idOrNo = url.searchParams.get("id") || "";
  const useOperation = url.searchParams.get("mode") === "operation";
  if (!idOrNo) return bad("Pass ?id=<deposit Id or DocNumber>");

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected", 400);

  // Resolve the deposit by internal Id, else by DocNumber.
  let before = await qboReadOne(token, "deposit", idOrNo);
  if (!before) {
    try {
      const rows = await qboQueryAll(token, "Deposit", `DocNumber = '${idOrNo.replace(/'/g, "\\'")}'`);
      before = rows[0] ?? null;
    } catch { /* ignore */ }
  }
  if (!before) return bad(`No deposit matched "${idOrNo}". Try /api/batch/debug/record?entity=deposit&list=1 for real Ids.`, 404);

  const beforeLines = before.Line || [];
  if (beforeLines.length <= 1) return bad(`This deposit already has ${beforeLines.length} line(s) — pick one with 2+ lines to test the reduce.`, 400);

  const mode = url.searchParams.get("mode") || "";
  const idT = String(before.Id);
  const tokenT = String(before.SyncToken ?? "0");
  // Build the update payload:
  //  - minimal : only the required fields + the one line (no stale TotalAmt/
  //              MetaData) — rules out "QBO ignored the lines because the total
  //              I echoed back didn't match".
  //  - operation/default : echo the whole record with just line #1.
  let payload: any;
  if (mode === "minimal") {
    payload = { DepositToAccountRef: before.DepositToAccountRef, Line: [beforeLines[0]], Id: idT, SyncToken: tokenT };
    if (before.CurrencyRef) payload.CurrencyRef = before.CurrencyRef;
  } else {
    payload = { ...before, Line: [beforeLines[0]], Id: idT, SyncToken: tokenT };
    delete payload.TotalAmt; // read-only; let QBO recompute from the lines
    delete payload.MetaData;
  }
  delete payload.sparse;

  const res = await qboPost(token, "deposit", payload, useOperation ? { operation: "update" } : {});

  const after = await qboReadOne(token, "deposit", String(before.Id));

  return ok({
    depositId: before.Id,
    mode: mode === "minimal" ? "minimal payload (account + 1 line)" : useOperation ? "full record + ?operation=update" : "full record, plain update (TotalAmt/MetaData stripped)",
    before: { lineCount: beforeLines.length, lines: lineView(beforeLines) },
    sent: { lineCount: 1, lines: lineView([beforeLines[0]]) },
    qbo: { ok: res.ok, error: res.error ?? null, status: res.status ?? null },
    after: after ? { lineCount: (after.Line || []).length, lines: lineView(after.Line) } : null,
    verdict: after
      ? ((after.Line || []).length === 1
          ? "QBO DELETED the omitted lines — full update replace works; the importer path is the problem."
          : `QBO KEPT ${(after.Line || []).length} lines — QuickBooks did NOT delete omitted deposit lines on a full update.`)
      : "could not re-read after",
  });
}
