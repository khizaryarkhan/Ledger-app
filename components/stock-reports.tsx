"use client";

/** Stock reports — valuation (summary + by-lot detail) and stock status. */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { RefreshCw, Search, Boxes, ClipboardList, ArrowLeft } from "lucide-react";

const money = (n: any) => Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: any) => Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 });

function Shell({ title, sub, icon: Icon, children, onRefresh, loading }: { title: string; sub: string; icon: any; children: React.ReactNode; onRefresh: () => void; loading: boolean }) {
  return (
    <div className="p-6 max-w-5xl">
      <Link href="/accounting/reports" className="inline-flex items-center gap-1 text-[12px] text-stone-500 hover:text-stone-300 mb-3"><ArrowLeft size={13} /> All reports</Link>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/15 flex items-center justify-center"><Icon size={18} className="text-indigo-400" /></div>
          <h1 className="text-xl font-semibold text-stone-100">{title}</h1>
        </div>
        <button onClick={onRefresh} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></button>
      </div>
      <p className="text-sm text-stone-400 mb-5 ml-12">{sub}</p>
      {children}
    </div>
  );
}

export function StockValuationReport() {
  const params = useSearchParams();
  const initialLots = params.get("view") === "lots";
  const [view, setView] = useState<"summary" | "lots">(initialLots ? "lots" : "summary");
  const [summary, setSummary] = useState<{ rows: any[]; total: number } | null>(null);
  const [lots, setLots] = useState<any[] | null>(null);
  const [q, setQ] = useState("");

  async function load() {
    setSummary(null); setLots(null);
    if (view === "summary") setSummary(await fetch(`/api/inventory/reports?type=valuation`).then(r => r.json()).catch(() => ({ rows: [], total: 0 })));
    else setLots(await fetch(`/api/inventory/reports?type=lots`).then(r => r.json()).catch(() => []));
  }
  useEffect(() => { load(); }, [view]);

  const filteredRows = useMemo(() => {
    const s = q.trim().toLowerCase(); const rows = summary?.rows ?? [];
    return s ? rows.filter(r => (r.name || "").toLowerCase().includes(s) || (r.code || "").toLowerCase().includes(s)) : rows;
  }, [summary, q]);
  const filteredLots = useMemo(() => {
    const s = q.trim().toLowerCase(); const rows = lots ?? [];
    return s ? rows.filter(r => (r.itemName || "").toLowerCase().includes(s) || (r.lotNo || "").toLowerCase().includes(s)) : rows;
  }, [lots, q]);
  const lotsTotal = useMemo(() => (filteredLots).reduce((s, l) => s + Number(l.value || 0), 0), [filteredLots]);
  const loading = view === "summary" ? summary === null : lots === null;

  return (
    <Shell title="Stock Valuation" sub="Value of inventory on hand, at FIFO cost." icon={Boxes} onRefresh={load} loading={loading}>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-1 bg-stone-900 border border-stone-800 rounded-lg p-1">
          {(["summary", "lots"] as const).map(v => (
            <button key={v} onClick={() => setView(v)} className={`text-[12px] font-medium rounded-md px-2.5 py-1 ${view === v ? "bg-stone-700 text-stone-100" : "text-stone-400 hover:text-stone-200"}`}>{v === "summary" ? "Summary" : "Detail (by lot)"}</button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-600" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" className="bg-stone-950 border border-stone-700 rounded-lg pl-9 pr-3 py-2 text-sm text-stone-100 w-full focus:outline-none focus:border-emerald-600" />
        </div>
      </div>

      <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden">
        <div className="overflow-x-auto">
          {view === "summary" ? (
            <table className="w-full text-[13px] min-w-[640px]">
              <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                <th className="text-left px-4 py-2.5">Item</th><th className="text-left px-4 py-2.5">Code</th><th className="text-left px-4 py-2.5">Category</th>
                <th className="text-right px-4 py-2.5">On hand</th><th className="text-right px-4 py-2.5">Avg cost</th><th className="text-right px-4 py-2.5">Value</th>
              </tr></thead>
              <tbody>
                {loading && <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
                {!loading && filteredRows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-500">No inventory items with stock.</td></tr>}
                {filteredRows.map(r => (
                  <tr key={r.id} className="border-b border-stone-800/60">
                    <td className="px-4 py-2 text-stone-100 font-medium">{r.name}</td>
                    <td className="px-4 py-2 text-stone-400 font-mono text-[12px]">{r.code || "—"}</td>
                    <td className="px-4 py-2 text-stone-400">{r.category || "—"}</td>
                    <td className="px-4 py-2 text-right text-stone-300 tabular-nums">{qty(r.onHandQty)} {r.baseUom || ""}</td>
                    <td className="px-4 py-2 text-right text-stone-300 tabular-nums font-mono">{money(r.avgCost)}</td>
                    <td className="px-4 py-2 text-right text-stone-200 tabular-nums">{money(r.value)}</td>
                  </tr>
                ))}
                {!loading && filteredRows.length > 0 && (
                  <tr className="border-t border-stone-700 bg-stone-950/40 font-semibold">
                    <td className="px-4 py-2.5 text-stone-200" colSpan={5}>Total inventory value</td>
                    <td className="px-4 py-2.5 text-right text-stone-100 tabular-nums">{money(summary?.total)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-[13px] min-w-[720px]">
              <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                <th className="text-left px-4 py-2.5">Item</th><th className="text-left px-4 py-2.5">Lot #</th><th className="text-left px-4 py-2.5">Received</th><th className="text-left px-4 py-2.5">Expiry</th>
                <th className="text-right px-4 py-2.5">Remaining</th><th className="text-right px-4 py-2.5">Unit cost</th><th className="text-right px-4 py-2.5">Value</th>
              </tr></thead>
              <tbody>
                {loading && <tr><td colSpan={7} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
                {!loading && filteredLots.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-stone-500">No open cost lots.</td></tr>}
                {filteredLots.map(l => (
                  <tr key={l.id} className="border-b border-stone-800/60">
                    <td className="px-4 py-2 text-stone-100">{l.itemName}</td>
                    <td className="px-4 py-2 text-stone-300 font-mono">{l.lotNo || l.id.slice(0, 8)}</td>
                    <td className="px-4 py-2 text-stone-400">{l.receivedDate || "—"}</td>
                    <td className="px-4 py-2 text-stone-400">{l.expiryDate || "—"}</td>
                    <td className="px-4 py-2 text-right text-stone-300 tabular-nums">{qty(l.remainingQty)} {l.baseUom || ""}</td>
                    <td className="px-4 py-2 text-right text-stone-300 tabular-nums font-mono">{money(l.unitCost)}</td>
                    <td className="px-4 py-2 text-right text-stone-200 tabular-nums">{money(l.value)}</td>
                  </tr>
                ))}
                {!loading && filteredLots.length > 0 && (
                  <tr className="border-t border-stone-700 bg-stone-950/40 font-semibold">
                    <td className="px-4 py-2.5 text-stone-200" colSpan={6}>Total</td>
                    <td className="px-4 py-2.5 text-right text-stone-100 tabular-nums">{money(lotsTotal)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Shell>
  );
}

export function StockStatusReport() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [q, setQ] = useState("");
  const [only, setOnly] = useState(false);
  async function load() { setRows(await fetch(`/api/inventory/reports?type=status`).then(r => r.json()).catch(() => [])); }
  useEffect(() => { load(); }, []);
  const filtered = useMemo(() => {
    let list = rows ?? [];
    if (only) list = list.filter(r => r.belowMin || r.out);
    const s = q.trim().toLowerCase();
    if (s) list = list.filter(r => (r.name || "").toLowerCase().includes(s) || (r.code || "").toLowerCase().includes(s));
    return list;
  }, [rows, q, only]);

  return (
    <Shell title="Stock Status" sub="On-hand quantity against each item's minimum reorder level." icon={ClipboardList} onRefresh={load} loading={rows === null}>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-600" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" className="bg-stone-950 border border-stone-700 rounded-lg pl-9 pr-3 py-2 text-sm text-stone-100 w-full focus:outline-none focus:border-emerald-600" />
        </div>
        <label className="flex items-center gap-2 text-[12px] text-stone-400"><input type="checkbox" checked={only} onChange={e => setOnly(e.target.checked)} className="accent-emerald-600" /> Only items needing attention</label>
      </div>
      <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[620px]">
            <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
              <th className="text-left px-4 py-2.5">Item</th><th className="text-left px-4 py-2.5">Code</th>
              <th className="text-right px-4 py-2.5">On hand</th><th className="text-right px-4 py-2.5">Expected (PO)</th><th className="text-right px-4 py-2.5">Committed (SO)</th><th className="text-right px-4 py-2.5">Available</th><th className="text-right px-4 py-2.5">Min.</th><th className="text-left px-4 py-2.5">Status</th>
            </tr></thead>
            <tbody>
              {rows === null && <tr><td colSpan={8} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
              {rows !== null && filtered.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-stone-500">Nothing to show.</td></tr>}
              {filtered.map(r => (
                <tr key={r.id} className="border-b border-stone-800/60">
                  <td className="px-4 py-2 text-stone-100 font-medium">{r.name}</td>
                  <td className="px-4 py-2 text-stone-400 font-mono text-[12px]">{r.code || "—"}</td>
                  <td className="px-4 py-2 text-right text-stone-300 tabular-nums">{qty(r.onHandQty)} {r.baseUom || ""}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{Number(r.expectedQty) > 0 ? <span className="text-cyan-400">+{qty(r.expectedQty)}</span> : <span className="text-stone-600">—</span>}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{Number(r.committedQty) > 0 ? <span className="text-amber-400">−{qty(r.committedQty)}</span> : <span className="text-stone-600">—</span>}</td>
                  <td className="px-4 py-2 text-right text-stone-200 tabular-nums">{qty(r.availableQty)}</td>
                  <td className="px-4 py-2 text-right text-stone-400 tabular-nums">{qty(r.minOhQty)}</td>
                  <td className="px-4 py-2">
                    {r.out ? <span className="text-[11px] font-medium text-rose-400">Out of stock</span>
                      : r.belowMin ? <span className="text-[11px] font-medium text-amber-400">Below minimum</span>
                      : <span className="text-[11px] text-emerald-400">OK</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
