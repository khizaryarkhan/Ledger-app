"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, Badge } from "@/components/ui";
import { fmt } from "@/lib/format";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ShoppingCart,
  Truck,
  PackageCheck,
  Boxes,
  Factory,
  ArrowUpRight,
} from "lucide-react";

interface DashboardData {
  asOf: string;
  currency: string;
  alertCounts: { critical: number; warning: number };
  recentAlerts: { id: string; sourceType: string; sourceDocNumber: string | null; kind: string; severity: "critical" | "warning"; message: string }[];
  procurement: { openPoValue: number; openPoCount: number; expectedBillsValue: number; openBillsValue: number; openBillsOverdueCount: number };
  fulfilment: { openSoValue: number; openSoCount: number; awaitingInvoicingValue: number; openInvoicesValue: number; openInvoicesOverdueCount: number };
  inventory: { totalInventoryValue: number; belowMinCount: number; outOfStockCount: number; trackedItemCount: number };
  manufacturing: { openJobWorkCount: number; openJobWorkValue: number; avgYieldPct: number | null };
  activity7d: { goodsReceiptsPosted: number; shipmentsPosted: number; buildsCompleted: number };
}

const Sk = ({ w = "w-28" }: { w?: string }) => <div className={`h-7 ${w} bg-stone-800 animate-pulse rounded mt-1`} />;
const SkSub = () => <div className="h-3 w-20 bg-stone-800 animate-pulse rounded mt-2" />;

export default function SupplyChainDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/dashboard");
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      setData(await res.json());
    } catch (e: any) {
      setError(e.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const p = data?.procurement;
  const f = data?.fulfilment;
  const inv = data?.inventory;
  const mfg = data?.manufacturing;
  const ccy = data?.currency ?? "PKR";
  const totalAlerts = (data?.alertCounts.critical ?? 0) + (data?.alertCounts.warning ?? 0);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Supply Chain Dashboard</h1>
          <p className="text-sm text-stone-400 mt-1">Procurement, fulfilment, inventory and manufacturing at a glance</p>
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

      {/* Needs attention */}
      <Card padding="none" className="mb-3">
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Needs attention</h2>
            <p className="text-xs text-stone-500 mt-0.5">Late or blocked purchase orders, job work and production</p>
          </div>
          <Link href="/accounting/reports/delivery-risk" className="text-xs text-stone-400 hover:text-white inline-flex items-center gap-1">
            View all <ArrowUpRight size={12} />
          </Link>
        </div>
        {loading ? (
          <div className="p-5 space-y-3">{[0, 1].map(i => <div key={i} className="h-10 bg-stone-800 animate-pulse rounded" />)}</div>
        ) : totalAlerts === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="w-10 h-10 rounded-full bg-stone-800 flex items-center justify-center mb-3">
              <CheckCircle2 size={18} className="text-stone-500" />
            </div>
            <p className="text-sm font-semibold text-white mb-1">All clear</p>
            <p className="text-xs text-stone-500">No open delivery-risk alerts.</p>
          </div>
        ) : (
          <div className="p-5 space-y-2">
            {(data!.alertCounts.critical > 0 || data!.alertCounts.warning > 0) && (
              <div className="flex items-center gap-2 mb-1">
                {data!.alertCounts.critical > 0 && <Badge variant="red" size="sm">{data!.alertCounts.critical} critical</Badge>}
                {data!.alertCounts.warning > 0 && <Badge variant="orange" size="sm">{data!.alertCounts.warning} warning</Badge>}
              </div>
            )}
            {data!.recentAlerts.map(a => (
              <div key={a.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-r-lg border-l-2 ${a.severity === "critical" ? "border-rose-500 bg-rose-500/10" : "border-amber-400 bg-amber-500/10"}`}>
                <AlertTriangle size={14} className={a.severity === "critical" ? "text-rose-400" : "text-amber-400"} />
                <div className="flex-1 min-w-0">
                  <div className={`text-[13px] font-medium ${a.severity === "critical" ? "text-rose-200" : "text-amber-200"}`}>
                    {a.sourceDocNumber ?? a.sourceType.toUpperCase()} — {a.message}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-3 mb-3">
        <Link href="/accounting/trade/purchase-orders">
          <Card padding="md" className="cursor-pointer hover:ring-1 hover:ring-stone-600 transition-all h-full">
            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Open Purchase Orders</div>
            {loading ? <><Sk /><SkSub /></> : <>
              <div className="text-2xl font-semibold text-white tracking-tight">{fmt.money(p?.openPoValue ?? 0, ccy)}</div>
              <div className="mt-2 text-[11px] text-stone-500">{p?.openPoCount ?? 0} open orders</div>
            </>}
          </Card>
        </Link>
        <Link href="/accounting/trade/sales-orders">
          <Card padding="md" className="cursor-pointer hover:ring-1 hover:ring-stone-600 transition-all h-full">
            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Open Sales Orders</div>
            {loading ? <><Sk /><SkSub /></> : <>
              <div className="text-2xl font-semibold text-white tracking-tight">{fmt.money(f?.openSoValue ?? 0, ccy)}</div>
              <div className="mt-2 text-[11px] text-stone-500">{f?.openSoCount ?? 0} open orders</div>
            </>}
          </Card>
        </Link>
        <Link href="/accounting/reports/stock-status">
          <Card padding="md" className="cursor-pointer hover:ring-1 hover:ring-stone-600 transition-all h-full">
            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Inventory Value</div>
            {loading ? <><Sk /><SkSub /></> : <>
              <div className="text-2xl font-semibold text-white tracking-tight">{fmt.money(inv?.totalInventoryValue ?? 0, ccy)}</div>
              <div className="mt-2 text-[11px] text-stone-500">{inv?.trackedItemCount ?? 0} tracked items</div>
            </>}
          </Card>
        </Link>
        <Link href="/accounting/reports/stock-status">
          <Card padding="md" className="cursor-pointer hover:ring-1 hover:ring-stone-600 transition-all h-full">
            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Stock Risk</div>
            {loading ? <><Sk /><SkSub /></> : <>
              <div className={`text-2xl font-semibold tracking-tight ${(inv?.outOfStockCount ?? 0) > 0 ? "text-rose-400" : "text-white"}`}>
                {(inv?.belowMinCount ?? 0) + (inv?.outOfStockCount ?? 0)}
              </div>
              <div className="mt-2 text-[11px] text-stone-500">{inv?.outOfStockCount ?? 0} out of stock · {inv?.belowMinCount ?? 0} below reorder point</div>
            </>}
          </Card>
        </Link>
      </div>

      {/* Procurement + Fulfilment bands */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        <Card padding="md">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-stone-500 font-semibold"><ShoppingCart size={13} /> Procurement</div>
            {!loading && (p?.openBillsOverdueCount ?? 0) > 0 && (
              <div className="flex items-center gap-1 text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded-full">
                <AlertTriangle size={10} /> {p!.openBillsOverdueCount} overdue bill{p!.openBillsOverdueCount !== 1 ? "s" : ""}
              </div>
            )}
          </div>
          {loading ? <div className="grid grid-cols-3 gap-4">{[0, 1, 2].map(i => <div key={i}><Sk /><SkSub /></div>)}</div> : (
            <div className="grid grid-cols-3 gap-4 divide-x divide-stone-800">
              <div className="pr-4">
                <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold mb-1">Open POs</div>
                <div className="text-xl font-semibold tabular-nums text-white">{fmt.money(p?.openPoValue ?? 0, ccy)}</div>
              </div>
              <div className="px-4">
                <div className="text-[10px] uppercase tracking-wider text-amber-500/80 font-semibold mb-1">Awaiting billing</div>
                <div className="text-xl font-semibold tabular-nums text-amber-400">{fmt.money(p?.expectedBillsValue ?? 0, ccy)}</div>
              </div>
              <div className="pl-4">
                <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold mb-1">Open supplier bills</div>
                <div className="text-xl font-semibold tabular-nums text-white">{fmt.money(p?.openBillsValue ?? 0, ccy)}</div>
              </div>
            </div>
          )}
        </Card>

        <Card padding="md">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-stone-500 font-semibold"><Truck size={13} /> Fulfilment</div>
            {!loading && (f?.openInvoicesOverdueCount ?? 0) > 0 && (
              <div className="flex items-center gap-1 text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded-full">
                <AlertTriangle size={10} /> {f!.openInvoicesOverdueCount} overdue invoice{f!.openInvoicesOverdueCount !== 1 ? "s" : ""}
              </div>
            )}
          </div>
          {loading ? <div className="grid grid-cols-3 gap-4">{[0, 1, 2].map(i => <div key={i}><Sk /><SkSub /></div>)}</div> : (
            <div className="grid grid-cols-3 gap-4 divide-x divide-stone-800">
              <div className="pr-4">
                <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold mb-1">Open SOs</div>
                <div className="text-xl font-semibold tabular-nums text-white">{fmt.money(f?.openSoValue ?? 0, ccy)}</div>
              </div>
              <div className="px-4">
                <div className="text-[10px] uppercase tracking-wider text-amber-500/80 font-semibold mb-1">Awaiting invoicing</div>
                <div className="text-xl font-semibold tabular-nums text-amber-400">{fmt.money(f?.awaitingInvoicingValue ?? 0, ccy)}</div>
              </div>
              <div className="pl-4">
                <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold mb-1">Open invoices</div>
                <div className="text-xl font-semibold tabular-nums text-white">{fmt.money(f?.openInvoicesValue ?? 0, ccy)}</div>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Manufacturing + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card padding="none" className="lg:col-span-2">
          <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Factory size={15} className="text-stone-400" />
              <div>
                <h2 className="text-base font-semibold text-white">Manufacturing &amp; Job Work</h2>
                <p className="text-xs text-stone-500 mt-0.5">Open subcontracting orders and yield performance</p>
              </div>
            </div>
            <Link href="/accounting/jobwork" className="text-xs text-stone-400 hover:text-white inline-flex items-center gap-1">
              Job Work <ArrowUpRight size={12} />
            </Link>
          </div>
          <div className="p-5">
            {loading ? (
              <div className="grid grid-cols-3 gap-4">{[0, 1, 2].map(i => <div key={i}><Sk /><SkSub /></div>)}</div>
            ) : (
              <div className="grid grid-cols-3 gap-4 divide-x divide-stone-800">
                <div className="pr-4">
                  <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold mb-1">Open job work orders</div>
                  <div className="text-xl font-semibold tabular-nums text-white">{mfg?.openJobWorkCount ?? 0}</div>
                </div>
                <div className="px-4">
                  <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold mb-1">Value dispatched</div>
                  <div className="text-xl font-semibold tabular-nums text-white">{fmt.money(mfg?.openJobWorkValue ?? 0, ccy)}</div>
                </div>
                <div className="pl-4">
                  <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold mb-1">Avg. yield (closed orders)</div>
                  <div className={`text-xl font-semibold tabular-nums ${mfg?.avgYieldPct != null && mfg.avgYieldPct < 90 ? "text-amber-400" : "text-emerald-400"}`}>
                    {mfg?.avgYieldPct != null ? `${mfg.avgYieldPct.toFixed(1)}%` : "—"}
                  </div>
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card padding="none">
          <div className="px-5 py-4 border-b border-stone-800">
            <h2 className="text-base font-semibold text-white">Activity (7 days)</h2>
            <p className="text-xs text-stone-500 mt-0.5">Recent operational output</p>
          </div>
          <div className="p-5">
            {loading ? (
              <div className="grid grid-cols-3 gap-2">{[0, 1, 2].map(i => <div key={i} className="h-16 bg-stone-800 animate-pulse rounded" />)}</div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center bg-stone-800/40 rounded-lg py-3">
                  <PackageCheck size={14} className="mx-auto text-emerald-400 mb-1" />
                  <div className="text-xl font-bold text-emerald-400 tabular-nums">{data?.activity7d.goodsReceiptsPosted ?? 0}</div>
                  <div className="text-[10px] text-stone-500 mt-1">Receipts</div>
                </div>
                <div className="text-center bg-stone-800/40 rounded-lg py-3">
                  <Truck size={14} className="mx-auto text-blue-400 mb-1" />
                  <div className="text-xl font-bold text-blue-400 tabular-nums">{data?.activity7d.shipmentsPosted ?? 0}</div>
                  <div className="text-[10px] text-stone-500 mt-1">Shipments</div>
                </div>
                <div className="text-center bg-stone-800/40 rounded-lg py-3">
                  <Boxes size={14} className="mx-auto text-violet-400 mb-1" />
                  <div className="text-xl font-bold text-violet-400 tabular-nums">{data?.activity7d.buildsCompleted ?? 0}</div>
                  <div className="text-[10px] text-stone-500 mt-1">Builds</div>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
