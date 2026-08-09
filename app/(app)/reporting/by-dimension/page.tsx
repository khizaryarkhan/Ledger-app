"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { BarChart3, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";

interface Col { id: string; name: string; }
interface Row { code: string; name: string; lineKind: string; cells: Record<string, number>; total: number; }
interface Report {
  statement: { name: string };
  dimension: { id: string; name: string } | null;
  columns: Col[];
  rows: Row[];
  reconciliation: { extractedTotal: number; mappedTotal: number; unmappedToLineTotal: number; difference: number; profitCentreUnallocatedTotal: number; conflicts: number; note: string };
  diagnostics: { counts: Record<string, number> };
}

const input = "h-9 px-2.5 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-100 focus:border-blue-500 focus:outline-none";
const money = (n: number) => (!n ? "" : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const ymd = (d: Date) => d.toISOString().slice(0, 10);

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
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/reporting/report?from=${from}&to=${to}${dimensionId ? `&dimensionId=${dimensionId}` : ""}`);
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
        <h1 className="text-xl font-semibold text-stone-100">Management P&amp;L</h1>
      </div>
      <p className="text-sm text-stone-400 mb-4 ml-12">Your management P&amp;L lines (rows) split by profit centre (columns), built from your mapping + classification rules. Unmatched activity is shown explicitly, never dropped.</p>

      <div className="flex flex-wrap items-end gap-2 mb-4">
        <label className="text-[12px] text-stone-400">Split by
          <select value={dimensionId} onChange={(e) => setDimensionId(e.target.value)} className={`${input} block mt-0.5`}>
            {dims.length === 0 && <option value="">(no profit-centre dimension)</option>}
            {dims.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className="text-[12px] text-stone-400">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${input} block mt-0.5`} /></label>
        <label className="text-[12px] text-stone-400">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${input} block mt-0.5`} /></label>
        <button onClick={run} disabled={loading} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-40">
          {loading ? <Loader2 size={15} className="animate-spin" /> : <BarChart3 size={15} />} Run report
        </button>
      </div>

      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error}</div>}

      {rec && (
        <div className="mb-3 flex flex-wrap gap-4 text-[13px]">
          {Math.abs(rec.difference) < 0.01
            ? <span className="inline-flex items-center gap-1.5 text-emerald-400"><CheckCircle2 size={15} /> Reconciles ({money(rec.extractedTotal)} of activity accounted for)</span>
            : <span className="inline-flex items-center gap-1.5 text-rose-400"><AlertTriangle size={15} /> Off by {money(rec.difference)}</span>}
          {rec.unmappedToLineTotal !== 0 && <span className="text-amber-400">Not mapped to a P&amp;L line: {money(rec.unmappedToLineTotal)}</span>}
          {rec.profitCentreUnallocatedTotal !== 0 && <span className="text-amber-400">Unallocated profit centre: {money(rec.profitCentreUnallocatedTotal)}</span>}
          {rec.conflicts > 0 && <span className="inline-flex items-center gap-1.5 text-amber-400"><AlertTriangle size={15} /> {rec.conflicts} rule conflict(s)</span>}
        </div>
      )}

      {report && (
        <div className="border border-stone-800 rounded-lg overflow-x-auto">
          <table className="text-[13px] min-w-full">
            <thead className="bg-stone-950 sticky top-0">
              <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                <th className="text-left px-3 py-2 font-semibold sticky left-0 bg-stone-950">{report.statement.name}</th>
                {cols.map((c) => <th key={c.id} className={`text-right px-3 py-2 font-semibold ${c.id === "__unallocated__" ? "text-amber-400" : ""}`}>{c.name}</th>)}
                {cols.length > 1 && <th className="text-right px-3 py-2 font-semibold">Total</th>}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => {
                const computed = r.lineKind === "computed";
                return (
                  <tr key={r.code} className={computed ? "border-t border-stone-700 bg-stone-900/40 font-semibold" : "border-t border-stone-800/40 hover:bg-stone-800/20"}>
                    <td className={`px-3 py-1.5 whitespace-nowrap sticky left-0 ${computed ? "text-stone-100 bg-stone-900/40" : "text-stone-300 bg-inherit"}`}>{r.name}</td>
                    {cols.map((c) => <td key={c.id} className={`px-3 py-1.5 text-right tabular-nums ${computed ? "text-stone-100" : c.id === "__unallocated__" ? "text-amber-400/80" : "text-stone-300"}`}>{money(r.cells[c.id] || 0)}</td>)}
                    {cols.length > 1 && <td className={`px-3 py-1.5 text-right tabular-nums ${computed ? "text-stone-100" : "text-stone-200"}`}>{money(r.total)}</td>}
                  </tr>
                );
              })}
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
