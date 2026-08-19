"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Network, Loader2, Building2, ArrowRight } from "lucide-react";

type Row = { id: string; invoiceNumber: string; orgName: string; customerName: string; currency: string; outstanding: number; dueDate: string | null; days: number; stage: string; status: string };
type OrgRoll = { orgId: string; orgName: string; outstanding: number; count: number };
type Data = {
  groupId: string | null;
  orgs: OrgRoll[];
  summary: { count: number; totalsByCurrency: Record<string, number>; aging: { current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number } };
  rows: Row[];
  truncated?: boolean;
};

const money = (n: number, ccy: string) => {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(n); }
  catch { return `${ccy} ${Math.round(n).toLocaleString()}`; }
};
const totals = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1]);

export default function GroupConsolidatedPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/group/receivables")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        return d;
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="p-6 max-w-2xl">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/15 flex items-center justify-center"><Network size={18} className="text-emerald-400" /></div>
          <h1 className="text-xl font-semibold text-stone-100">Consolidated receivables</h1>
        </div>
        <div className="mt-4 px-4 py-3 rounded-lg bg-stone-800/60 border border-stone-700 text-stone-300 text-sm">
          {error.toLowerCase().includes("group")
            ? <>Select a <b>Group</b> from the organisation switcher (top-right) to see the consolidated view.</>
            : error}
        </div>
      </div>
    );
  }

  if (!data) return <div className="p-6 text-sm text-stone-500 flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Loading consolidated receivables…</div>;

  const a = data.summary.aging;
  const agingRows = [
    { label: "Current", val: a.current, cls: "text-emerald-400" },
    { label: "1–30d", val: a.d1_30, cls: "text-stone-300" },
    { label: "31–60d", val: a.d31_60, cls: "text-amber-400" },
    { label: "61–90d", val: a.d61_90, cls: "text-orange-400" },
    { label: "90d+", val: a.d90plus, cls: "text-rose-400" },
  ];
  const primaryCcy = totals(data.summary.totalsByCurrency)[0]?.[0] ?? "EUR";
  const agingMax = Math.max(1, ...agingRows.map((r) => r.val));

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-emerald-500/15 flex items-center justify-center"><Network size={18} className="text-emerald-400" /></div>
        <h1 className="text-xl font-semibold text-stone-100">Consolidated receivables</h1>
      </div>
      <p className="text-sm text-stone-400 mb-6 ml-12">Open invoices across every branch in this group. Switch to a single branch in the org switcher to work it in detail.</p>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="rounded-xl bg-stone-900 border border-stone-800 p-4">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-1">Outstanding</div>
          <div className="text-xl font-bold text-stone-100 tabular-nums">
            {totals(data.summary.totalsByCurrency).map(([c, v]) => <div key={c}>{money(v, c)}</div>)}
            {data.summary.count === 0 && <span className="text-stone-500">—</span>}
          </div>
        </div>
        <div className="rounded-xl bg-stone-900 border border-stone-800 p-4">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-1">Open invoices</div>
          <div className="text-xl font-bold text-stone-100 tabular-nums">{data.summary.count}</div>
        </div>
        <div className="rounded-xl bg-stone-900 border border-stone-800 p-4">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-1">Branches</div>
          <div className="text-xl font-bold text-stone-100 tabular-nums">{data.orgs.length}</div>
        </div>
        <div className="rounded-xl bg-stone-900 border border-stone-800 p-4">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-1">90d+ overdue</div>
          <div className="text-xl font-bold text-rose-400 tabular-nums">{money(a.d90plus, primaryCcy)}</div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-6">
        {/* Aging */}
        <div className="rounded-xl bg-stone-900 border border-stone-800 p-5">
          <div className="text-[12px] font-semibold text-stone-300 uppercase tracking-wide mb-3">Aging ({primaryCcy})</div>
          <div className="space-y-2.5">
            {agingRows.map((r) => (
              <div key={r.label} className="flex items-center gap-3">
                <div className="w-16 text-[12px] text-stone-400 shrink-0">{r.label}</div>
                <div className="flex-1 h-2 rounded-full bg-stone-800 overflow-hidden">
                  <div className="h-full bg-emerald-500/60" style={{ width: `${(r.val / agingMax) * 100}%` }} />
                </div>
                <div className={`w-24 text-right text-[12px] tabular-nums ${r.cls}`}>{money(r.val, primaryCcy)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Per-branch */}
        <div className="rounded-xl bg-stone-900 border border-stone-800 p-5">
          <div className="text-[12px] font-semibold text-stone-300 uppercase tracking-wide mb-3">By branch</div>
          {data.orgs.length === 0 ? <p className="text-sm text-stone-500">No open receivables.</p> : (
            <div className="divide-y divide-stone-800/70">
              {data.orgs.map((o) => (
                <div key={o.orgId} className="flex items-center gap-3 py-2">
                  <Building2 size={14} className="text-stone-500 shrink-0" />
                  <span className="flex-1 min-w-0 truncate text-[13px] text-stone-200">{o.orgName}</span>
                  <span className="text-[11px] text-stone-500 tabular-nums">{o.count}</span>
                  <span className="w-28 text-right text-[13px] font-semibold text-stone-100 tabular-nums">{money(o.outstanding, primaryCcy)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Invoice table */}
      <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[720px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                <th className="text-left px-4 py-2.5">Invoice</th>
                <th className="text-left px-4 py-2.5">Organization</th>
                <th className="text-left px-4 py-2.5">Customer</th>
                <th className="text-left px-4 py-2.5">Stage</th>
                <th className="text-right px-4 py-2.5">Overdue</th>
                <th className="text-right px-4 py-2.5">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-500">No open receivables across this group.</td></tr>
              )}
              {data.rows.map((r) => (
                <tr key={r.id} className="border-b border-stone-800/60 hover:bg-stone-800/40">
                  <td className="px-4 py-2">
                    <Link href={`/invoices/${r.id}`} className="font-mono text-[12px] text-stone-300 hover:text-white hover:underline inline-flex items-center gap-1">
                      #{r.invoiceNumber} <ArrowRight size={11} className="opacity-0 group-hover:opacity-100" />
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-800/50">{r.orgName}</span>
                  </td>
                  <td className="px-4 py-2 text-stone-300 max-w-[200px] truncate" title={r.customerName}>{r.customerName}</td>
                  <td className="px-4 py-2 text-stone-400">{r.stage}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${r.days > 90 ? "text-rose-400" : r.days > 60 ? "text-orange-400" : r.days > 30 ? "text-amber-400" : r.days > 0 ? "text-stone-300" : "text-emerald-400"}`}>
                    {r.days > 0 ? `+${r.days}d` : "current"}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold text-stone-100 tabular-nums">{money(r.outstanding, r.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.truncated && <div className="px-4 py-2 text-[11px] text-stone-500 border-t border-stone-800">Showing the 500 most-overdue invoices. Summary totals above cover all.</div>}
      </div>
    </div>
  );
}
