/**
 * Commit ONE document to QuickBooks — the single per-record write shared by the
 * legacy whole-file runner and the new chunked runner, so both apply identical
 * create/update rules (including the estimate progress-invoicing safety).
 */

import { qboPost, qboReadOne } from "./qbo-client";
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

    const hasLines = Array.isArray(payload.Line) && payload.Line.length > 0;
    // Fetched once, only when something below actually needs it — the
    // estimate-link check, or preserving CustomField across a full update
    // (shapeModifyPayload, below).
    const existing = (entity.id === "estimate" || hasLines)
      ? await qboReadOne(token, entity.qboEntity!, String(id))
      : null;

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

    payload = shapeModifyPayload(payload, String(id), String(syncToken ?? "0"), existing);
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
