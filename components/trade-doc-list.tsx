"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, RefreshCw, ArrowRightLeft, Check, FileText, ShoppingCart } from "lucide-react";

type Kind = "estimates" | "purchase-orders";
const META: Record<Kind, { title: string; singular: string; newType: string; icon: any; convertTo: string }> = {
  "estimates":       { title: "Estimates",       singular: "estimate",       newType: "Estimate",      icon: FileText,     convertTo: "invoice" },
  "purchase-orders": { title: "Purchase Orders", singular: "purchase order", newType: "PurchaseOrder",  icon: ShoppingCart, convertTo: "bill" },
};

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function TradeDocList({ kind }: { kind: Kind }) {
  const meta = META[kind];
  const [rows, setRows] = useState<any[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  async function load() {
    const r = await fetch(`/api/trade-documents/${kind}`).then(x => x.json()).catch(() => []);
    setRows(Array.isArray(r) ? r : []);
  }
  useEffect(() => { setRows(null); setMsg(""); load(); }, [kind]);

  async function convert(id: string) {
    if (!confirm(`Convert this ${meta.singular} to a ${meta.convertTo}? It will post to the ledger.`)) return;
    setBusyId(id); setMsg("");
    try {
      const res = await fetch(`/api/trade-documents/${kind}/${id}/convert`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Failed to convert"); return; }
      setMsg(`Converted to ${meta.convertTo} ${d.docNumber ?? ""} (TXN-${String(d.txnNo ?? 0).padStart(6, "0")}).`);
      await load();
    } finally { setBusyId(null); }
  }

  const Icon = meta.icon;
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-teal-500/15 flex items-center justify-center"><Icon size={18} className="text-teal-400" /></div>
          <h1 className="text-xl font-semibold text-stone-100">{meta.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={rows === null ? "animate-spin" : ""} /></button>
          <Link href={`/accounting/new/${meta.newType}`} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-2 hover:bg-emerald-700">
            <Plus size={14} /> New {meta.singular}
          </Link>
        </div>
      </div>

      {msg && <div className="mb-4 text-[12px] text-emerald-400 inline-flex items-center gap-1.5 bg-emerald-950/30 border border-emerald-900 rounded-lg px-3 py-2"><Check size={13} /> {msg}</div>}

      <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[640px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                <th className="text-left px-4 py-2.5">Number</th>
                <th className="text-left px-4 py-2.5">{kind === "estimates" ? "Customer" : "Supplier"}</th>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-right px-4 py-2.5">Total</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {rows === null && <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
              {rows !== null && rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-500">No {meta.title.toLowerCase()} yet — create one with the New button.</td></tr>}
              {(rows ?? []).map(r => (
                <tr key={r.id} className="border-b border-stone-800/60">
                  <td className="px-4 py-2 font-mono text-[12px] text-stone-300">{r.docNumber}</td>
                  <td className="px-4 py-2 text-stone-200">{r.partyLabel || "—"}</td>
                  <td className="px-4 py-2 text-stone-400">{r.issueDate}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-stone-200">{money(r.total)} {r.currency || ""}</td>
                  <td className="px-4 py-2">
                    <span className={`text-[10px] font-medium border rounded-full px-2 py-0.5 ${r.status === "Converted" ? "bg-emerald-500/12 text-emerald-400 border-emerald-800/50" : "bg-stone-800 text-stone-400 border-stone-700"}`}>{r.status}</span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {r.status !== "Converted" && (
                      <button onClick={() => convert(r.id)} disabled={busyId === r.id}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-teal-400 hover:text-teal-300 disabled:opacity-50">
                        <ArrowRightLeft size={12} /> Convert to {meta.convertTo}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
