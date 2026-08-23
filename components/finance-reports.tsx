"use client";

/** AR/AP Aging and Sales-Tax Liability reports (native, from the GL). */

import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, Users, Building2, Receipt, ArrowLeft } from "lucide-react";

const money = (n: any) => Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

const BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;
const BUCKET_LABEL: Record<string, string> = { current: "Current", "1-30": "1–30", "31-60": "31–60", "61-90": "61–90", "90+": "90+" };

export function AgingReport({ side }: { side: "receivable" | "payable" }) {
  const [data, setData] = useState<any>(null);
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const isAR = side === "receivable";
  async function load() { setData(await fetch(`/api/accounting/aging?side=${side}&asOf=${asOf}`).then(r => r.json()).catch(() => ({ rows: [], buckets: {}, total: 0 }))); }
  useEffect(() => { load(); }, [asOf]);
  const rows = data?.rows ?? [];

  return (
    <Shell title={isAR ? "Aged Receivables" : "Aged Payables"} sub={isAR ? "Open customer invoices bucketed by how overdue they are." : "Open supplier bills bucketed by how overdue they are."} icon={isAR ? Users : Building2} onRefresh={load} loading={data === null}>
      <div className="flex items-center gap-2 mb-3 text-[12px] text-stone-400">As of <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className="bg-stone-950 border border-stone-700 rounded-lg px-2.5 py-1.5 text-stone-100" /></div>
      <div className="grid grid-cols-5 gap-2 mb-4">
        {BUCKETS.map(b => (
          <div key={b} className={`rounded-xl border p-3 ${b === "90+" ? "border-rose-800/50 bg-rose-500/5" : "border-stone-800 bg-stone-900"}`}>
            <div className="text-[10px] uppercase tracking-wide text-stone-500">{BUCKET_LABEL[b]}{b !== "current" ? " days" : ""}</div>
            <div className={`text-[15px] font-semibold tabular-nums ${b === "90+" ? "text-rose-400" : "text-stone-100"}`}>{money(data?.buckets?.[b])}</div>
          </div>
        ))}
      </div>
      <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden"><div className="overflow-x-auto">
        <table className="w-full text-[13px] min-w-[680px]">
          <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
            <th className="text-left px-4 py-2.5">Doc</th><th className="text-left px-4 py-2.5">{isAR ? "Customer" : "Supplier"}</th><th className="text-left px-4 py-2.5">Due</th><th className="text-left px-4 py-2.5">Age</th><th className="text-right px-4 py-2.5">Total</th><th className="text-right px-4 py-2.5">Open</th>
          </tr></thead>
          <tbody>
            {data === null && <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
            {data !== null && rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-500">Nothing outstanding.</td></tr>}
            {rows.map((r: any) => (
              <tr key={r.id} className="border-b border-stone-800/60">
                <td className="px-4 py-2 font-mono text-[12px]"><Link href={`/accounting/transactions/${r.id}`} className="text-emerald-400 hover:text-emerald-300 hover:underline">{r.docNumber}</Link></td>
                <td className="px-4 py-2 text-stone-200">{r.party}</td>
                <td className="px-4 py-2 text-stone-400">{r.dueDate || "—"}</td>
                <td className="px-4 py-2"><span className={`text-[11px] ${r.bucket === "90+" ? "text-rose-400" : r.bucket === "current" ? "text-stone-500" : "text-amber-400"}`}>{BUCKET_LABEL[r.bucket]}</span></td>
                <td className="px-4 py-2 text-right text-stone-400 tabular-nums">{money(r.total)}</td>
                <td className="px-4 py-2 text-right text-stone-200 tabular-nums">{money(r.open)}</td>
              </tr>
            ))}
            {data !== null && rows.length > 0 && <tr className="border-t border-stone-700 bg-stone-950/40 font-semibold"><td className="px-4 py-2.5 text-stone-200" colSpan={5}>Total {isAR ? "receivable" : "payable"}</td><td className="px-4 py-2.5 text-right text-stone-100 tabular-nums">{money(data.total)}</td></tr>}
          </tbody>
        </table>
      </div></div>
    </Shell>
  );
}

export function TaxLiabilityReport() {
  const [data, setData] = useState<any>(null);
  const y = new Date().getFullYear();
  const [from, setFrom] = useState(`${y}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  async function load() { setData(await fetch(`/api/accounting/tax-liability?from=${from}&to=${to}`).then(r => r.json()).catch(() => null)); }
  useEffect(() => { load(); }, [from, to]);
  const Row = ({ label, value, strong, hint }: { label: string; value: number; strong?: boolean; hint?: string }) => (
    <div className={`flex items-center justify-between px-4 py-2.5 border-b border-stone-800/60 ${strong ? "bg-stone-950/40" : ""}`}>
      <div><span className={strong ? "font-semibold text-stone-100" : "text-stone-300"}>{label}</span>{hint && <span className="text-[11px] text-stone-500 ml-2">{hint}</span>}</div>
      <span className={`tabular-nums ${strong ? "font-semibold text-stone-100" : "text-stone-300"}`}>{money(value)}</span>
    </div>
  );
  return (
    <Shell title="Sales Tax Liability" sub="Output tax collected on sales, less input tax reclaimed on purchases, for the period." icon={Receipt} onRefresh={load} loading={data === null}>
      <div className="flex items-center gap-2 mb-4 text-[12px] text-stone-400">
        From <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="bg-stone-950 border border-stone-700 rounded-lg px-2.5 py-1.5 text-stone-100" />
        to <input type="date" value={to} onChange={e => setTo(e.target.value)} className="bg-stone-950 border border-stone-700 rounded-lg px-2.5 py-1.5 text-stone-100" />
      </div>
      <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden max-w-xl">
        {data === null ? <div className="px-4 py-8 text-center text-stone-500">Loading…</div> : (<>
          <Row label="Opening balance" value={data.openingBalance} hint="owed at period start" />
          <Row label="Output tax (on sales)" value={data.outputTax} />
          <Row label="Input tax (on purchases)" value={-data.inputTax} />
          {data.adjustments !== 0 && <Row label="Adjustments / payments" value={data.adjustments} />}
          <Row label="Net for period" value={data.netLiability} strong />
          <Row label="Closing balance (payable)" value={data.closingBalance} strong hint="owed to tax authority" />
        </>)}
      </div>
    </Shell>
  );
}
