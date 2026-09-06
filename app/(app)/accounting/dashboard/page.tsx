"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";
import { fmt } from "@/lib/format";
import {
  AlertCircle,
  AlertTriangle,
  Wallet,
  TrendingUp,
  Scale,
  ShieldCheck,
  ArrowUpRight,
  BookOpen,
  Landmark,
  Receipt,
  PieChart,
  Globe,
} from "lucide-react";

interface Overview {
  asOf: string;
  currency: string;
  cash: number;
  ar: { total: number; overdue: number; openCount: number; glBalance: number };
  ap: { total: number; overdue: number; openCount: number; glBalance: number };
  inventoryValue: number;
  pendingApprovals: { count: number; amount: number };
  revenue: { mtd: number; ytd: number };
  grossProfit: { mtd: number; ytd: number };
  netProfit: { mtd: number; ytd: number };
  workingCapital: number;
  ledgerIntegrity: { trialBalanceOk: boolean; balanceSheetOk: boolean };
}

interface Aging { rows: any[]; buckets: Record<string, number>; total: number; asOf: string }

const Sk = ({ w = "w-28" }: { w?: string }) => <div className={`h-7 ${w} bg-stone-800 animate-pulse rounded mt-1`} />;
const SkSub = () => <div className="h-3 w-20 bg-stone-800 animate-pulse rounded mt-2" />;
const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);

const QUICK_LINKS = [
  { href: "/accounting/reports/trial-balance", label: "Trial Balance", icon: Scale },
  { href: "/accounting/reports/profit-loss", label: "Profit & Loss", icon: TrendingUp },
  { href: "/accounting/reports/balance-sheet", label: "Balance Sheet", icon: BookOpen },
  { href: "/accounting/reports/cash-flow", label: "Cash Flow", icon: Wallet },
  { href: "/accounting/reconcile", label: "Reconcile", icon: Landmark },
  { href: "/accounting/reports/tax-liability", label: "Tax Liability", icon: Receipt },
  { href: "/accounting/reports/fx-exposure", label: "FX Exposure", icon: Globe },
];

export default function AccountingDashboardPage() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [arAging, setArAging] = useState<Aging | null>(null);
  const [apAging, setApAging] = useState<Aging | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [ovRes, arRes, apRes] = await Promise.all([
        fetch("/api/reports/executive-overview"),
        fetch("/api/accounting/aging?side=receivable"),
        fetch("/api/accounting/aging?side=payable"),
      ]);
      if (!ovRes.ok) throw new Error(`Server error ${ovRes.status}`);
      setOv(await ovRes.json());
      if (arRes.ok) setArAging(await arRes.json());
      if (apRes.ok) setApAging(await apRes.json());
    } catch (e: any) {
      setError(e.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const ccy = ov?.currency ?? "PKR";
  const booksOk = ov ? ov.ledgerIntegrity.trialBalanceOk && ov.ledgerIntegrity.balanceSheetOk : true;
  const arVariance = ov ? r2(ov.ar.total - ov.ar.glBalance) : 0;
  const apVariance = ov ? r2(ov.ap.total - ov.ap.glBalance) : 0;
  function r2(n: number) { return Math.round(n * 100) / 100; }

  const arMax = arAging ? Math.max(...Object.values(arAging.buckets), 1) : 1;
  const apMax = apAging ? Math.max(...Object.values(apAging.buckets), 1) : 1;
  const bucketDefs = [
    { key: "current", label: "Current", color: "bg-emerald-500" },
    { key: "1-30", label: "1-30 days", color: "bg-amber-400" },
    { key: "31-60", label: "31-60 days", color: "bg-orange-500" },
    { key: "61-90", label: "61-90 days", color: "bg-rose-400" },
    { key: "90+", label: "90+ days", color: "bg-rose-600" },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Accounting Dashboard</h1>
          <p className="text-sm text-stone-400 mt-1">Cash, ledger health, profitability and aging at a glance</p>
        </div>
        <div className="text-xs text-stone-500">Last updated {fmt.date(new Date())}</div>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 rounded-lg bg-rose-500/10 ring-1 ring-rose-500/30 text-rose-400 text-sm">
          <AlertCircle size={16} />
          {error}
          <button onClick={load} className="ml-auto underline hover:no-underline text-rose-300">Retry</button>
        </div>
      )}

      {/* Ledger integrity banner */}
      {!loading && (
        <div className={`mb-4 flex items-center gap-2.5 px-4 py-3 rounded-lg ${booksOk ? "bg-emerald-500/10 ring-1 ring-emerald-500/30 text-emerald-400" : "bg-rose-500/10 ring-1 ring-rose-500/30 text-rose-400"}`}>
          {booksOk ? <ShieldCheck size={16} /> : <AlertTriangle size={16} />}
          <span className="text-sm font-medium">
            {booksOk ? "Books balance — Trial Balance and Balance Sheet both check out" : "Ledger integrity issue detected"}
          </span>
          {!booksOk && (
            <Link href="/accounting/reports/trial-balance" className="ml-auto text-xs underline hover:no-underline">Investigate →</Link>
          )}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-3 mb-3">
        <Card padding="md" className="h-full">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Cash</div>
          {loading ? <><Sk /><SkSub /></> : <>
            <div className="text-2xl font-semibold text-white tracking-tight">{fmt.money(ov?.cash ?? 0, ccy)}</div>
            <div className="mt-2 text-[11px] text-stone-500">Bank-type accounts, as at {ov?.asOf ? fmt.date(ov.asOf) : "—"}</div>
          </>}
        </Card>
        <Card padding="md" className="h-full">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Net Profit (MTD)</div>
          {loading ? <><Sk /><SkSub /></> : <>
            <div className={`text-2xl font-semibold tracking-tight ${(ov?.netProfit.mtd ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {fmt.money(ov?.netProfit.mtd ?? 0, ccy)}
            </div>
            <div className="mt-2 text-[11px] text-stone-500">YTD {fmt.money(ov?.netProfit.ytd ?? 0, ccy)}</div>
          </>}
        </Card>
        <Card padding="md" className="h-full">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Working Capital</div>
          {loading ? <><Sk /><SkSub /></> : <>
            <div className="text-2xl font-semibold text-white tracking-tight">{fmt.money(ov?.workingCapital ?? 0, ccy)}</div>
            <div className="mt-2 text-[11px] text-stone-500">Cash + AR + Inventory − AP</div>
          </>}
        </Card>
        <Link href="/accounting/approvals">
          <Card padding="md" className="cursor-pointer hover:ring-1 hover:ring-stone-600 transition-all h-full">
            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Pending Approvals</div>
            {loading ? <><Sk /><SkSub /></> : <>
              <div className="text-2xl font-semibold text-white tracking-tight">{fmt.money(ov?.pendingApprovals.amount ?? 0, ccy)}</div>
              <div className="mt-2 text-[11px] text-stone-500">{ov?.pendingApprovals.count ?? 0} awaiting approval</div>
            </>}
          </Card>
        </Link>
      </div>

      {/* AR vs AP band */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-4">Receivables</div>
          {loading ? <div className="grid grid-cols-3 gap-4">{[0, 1, 2].map(i => <div key={i}><Sk /><SkSub /></div>)}</div> : (
            <div className="grid grid-cols-3 gap-4 divide-x divide-stone-800">
              <div className="pr-4">
                <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold mb-1">Total</div>
                <div className="text-xl font-semibold tabular-nums text-white">{fmt.money(ov?.ar.total ?? 0, ccy)}</div>
                <div className="mt-1 text-[11px] text-stone-500">{ov?.ar.openCount ?? 0} open</div>
              </div>
              <div className="px-4">
                <div className="text-[10px] uppercase tracking-wider text-rose-500/80 font-semibold mb-1">Overdue</div>
                <div className="text-xl font-semibold tabular-nums text-rose-400">{fmt.money(ov?.ar.overdue ?? 0, ccy)}</div>
              </div>
              <div className="pl-4">
                <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold mb-1">GL balance</div>
                <div className="text-xl font-semibold tabular-nums text-white">{fmt.money(ov?.ar.glBalance ?? 0, ccy)}</div>
                {Math.abs(arVariance) > 0.5 && <div className="mt-1 text-[11px] text-amber-400">Δ {fmt.money(arVariance, ccy)} vs subledger</div>}
              </div>
            </div>
          )}
        </Card>
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-4">Payables</div>
          {loading ? <div className="grid grid-cols-3 gap-4">{[0, 1, 2].map(i => <div key={i}><Sk /><SkSub /></div>)}</div> : (
            <div className="grid grid-cols-3 gap-4 divide-x divide-stone-800">
              <div className="pr-4">
                <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold mb-1">Total</div>
                <div className="text-xl font-semibold tabular-nums text-white">{fmt.money(ov?.ap.total ?? 0, ccy)}</div>
                <div className="mt-1 text-[11px] text-stone-500">{ov?.ap.openCount ?? 0} open</div>
              </div>
              <div className="px-4">
                <div className="text-[10px] uppercase tracking-wider text-rose-500/80 font-semibold mb-1">Overdue</div>
                <div className="text-xl font-semibold tabular-nums text-rose-400">{fmt.money(ov?.ap.overdue ?? 0, ccy)}</div>
              </div>
              <div className="pl-4">
                <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold mb-1">GL balance</div>
                <div className="text-xl font-semibold tabular-nums text-white">{fmt.money(ov?.ap.glBalance ?? 0, ccy)}</div>
                {Math.abs(apVariance) > 0.5 && <div className="mt-1 text-[11px] text-amber-400">Δ {fmt.money(apVariance, ccy)} vs subledger</div>}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Revenue & Profitability */}
      <Card padding="md" className="mb-3">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-4">
          <PieChart size={13} /> Revenue &amp; Profitability
        </div>
        {loading ? <div className="grid grid-cols-3 gap-4">{[0, 1, 2].map(i => <div key={i}><Sk /><SkSub /></div>)}</div> : (
          <div className="grid grid-cols-3 gap-4 divide-x divide-stone-800">
            <div className="pr-4">
              <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold mb-1">Revenue</div>
              <div className="text-xl font-semibold tabular-nums text-white">{fmt.money(ov?.revenue.mtd ?? 0, ccy)}</div>
              <div className="mt-1 text-[11px] text-stone-500">MTD · YTD {fmt.money(ov?.revenue.ytd ?? 0, ccy)}</div>
            </div>
            <div className="px-4">
              <div className="text-[10px] uppercase tracking-wider text-sky-500/80 font-semibold mb-1">Gross Profit</div>
              <div className="text-xl font-semibold tabular-nums text-sky-400">{fmt.money(ov?.grossProfit.mtd ?? 0, ccy)}</div>
              <div className="mt-1 text-[11px] text-stone-500">{pct(ov?.grossProfit.mtd ?? 0, ov?.revenue.mtd ?? 0).toFixed(1)}% margin</div>
            </div>
            <div className="pl-4">
              <div className="text-[10px] uppercase tracking-wider text-emerald-500/80 font-semibold mb-1">Net Profit</div>
              <div className="text-xl font-semibold tabular-nums text-emerald-400">{fmt.money(ov?.netProfit.mtd ?? 0, ccy)}</div>
              <div className="mt-1 text-[11px] text-stone-500">{pct(ov?.netProfit.mtd ?? 0, ov?.revenue.mtd ?? 0).toFixed(1)}% margin</div>
            </div>
          </div>
        )}
      </Card>

      {/* Aging buckets */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        <Card padding="none">
          <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
            <h2 className="text-base font-semibold text-white">Receivables aging</h2>
            <Link href="/accounting/reports/aged-receivables" className="text-xs text-stone-400 hover:text-white inline-flex items-center gap-1">Aging report <ArrowUpRight size={12} /></Link>
          </div>
          <div className="p-5 space-y-3">
            {loading || !arAging ? [0, 1, 2, 3, 4].map(i => <div key={i} className="h-6 bg-stone-800 animate-pulse rounded" />) : (
              bucketDefs.map(b => (
                <div key={b.key} className="flex items-center gap-3">
                  <div className="w-24 text-xs text-stone-400 shrink-0">{b.label}</div>
                  <div className="flex-1 h-6 bg-stone-800/60 rounded overflow-hidden">
                    <div className={`h-full ${b.color} rounded`} style={{ width: `${((arAging.buckets[b.key] ?? 0) / arMax) * 100}%` }} />
                  </div>
                  <div className="w-24 text-right text-sm font-semibold text-white tabular-nums shrink-0">{fmt.money(arAging.buckets[b.key] ?? 0, ccy)}</div>
                </div>
              ))
            )}
          </div>
        </Card>
        <Card padding="none">
          <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
            <h2 className="text-base font-semibold text-white">Payables aging</h2>
            <Link href="/accounting/reports/aged-payables" className="text-xs text-stone-400 hover:text-white inline-flex items-center gap-1">Aging report <ArrowUpRight size={12} /></Link>
          </div>
          <div className="p-5 space-y-3">
            {loading || !apAging ? [0, 1, 2, 3, 4].map(i => <div key={i} className="h-6 bg-stone-800 animate-pulse rounded" />) : (
              bucketDefs.map(b => (
                <div key={b.key} className="flex items-center gap-3">
                  <div className="w-24 text-xs text-stone-400 shrink-0">{b.label}</div>
                  <div className="flex-1 h-6 bg-stone-800/60 rounded overflow-hidden">
                    <div className={`h-full ${b.color} rounded`} style={{ width: `${((apAging.buckets[b.key] ?? 0) / apMax) * 100}%` }} />
                  </div>
                  <div className="w-24 text-right text-sm font-semibold text-white tabular-nums shrink-0">{fmt.money(apAging.buckets[b.key] ?? 0, ccy)}</div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Quick links */}
      <Card padding="md">
        <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-4">Reports &amp; tools</div>
        <div className="grid grid-cols-4 gap-2">
          {QUICK_LINKS.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="flex items-center gap-2 px-3 py-2.5 rounded-md border border-stone-800 hover:border-stone-600 hover:bg-stone-800/50 transition-colors">
              <Icon size={14} className="text-stone-400 shrink-0" />
              <span className="text-[13px] text-stone-200 truncate">{label}</span>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
