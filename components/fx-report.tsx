"use client";

/** Currency Exposure & FX revaluation — enter today's rate per currency to see unrealised gain/loss. */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw, Coins, ArrowLeft } from "lucide-react";
import { fmt } from "@/lib/format";

const money = fmt.num2;

export function FxExposureReport() {
  const [data, setData] = useState<any>(null);
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [rates, setRates] = useState<Record<string, string>>({});
  async function load() { setData(await fetch(`/api/accounting/fx-exposure?asOf=${asOf}`).then(r => r.json()).catch(() => null)); }
  useEffect(() => { load(); }, [asOf]);
  const rows = data?.rows ?? [];
  const home = data?.home ?? "";

  // Seed the rate inputs with each currency's implied average rate.
  useEffect(() => {
    if (!data) return;
    setRates(prev => {
      const next = { ...prev };
      for (const r of rows) if (next[r.currency] === undefined && r.avgRate) next[r.currency] = String(r.avgRate);
      return next;
    });
  }, [data]);

  const withGL = useMemo(() => rows.map((r: any) => {
    const rate = Number(rates[r.currency]);
    const revalued = rate > 0 ? Math.round(r.foreignBalance * rate * 100) / 100 : r.homeCarrying;
    return { ...r, revalued, gl: Math.round((revalued - r.homeCarrying) * 100) / 100 };
  }), [rows, rates]);
  const totalGL = useMemo(() => withGL.reduce((s: number, r: any) => s + r.gl, 0), [withGL]);

  return (
    <div className="p-6 max-w-5xl">
      <Link href="/accounting/reports" className="inline-flex items-center gap-1 text-[12px] text-stone-500 hover:text-stone-300 mb-3"><ArrowLeft size={13} /> All reports</Link>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/15 flex items-center justify-center"><Coins size={18} className="text-indigo-400" /></div>
          <h1 className="text-xl font-semibold text-stone-100">Currency Exposure &amp; FX Revaluation</h1>
        </div>
        <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={data === null ? "animate-spin" : ""} /></button>
      </div>
      <p className="text-sm text-stone-400 mb-5 ml-12">Foreign-currency balances and the home value they were booked at. Enter today's rate per currency to see the unrealised gain/loss if revalued now. Home currency: {home}.</p>

      <div className="flex items-center gap-2 mb-3 text-[12px] text-stone-400">As of <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className="bg-stone-950 border border-stone-700 rounded-lg px-2.5 py-1.5 text-stone-100" /></div>

      <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden"><div className="overflow-x-auto">
        <table className="w-full text-[13px] min-w-[720px]">
          <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
            <th className="text-left px-4 py-2.5">Account</th><th className="text-left px-4 py-2.5">Ccy</th>
            <th className="text-right px-4 py-2.5">Foreign balance</th><th className="text-right px-4 py-2.5">Booked ({home})</th>
            <th className="text-right px-4 py-2.5">Rate now</th><th className="text-right px-4 py-2.5">Revalued</th><th className="text-right px-4 py-2.5">Unrealised G/(L)</th>
          </tr></thead>
          <tbody>
            {data === null && <tr><td colSpan={7} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
            {data !== null && withGL.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-stone-500">No foreign-currency balances.</td></tr>}
            {withGL.map((r: any) => (
              <tr key={r.accountId + r.currency} className="border-b border-stone-800/60">
                <td className="px-4 py-2 text-stone-200">{r.accountName}</td>
                <td className="px-4 py-2 text-stone-400 font-mono">{r.currency}</td>
                <td className="px-4 py-2 text-right text-stone-300 tabular-nums">{money(r.foreignBalance)}</td>
                <td className="px-4 py-2 text-right text-stone-300 tabular-nums">{money(r.homeCarrying)}</td>
                <td className="px-4 py-2 text-right"><input type="number" value={rates[r.currency] ?? ""} onChange={e => setRates(p => ({ ...p, [r.currency]: e.target.value }))} className="bg-stone-950 border border-stone-700 rounded px-2 py-1 text-[12px] text-stone-100 w-24 text-right font-mono" /></td>
                <td className="px-4 py-2 text-right text-stone-300 tabular-nums">{money(r.revalued)}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${r.gl > 0 ? "text-emerald-400" : r.gl < 0 ? "text-rose-400" : "text-stone-500"}`}>{money(r.gl)}</td>
              </tr>
            ))}
            {data !== null && withGL.length > 0 && (
              <tr className="border-t border-stone-700 bg-stone-950/40 font-semibold">
                <td className="px-4 py-2.5 text-stone-200" colSpan={6}>Total unrealised FX gain / (loss)</td>
                <td className={`px-4 py-2.5 text-right tabular-nums ${totalGL > 0 ? "text-emerald-400" : totalGL < 0 ? "text-rose-400" : "text-stone-100"}`}>{money(totalGL)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div></div>
      <p className="text-[11px] text-stone-500 mt-3">This is a position report. Posting the revaluation to the ledger (and recognising realised FX at settlement) is a scheduled enhancement.</p>
    </div>
  );
}
