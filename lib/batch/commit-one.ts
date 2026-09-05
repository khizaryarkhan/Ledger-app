/**
 * Commit ONE document to QuickBooks — the single per-record write shared by the
 * legacy whole-file runner and the new chunked runner, so both apply identical
 * create/update rules (including the estimate progress-invoicing safety).
 */

import { qboPost, qboReadOne, qboBatch, qboQueryAll, type BatchItem } from "./qbo-client";
import type { OrgQboToken } from "@/lib/qbo-token";
import type { RefResolver } from "./ref-resolver";

function firstRecord(data: any) {
  if (!data) return null;
  const key = Object.keys(data).find((k) => k !== "time");
  return key ? data[key] : null;
}

/** A short human key for a document (Invoice No / Name / …) for error display. */
export function docKeyOf(entity: any, d: any): string | null {
  const r = d?.rows?.[0] ?? {};
  const cands = [entity.docKey, entity.refNumberColumn, "Name", "DisplayName", "Title"].filter(Boolean) as string[];
  for (const c of cands) {
    const v = r[c] ?? r[c + " "] ?? r[(c || "").trim()];
    if (v != null && String(v).trim() !== "") return String(v).trim().slice(0, 120);
  }
  return null;
}

export type CommitResult =
  | { ok: true; qboId?: string; docNumber?: string }
  | { ok: false; error: string };

/**
 * Shapes the outgoing payload for an UPDATE. Pure — no I/O — so the
 * sparse-vs-full decision and the CustomField-preservation merge can be
 * verified directly without a QBO connection.
 *
 * The decision: QuickBooks' sparse-update rule for the Line collection is
 * "a line without its own line-level Id is a NEW line; anything not
 * mentioned is left alone" — never a replace. Data Studio never round-trips
 * QBO's per-line ids (only the document-level Id/SyncToken), so every line
 * we send is always id-less — meaning sparse mode turned every edit into an
 * append, which is the exact bug reported: edit the lines in the downloaded
 * sheet, re-upload, and QuickBooks shows the new lines ADDED to the old ones
 * instead of replacing them.
 *
 * A FULL (non-sparse) update instead treats the submitted Line array as the
 * complete new truth: whatever isn't in it gets removed. That's what "I
 * edited the sheet" means, and it's the fix — but a full update also resets
 * any header field QBO tracks that we don't send. Our builders don't model
 * CustomField, so it's preserved from the existing record rather than
 * blanked (mirrors field-edit's merge, going the other direction).
 */
export function shapeModifyPayload(
  payload: any,
  id: string,
  syncToken: string,
  existing: any,
): any {
  const hasLines = Array.isArray(payload.Line) && payload.Line.length > 0;
  const out = { ...payload, Id: String(id), SyncToken: String(syncToken ?? "0") };

  if (hasLines) {
    if (Array.isArray(existing?.CustomField) && existing.CustomField.length && out.CustomField == null) {
      out.CustomField = existing.CustomField;
    }
    // sparse deliberately NOT set — see function comment.
  } else {
    // No lines in this payload (list entities, Transfer, TimeActivity, …) —
    // a plain sparse patch is correct and safe here.
    out.sparse = true;
  }
  return out;
}

export async function commitOneDoc(
  token: OrgQboToken,
  entity: any,
  operation: "upload" | "modify",
  doc: any,
  resolver: RefResolver,
): Promise<CommitResult> {
  const built = await entity.build(doc, resolver);
  let payload = built.payload;

  if (operation === "modify") {
    const id = doc.rows[0]["Id"] ?? doc.rows[0]["QBO Id"];
    const syncToken = doc.rows[0]["SyncToken"] ?? doc.rows[0]["Sync Token"];
    if (!id) throw new Error("Update needs an 'Id' column (download the records first)");

    // Read the record fresh, every time, before writing it back. The sheet's
    // own SyncToken column is only ever as current as the moment it was
    // downloaded — anything that touches the record in between (another
    // batch job, a scheduled sync, simply time passing before the edited
    // sheet gets re-uploaded) makes it stale. QuickBooks rejects a stale
    // SyncToken with "[name] is working on this at the same time" REGARDLESS
    // of whether anyone is actually concurrently editing it — that's just
    // QBO's generic wording for "the token you sent isn't current." Using
    // the SyncToken from this read instead of the sheet's copy removes that
    // false-rejection window entirely; falling back to the sheet's value
    // only if this read itself fails, so a network hiccup here doesn't turn
    // into a hard failure when we already had a plausible token to try.
    const existing = await qboReadOne(token, entity.qboEntity!, String(id));
    const freshSyncToken = existing?.SyncToken ?? syncToken;

    // SAFETY: refuse to update an estimate linked to invoices via progress
    // invoicing — the public API silently drops that link and can't restore it.
    if (entity.id === "estimate") {
      const links = Array.isArray(existing?.LinkedTxn)
        ? existing.LinkedTxn.filter((l: any) => l?.TxnType === "Invoice")
        : [];
      if (links.length > 0) {
        throw new Error(
          `Skipped — this estimate is linked to ${links.length} invoice(s) via progress invoicing. Updating it through the API removes that link and it can't be restored, so it was left unchanged. Edit it directly in QuickBooks.`,
        );
      }
    }

    payload = shapeModifyPayload(payload, String(id), String(freshSyncToken ?? "0"), existing);
  }

  const res = await qboPost(token, entity.qboEntity!, payload, {
    operation: operation === "modify" ? "update" : undefined,
  });

  if (res.ok) {
    const created = firstRecord(res.data);
    return { ok: true, qboId: created?.Id, docNumber: created?.DocNumber };
  }
  return { ok: false, error: res.error };
}

/**
 * Same job as commitOneDoc, but for a CREATE-only group submitted as one QBO
 * Batch API call (up to 30 records / request) instead of one qboPost per
 * record. Only for plain creates: `modify` needs a fresh per-record
 * qboReadOne first (for the SyncToken) which doesn't fit the batch envelope
 * without also using QBO's mixed-operation batch reads — out of scope here,
 * see CLAUDE.md's Data Studio section for the reasoning.
 *
 * `entity.build` runs sequentially first (pure local computation against the
 * already-preloaded RefResolver cache — no network calls), so the only
 * network round-trip this function makes is the single qboBatch call.
 */
export async function commitDocsBatch(
  token: OrgQboToken,
  entity: any,
  docs: any[],
  resolver: RefResolver,
): Promise<CommitResult[]> {
  const built = await Promise.all(docs.map(async (doc): Promise<{ payload: any; error?: string }> => {
    try {
      const b = await entity.build(doc, resolver);
      return { payload: b.payload };
    } catch (e: any) {
      return { payload: null, error: e?.message || "Build failed" };
    }
  }));

  const items: BatchItem[] = [];
  built.forEach((b, idx) => {
    // qboBatch's JSON envelope key must be QBO's exact PascalCase resource
    // name (e.g. "PurchaseOrder", "CreditMemo") — entity.qboEntity is the
    // lowercase REST *path* segment ("purchaseorder"), right for qboPost's
    // URL but wrong here. entity.qboReadName already carries the correct
    // name (used for query-language FROM clauses, which use the identical
    // name). See qboBatch's own comment for the bug this was mixed up with.
    if (b.payload) items.push({ bId: String(idx), entity: entity.qboReadName!, payload: b.payload });
  });

  const results = items.length ? await qboBatch(token, items) : [];
  const byBId = new Map(results.map((r) => [r.bId, r]));

  const out: CommitResult[] = [];
  for (let idx = 0; idx < built.length; idx++) {
    const b = built[idx];
    if (b.error) { out.push({ ok: false, error: b.error }); continue; }
    const r = byBId.get(String(idx));
    if (!r) { out.push({ ok: false, error: "Not submitted to QBO (internal batching error)" }); continue; }
    if (r.ok) { out.push({ ok: true, qboId: r.data?.Id, docNumber: r.data?.DocNumber }); continue; }

    // QBO's Batch API can return a Fault for an item it actually DID create —
    // confirmed live 2026-09-03 (Aberny Charity, 842-row import): every one of
    // 101 "Duplicate Document Number" faults in that run corresponded to a
    // real invoice QBO had just created in the same request, with a matching
    // total and a CreateTime seconds old. This doesn't happen on the
    // single-record qboPost path — it's specific to submitting many creates
    // together. Rather than trust the Fault blindly (which produced 101 false
    // "failures" pointing at rows that were already safely in QBO — and would
    // have caused real duplicates if the customer "fixed and re-uploaded"
    // them), verify by DocNumber before accepting it as a real failure. Scoped
    // to this one error class deliberately: other failures (missing field,
    // unknown ref, ...) genuinely didn't write anything, and a verify read
    // there would just be a wasted QBO call every time.
    const docNumber = b.payload?.DocNumber;
    if (docNumber != null && /duplicate document number/i.test(r.error || "")) {
      const match = await verifyRecentlyCreated(token, entity.qboReadName, String(docNumber)).catch(() => null);
      if (match) { out.push({ ok: true, qboId: match.Id, docNumber: String(match.DocNumber) }); continue; }
    }
    out.push({ ok: false, error: r.error || "QBO batch item failed" });
  }
  return out;
}

/**
 * Look up a record by DocNumber and return it only if it was created within
 * the last few minutes — i.e. plausibly created by the batch call that just
 * ran, not a pre-existing record the DocNumber genuinely collided with. A
 * pre-existing record fails this check and the original Fault stands.
 */
async function verifyRecentlyCreated(
  token: OrgQboToken,
  qboReadName: string,
  docNumber: string,
  withinMs: number = 5 * 60 * 1000,
): Promise<{ Id: string; DocNumber: string } | null> {
  const rows = await qboQueryAll(token, qboReadName, `DocNumber = '${docNumber.replace(/'/g, "\\'")}'`);
  if (!rows.length) return null;
  const now = Date.now();
  const recent = rows.find((r: any) => {
    const t = r?.MetaData?.CreateTime ? new Date(r.MetaData.CreateTime).getTime() : NaN;
    return !isNaN(t) && (now - t) >= 0 && (now - t) <= withinMs;
  });
  return recent ? { Id: String(recent.Id), DocNumber: String(recent.DocNumber) } : null;
}
