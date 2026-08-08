"use client";

import { useEffect, useMemo, useState, useCallback, Fragment } from "react";
import { BarChart3, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";

interface Col { id: string; name: string; }
interface Acct { accountId: string; accountName: string; accountNumber?: string; cells: Record<string, number>; total: number; }
interface Section { section: string; accounts: Acct[]; subtotal: Record<string, number>; subtotalTotal: number; }
interface Report {
  dimension: { id: string; name: string };
  columns: Col[];
  sections: Section[];
  columnTotals: Record<string, number>;
  grandTotal: number;
  reconciliation: { extractedTotal: number; classifiedTotal: number; difference: number; unallocatedTotal: number; conflicts: number; note: string };
  diagnostics: { counts: Record<string, number>; nonPnlLinesSkipped: number };
}

const input = "h-9 px-2.5 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-100 focus:border-blue-500 focus:outline-none";
const money = (n: number) => (!n ? "" : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function ymd(d: Date) { return d.toISOString().slice(0, 10); }

export default function PlByDimensionPage() {
  const [dims, setDims] = useState<{ id: string; name: string }[]>([]);
  const [dimensionId, setDimensionId] = useState("");
  const now = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(ymd(new Date(now.getFullYear(), 0, 1)));
  const [to, setTo] = useState(ymd(now));
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/reporting/dimensions").then((r) => r.json()).then((d) => {
      setDims((d.dimensions || []).map((x: any) => ({ id: x.id, name: x.name })));
      if (d.dimensions?.[0]) setDimensionId(d.dimensions[0].id);
    }).catch(() => {});
  }, []);

  const run = useCallback(async () => {
    if (!dimensionId) return;
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/reporting/report?from=${from}&to=${to}&dimensionId=${dimensionId}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setReport(d);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [dimensionId, from, to]);

  const cols = report?.columns ?? [];
  const rec = report?.reconciliation;

  return (
    <div className="p-6 max-w-full">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-blue-500/15 flex items-center justify-center"><BarChart3 size={18} className="text-blue-400" /></div>
        <h1 className="text-xl font-semibold text-stone-100">P&amp;L by Dimension</h1>
      </div>
      <p className="text-sm text-stone-400 mb-4 ml-12">QBO activity for the period, classified into your dimension values by the rules. Unmatched activity is shown under Unallocated — never dropped.</p>

      <div className="flex flex-wrap items-end gap-2 mb-4">
        <label className="text-[12px] text-stone-400">Dimension
          <select value={dimensionId} onChange={(e) => setDimensionId(e.target.value)} className={`${input} block mt-0.5`}>
            {dims.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className="text-[12px] text-stone-400">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${input} block mt-0.5`} /></label>
        <label className="text-[12px] text-stone-400">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${input} block mt-0.5`} /></label>
        <button onClick={run} disabled={loading || !dimensionId} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-40">
          {loading ? <Loader2 size={15} className="animate-spin" /> : <BarChart3 size={15} />} Run report
        </button>
      </div>

      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error}</div>}

      {rec && (
        <div className="mb-3 flex flex-wrap gap-4 text-[13px]">
          {Math.abs(rec.difference) < 0.01
            ? <span className="inline-flex items-center gap-1.5 text-emerald-400"><CheckCircle2 size={15} /> Reconciles — every line accounted for ({money(rec.classifiedTotal)})</span>
            : <span className="inline-flex items-center gap-1.5 text-rose-400"><AlertTriangle size={15} /> Difference {money(rec.difference)} — lines dropped!</span>}
          {rec.unallocatedTotal !== 0 && <span className="text-amber-400">Unallocated: {money(rec.unallocatedTotal)}</span>}
          {rec.conflicts > 0 && <span className="inline-flex items-center gap-1.5 text-amber-400"><AlertTriangle size={15} /> {rec.conflicts} rule conflict(s)</span>}
        </div>
      )}

      {report && (
        <div className="border border-stone-800 rounded-lg overflow-x-auto">
          <table className="text-[13px] min-w-full">
            <thead className="bg-stone-950 sticky top-0">
              <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                <th className="text-left px-3 py-2 font-semibold sticky left-0 bg-stone-950">Account</th>
                {cols.map((c) => <th key={c.id} className={`text-right px-3 py-2 font-semibold ${c.id === "__unallocated__" ? "text-amber-400" : ""}`}>{c.name}</th>)}
                <th className="text-right px-3 py-2 font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {report.sections.map((s) => (
                <Fragment key={s.section}>
                  <tr className="bg-stone-900/70"><td colSpan={cols.length + 2} className="px-3 py-1.5 text-stone-200 font-semibold border-t border-stone-800">{s.section}</td></tr>
                  {s.accounts.map((a) => (
                    <tr key={s.section + a.accountId} className="border-t border-stone-800/40 hover:bg-stone-800/20">
                      <td className="px-3 py-1.5 text-stone-300 whitespace-nowrap sticky left-0 bg-inherit">{a.accountNumber ? `${a.accountNumber} · ` : ""}{a.accountName}</td>
                      {cols.map((c) => <td key={c.id} className={`px-3 py-1.5 text-right tabular-nums ${c.id === "__unallocated__" ? "text-amber-400/80" : "text-stone-300"}`}>{money(a.cells[c.id] || 0)}</td>)}
                      <td className="px-3 py-1.5 text-right tabular-nums text-stone-200 font-medium">{money(a.total)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-stone-800 bg-stone-900/30 font-medium">
                    <td className="px-3 py-1.5 text-stone-400 sticky left-0 bg-stone-900/30">Total {s.section}</td>
                    {cols.map((c) => <td key={c.id} className="px-3 py-1.5 text-right tabular-nums text-stone-300">{money(s.subtotal[c.id] || 0)}</td>)}
                    <td className="px-3 py-1.5 text-right tabular-nums text-stone-200">{money(s.subtotalTotal)}</td>
                  </tr>
                </Fragment>
              ))}
              <tr className="border-t-2 border-stone-700 bg-stone-900/60 font-semibold">
                <td className="px-3 py-2 text-stone-100 sticky left-0 bg-stone-900/60">Net (Income − Costs)</td>
                {cols.map((c) => <td key={c.id} className="px-3 py-2 text-right tabular-nums text-stone-100">{money(report.columnTotals[c.id] || 0)}</td>)}
                <td className="px-3 py-2 text-right tabular-nums text-stone-100">{money(report.grandTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {report && (
        <p className="text-[11px] text-stone-600 mt-3">
          Pulled: {Object.entries(report.diagnostics.counts).map(([k, v]) => `${v} ${k}`).join(" · ")}. {rec?.note}
        </p>
      )}
    </div>
  );
}
