"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { X, Loader, Undo2, Receipt, ArrowRight, AlertTriangle, Check, Pencil } from "lucide-react";
import { txnTypeLabel, formatTxnId } from "@/lib/accounting/doc-format";

const EDITABLE = new Set(["Invoice", "SalesReceipt", "CreditNote", "RefundReceipt", "Bill", "Expense", "VendorCredit"]);

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function TransactionDetailPage() {
  const id = String(useParams().id || "");
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function load() {
    const r = await fetch(`/api/ledger/journal/${id}`).then(x => x.json()).catch(() => null);
    if (r?.entry) setData(r); else setErr(r?.error || "Not found");
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function reverse() {
    if (!confirm("Reverse this transaction? A mirrored entry is posted; the original stays on record for the audit trail.")) return;
    setBusy(true); setMsg("");
    try {
      const res = await fetch(`/api/ledger/journal/${id}/reverse`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(d.error || "Failed to reverse"); return; }
      await load();
      setMsg("Reversed. The original is marked Reversed and a mirror entry has been posted.");
    } finally { setBusy(false); }
  }

  const close = () => router.back();
  const e = data?.entry;
  const reversed = e?.status === "Reversed";
  const isReversal = e?.sourceType === "Reversal";
  const canEdit = e && EDITABLE.has(e.sourceType) && !reversed && (data?.links?.length ?? 0) === 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={close} />
      <div className="relative h-full w-full sm:w-[92vw] max-w-[1000px] bg-stone-950 border-l border-stone-800 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-6 py-3 border-b border-stone-800 bg-stone-900 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-teal-500/15 flex items-center justify-center shrink-0"><Receipt size={17} className="text-teal-400" /></div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-stone-100 leading-tight truncate">
                {e ? `${txnTypeLabel(e.sourceType)} ${e.docNumber ?? `JE-${e.entryNumber}`}` : "Transaction"}
              </h1>
              {e && <p className="text-[11px] text-stone-500 truncate">{formatTxnId(e.txnNo)} · {e.entryDate}{e.dueDate ? ` · due ${e.dueDate}` : ""}</p>}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {e && <span className={`text-[11px] font-medium border rounded-full px-2 py-0.5 ${reversed ? "bg-amber-500/10 text-amber-400 border-amber-800" : "bg-emerald-500/12 text-emerald-400 border-emerald-800/50"}`}>{e.status}</span>}
            <button onClick={close} className="text-stone-500 hover:text-stone-200 p-1"><X size={20} /></button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {err && <div className="text-[13px] text-rose-400 inline-flex items-center gap-2"><AlertTriangle size={14} /> {err}</div>}
          {msg && <div className="text-[12px] text-emerald-400 inline-flex items-center gap-1.5 bg-emerald-950/30 border border-emerald-900 rounded-lg px-3 py-2"><Check size={13} /> {msg}</div>}
          {!data && !err ? <div className="text-stone-500 text-sm inline-flex items-center gap-2"><Loader size={14} className="animate-spin" /> Loading…</div> : e && (
            <>
              {(e.reference || e.memo) && (
                <div className="flex flex-wrap gap-x-10 gap-y-1 text-[13px]">
                  {e.reference && <div><span className="text-stone-500">Reference: </span><span className="text-stone-200">{e.reference}</span></div>}
                  {e.memo && <div><span className="text-stone-500">Memo: </span><span className="text-stone-200">{e.memo}</span></div>}
                </div>
              )}

              {/* Double-entry lines */}
              <div className="rounded-xl border border-stone-800 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px] min-w-[640px]">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                        <th className="text-left px-4 py-2">Account</th>
                        <th className="text-left px-4 py-2">Name</th>
                        <th className="text-left px-4 py-2">Description</th>
                        <th className="text-right px-4 py-2">Debit</th>
                        <th className="text-right px-4 py-2">Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.lines.map((l: any, i: number) => (
                        <tr key={i} className="border-b border-stone-800/50">
                          <td className="px-4 py-2 text-stone-200">{l.account}</td>
                          <td className="px-4 py-2 text-stone-400">{l.name || "—"}</td>
                          <td className="px-4 py-2 text-stone-400">{l.description || "—"}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-stone-300">{l.debit ? money(l.debit) : ""}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-stone-300">{l.credit ? money(l.credit) : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-stone-800 font-semibold text-white">
                        <td className="px-4 py-2" colSpan={3}>Total</td>
                        <td className="px-4 py-2 text-right tabular-nums">{money(data.total)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{money(data.total)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Related transactions */}
              {data.links.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-2">Related transactions</div>
                  <div className="space-y-1">
                    {data.links.map((lk: any, i: number) => (
                      <Link key={i} href={`/accounting/transactions/${lk.id}`} className="flex items-center gap-3 text-[12px] rounded-lg px-3 py-2 bg-stone-900 border border-stone-800 hover:border-stone-600">
                        <span className="text-stone-500 w-20">{lk.relation === "progress_invoice" ? "invoiced" : lk.relation === "po_bill" ? "billed" : lk.relation}</span>
                        <ArrowRight size={12} className="text-stone-600" />
                        <span className="font-mono text-stone-300">{lk.docNumber}</span>
                        <span className="text-stone-500">{txnTypeLabel(lk.type)}</span>
                        <span className="tabular-nums text-stone-300 ml-auto">{money(lk.linkedAmount)}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {e && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-stone-800 bg-stone-900 shrink-0">
            <p className="text-[11px] text-stone-500 max-w-sm">Edit to correct it in place, or Reverse for an audit-trail correction. A document with payments/credits applied can't be edited — reverse it instead.</p>
            <div className="flex items-center gap-3">
              {canEdit && (
                <Link href={`/accounting/new/${e.sourceType}?edit=${e.id}`}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium">
                  <Pencil size={14} /> Edit
                </Link>
              )}
              <button onClick={reverse} disabled={busy || reversed || isReversal}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600/90 hover:bg-amber-600 text-white text-sm font-medium disabled:opacity-40">
                {busy ? <Loader size={14} className="animate-spin" /> : <Undo2 size={14} />} {reversed ? "Already reversed" : "Reverse"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
