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

    // SAFETY: refuse to update an estimate linked to invoices via progress
    // invoicing — the public API silently drops that link and can't restore it.
    if (entity.id === "estimate") {
      const existing = await qboReadOne(token, entity.qboEntity!, String(id));
      const links = Array.isArray(existing?.LinkedTxn)
        ? existing.LinkedTxn.filter((l: any) => l?.TxnType === "Invoice")
        : [];
      if (links.length > 0) {
        throw new Error(
          `Skipped — this estimate is linked to ${links.length} invoice(s) via progress invoicing. Updating it through the API removes that link and it can't be restored, so it was left unchanged. Edit it directly in QuickBooks.`,
        );
      }
    }

    payload = { ...payload, Id: String(id), SyncToken: String(syncToken ?? "0"), sparse: true };
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
