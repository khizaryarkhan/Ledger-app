/**
 * GET /api/batch/debug/deposit-reduce?id=<Id>
 *
 * DIAGNOSTIC (mutates ONE deposit — run only on a deposit you can restore).
 *
 * Reduces a deposit to just its FIRST line via a REAL QBO update
 * (?operation=update, full/non-sparse), using QuickBooks' OWN line objects, and
 * reports:
 *   - responseId : the Id QBO returned. If it EQUALS the input id, QBO updated
 *                  the record in place. If it DIFFERS, QBO created a NEW deposit
 *                  (which means our earlier no-operation tests were making
 *                  duplicates, not updating).
 *   - after      : the line count of the ORIGINAL deposit, re-read by its id.
 *
 * ?op=none drops the operation param (the old, possibly-a-create behaviour) for
 * comparison. Default is the correct ?operation=update.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { getOrgQboToken } from "@/lib/qbo-token";
import { qboReadOne, qboPost } from "@/lib/batch/qbo-client";

export const runtime = "nodejs";
export const maxDuration = 60;

const lineView = (L: any[] = []) =>
  L.map((l) => ({ lineId: l.Id ?? null, detailType: l.DetailType ?? null, amount: l.Amount ?? null }));

function firstRecord(data: any) {
  if (!data) return null;
  const key = Object.keys(data).find((k) => k !== "time");
  return key ? data[key] : null;
}

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  const useOperation = (url.searchParams.get("op") || "update") !== "none";
  if (!id) return bad("Pass ?id=<deposit internal Id> (from /api/batch/debug/record?entity=deposit&list=1)");

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected", 400);

  const before = await qboReadOne(token, "deposit", id);
  if (!before) return bad(`No deposit with internal Id "${id}". Run /api/batch/debug/record?entity=deposit&list=1 for real Ids.`, 404);

  const beforeLines = before.Line || [];
  if (beforeLines.length <= 1) return bad(`Deposit ${id} has ${beforeLines.length} line(s) — pick one with 2+ lines.`, 400);

  // Canonical FULL update: whole record, but only its first line. QBO's own line
  // object (valid id + full detail), so our builder isn't a variable.
  const payload: any = { ...before, Line: [beforeLines[0]], Id: String(before.Id), SyncToken: String(before.SyncToken ?? "0") };
  delete payload.sparse;
  delete payload.TotalAmt;   // read-only — let QBO recompute from the lines
  delete payload.MetaData;

  const res = await qboPost(token, "deposit", payload, useOperation ? { operation: "update" } : {});
  const responseRec = res.ok ? firstRecord(res.data) : null;
  const responseId = responseRec?.Id ?? null;

  const after = await qboReadOne(token, "deposit", String(before.Id));
  const afterCount = after ? (after.Line || []).length : null;

  let verdict: string;
  if (!res.ok) verdict = `QBO rejected the update: ${res.error}`;
  else if (responseId && String(responseId) !== String(before.Id))
    verdict = `QBO CREATED A NEW deposit (#${responseId}) instead of updating #${before.Id} — this call is a create, not an update. Original left at ${afterCount} lines.`;
  else if (afterCount === 1)
    verdict = `IN-PLACE SUCCESS — QBO updated deposit #${before.Id} in place and deleted the omitted lines. Same Id.`;
  else
    verdict = `QBO updated #${before.Id} in place (same Id) but KEPT ${afterCount} lines — it does not delete omitted deposit lines even on a real ?operation=update.`;

  return ok({
    depositId: before.Id,
    call: useOperation ? "POST /deposit?operation=update (real full update)" : "POST /deposit (no operation param)",
    responseId,
    sameRecord: responseId != null ? String(responseId) === String(before.Id) : null,
    before: { lineCount: beforeLines.length, lines: lineView(beforeLines) },
    sent: { lineCount: 1, lines: lineView([beforeLines[0]]) },
    qbo: { ok: res.ok, error: res.error ?? null, status: res.status ?? null },
    after: after ? { lineCount: afterCount, lines: lineView(after.Line) } : null,
    verdict,
  });
}
