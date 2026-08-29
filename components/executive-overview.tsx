"use client";

/**
 * Executive Overview — the whole business at a glance, for a reader who
 * doesn't want to open a ledger. Every figure here reconciles to the same
 * native GL / synced tables the detailed reports use (see
 * app/api/reports/executive-overview) — this is a summary of those, not a
 * separate calculation.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Landmark, ArrowDownToLine, ArrowUpFromLine, Boxes, ShieldCheck,
  TrendingUp, TrendingDown, RefreshCw, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { fmt } from "@/lib/format";

type Overview = {
  asOf: string; currency: string; cash: number;
  ar: { total: number; overdue: number; openCount: number; glBalance: number };
  ap: { total: number; overdue: number; openCount: number; glBalance: number };
  inventoryValue: number;
  pendingApprovals: { count: number; amount: number };
  revenue: { mtd: number; ytd: number };
  grossProfit: { mtd: number; ytd: number };
  netProfit: { mtd: number; ytd: number };
  workingCapital: number;
  ledgerIntegrity: { trialBalanceOk: boolean; balanceSheetOk: boolean };
};

function Kpi({ icon: Icon, label, value, sub, tone = "stone" }: { icon: any; label: string; value: string; sub?: string; tone?: "stone" | "rose" | "emerald" | "amber" }) {
  const toneCls: Record<string, string> = {
    stone: "bg-stone-800 text-stone-300",
    rose: "bg-rose-500/15 text-rose-400",
    emerald: "bg-emerald-500/15 text-emerald-400",
    amber: "bg-amber-500/15 text-amber-400",
  };
  return (
    <div className="rounded-xl bg-stone-900 border border-stone-800 p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${toneCls[tone]}`}><Icon size={14} /></div>
        <div className="text-[11.5px] uppercase tracking-wide text-stone-500">{label}</div>
      </div>
      <div className="text-xl font-semibold text-stone-100 tabular-nums">{value}</div>
      {sub && <div className="text-[12px] text-stone-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function MarginRow({ label, mtd, ytd, money }: { label: string; mtd: number; ytd: number; money: (n: number) => string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-stone-800 last:border-0">
      <div className="text-[13px] text-stone-400">{label}</div>
      <div className="flex items-center gap-8">
        <div className="text-right w-32">
          <div className="text-[10px] text-stone-600 uppercase">This month</div>
          <div className={`tabular-nums text-[13.5px] font-medium ${mtd < 0 ? "text-rose-400" : "text-stone-200"}`}>{money(mtd)}</div>
        </div>
        <div className="text-right w-32">
          <div className="text-[10px] text-stone-600 uppercase">Year to date</div>
          <div className={`tabular-nums text-[13.5px] font-medium ${ytd < 0 ? "text-rose-400" : "text-stone-200"}`}>{money(ytd)}</div>
        </div>
      </div>
    </div>
  );
}

export function ExecutiveOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState("");

  async function load() {
    setErr("");
    const r = await fetch(`/api/reports/executive-overview`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(d.error || "Could not load."); return; }
    setData(d);
  }
  useEffect(() => { load(); }, []);

  const money = (n: number) => fmt.money(n, data?.currency ?? "EUR");
  const marginPct = (num: number, den: number) => den > 0.005 ? `${((num / den) * 100).toFixed(1)}% margin` : undefined;

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h1 className="text-xl font-semibold text-stone-100">Executive Overview</h1>
          <p className="text-[12.5px] text-stone-500 mt-0.5">The whole business, at a glance — as of {data ? fmt.date(data.asOf) : "…"}</p>
        </div>
        <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={data === null ? "animate-spin" : ""} /></button>
      </div>

      {err && <div className="mt-4 text-[12.5px] text-rose-400 bg-rose-950/30 border border-rose-900 rounded-lg px-3 py-2">{err}</div>}
      {data === null && !err && <div className="mt-8 text-center text-stone-500 text-sm">Loading…</div>}

      {data && (
        <>
          {!data.ledgerIntegrity.trialBalanceOk && (
            <div className="mt-4 flex items-center gap-2 text-[12.5px] text-amber-400 bg-amber-950/20 border border-amber-900/50 rounded-lg px-3 py-2">
              <AlertTriangle size={14} /> The trial balance doesn't currently net to zero — the figures below may be incomplete until that's resolved.
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
            <Kpi icon={Landmark} label="Cash" value={money(data.cash)} tone="emerald" />
            <Kpi icon={ArrowDownToLine} label="Receivable" value={money(data.ar.total)}
              sub={data.ar.overdue > 0.005 ? `${money(data.ar.overdue)} overdue` : `${data.ar.openCount} open`} tone={data.ar.overdue > 0.005 ? "rose" : "stone"} />
            <Kpi icon={ArrowUpFromLine} label="Payable" value={money(data.ap.total)}
              sub={data.ap.overdue > 0.005 ? `${money(data.ap.overdue)} overdue` : `${data.ap.openCount} open`} tone={data.ap.overdue > 0.005 ? "rose" : "stone"} />
            <Kpi icon={Boxes} label="Inventory value" value={money(data.inventoryValue)} tone="stone" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-2 gap-3 mt-3">
            <Kpi icon={ShieldCheck} label="Awaiting approval" value={data.pendingApprovals.count === 0 ? "Nothing pending" : money(data.pendingApprovals.amount)}
              sub={data.pendingApprovals.count > 0 ? `${data.pendingApprovals.count} request${data.pendingApprovals.count === 1 ? "" : "s"} — see Approvals` : undefined}
              tone={data.pendingApprovals.count > 0 ? "amber" : "emerald"} />
            <Kpi icon={data.workingCapital >= 0 ? TrendingUp : TrendingDown} label="Working capital" value={money(data.workingCapital)}
              sub="Cash + Receivable + Inventory − Payable" tone={data.workingCapital >= 0 ? "emerald" : "rose"} />
          </div>

          <div className="mt-6 rounded-xl bg-stone-900 border border-stone-800 p-5">
            <h2 className="text-sm font-semibold text-stone-200 mb-3">Profitability</h2>
            <MarginRow label="Revenue" mtd={data.revenue.mtd} ytd={data.revenue.ytd} money={money} />
            <MarginRow label={`Gross profit  ${marginPct(data.grossProfit.ytd, data.revenue.ytd) ?? ""}`} mtd={data.grossProfit.mtd} ytd={data.grossProfit.ytd} money={money} />
            <MarginRow label={`Net profit  ${marginPct(data.netProfit.ytd, data.revenue.ytd) ?? ""}`} mtd={data.netProfit.mtd} ytd={data.netProfit.ytd} money={money} />
          </div>

          <div className="mt-4 flex items-center gap-4 text-[12px] text-stone-500">
            <div className="flex items-center gap-1.5">
              {data.ledgerIntegrity.trialBalanceOk ? <CheckCircle2 size={13} className="text-emerald-500" /> : <AlertTriangle size={13} className="text-amber-500" />}
              Trial balance {data.ledgerIntegrity.trialBalanceOk ? "balanced" : "out of balance"}
            </div>
            <div className="flex items-center gap-1.5">
              {data.ledgerIntegrity.balanceSheetOk ? <CheckCircle2 size={13} className="text-emerald-500" /> : <AlertTriangle size={13} className="text-amber-500" />}
              Balance sheet {data.ledgerIntegrity.balanceSheetOk ? "balanced" : "out of balance"}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <Link href="/accounting/approvals" className="text-[12.5px] font-medium bg-stone-800 hover:bg-stone-700 text-stone-200 rounded-lg px-3 py-1.5">Approvals</Link>
            <Link href="/reporting/profit-loss" className="text-[12.5px] font-medium bg-stone-800 hover:bg-stone-700 text-stone-200 rounded-lg px-3 py-1.5">Profit &amp; Loss</Link>
            <Link href="/reporting/balance-sheet" className="text-[12.5px] font-medium bg-stone-800 hover:bg-stone-700 text-stone-200 rounded-lg px-3 py-1.5">Balance Sheet</Link>
            <Link href="/accounting/reports" className="text-[12.5px] font-medium bg-stone-800 hover:bg-stone-700 text-stone-200 rounded-lg px-3 py-1.5">All reports</Link>
          </div>
        </>
      )}
    </div>
  );
}
