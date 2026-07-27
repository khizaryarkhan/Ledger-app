"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";
import { fmt } from "@/lib/format";
import { CurrencyPills } from "@/components/currency-pills";
import {
  BarChart3, AlertTriangle, CheckCircle2, Clock, TrendingDown,
  Receipt, Building2, Banknote, PauseCircle,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Bill {
  id: string;
  billNumber?: string;
  supplierId?: string;
  supplierName?: string;
  billDate?: string;
  dueDate?: string;
  currency: string;
  total: number;
  balance: number;
  workflowStatus: string;
  accountingStatus: string;
  approverEmail?: string;
  lastApprovalSentAt?: string;
  updatedAt?: string;
  createdAt: string;
}

function daysOver(dateStr?: string): number {
  if (!dateStr) return 0;
  return Math.max(0, Math.round((Date.now() - new Date(dateStr).getTime()) / 86400000));
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function ScoreBar({ value, max, color = "bg-stone-600" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="w-full h-1.5 bg-stone-800 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function OverduePct({ value }: { value: number }) {
  const color = value <= 15 ? "bg-emerald-500/15 text-emerald-400" : value <= 40 ? "bg-amber-500/15 text-amber-400" : "bg-rose-500/15 text-rose-400";
  return <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${color}`}>{value.toFixed(0)}%</span>;
}

function byCcy(bills: Bill[], amtFn: (b: Bill) => number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of bills) {
    const a = amtFn(b); if (!a) continue;
    out[b.currency] = (out[b.currency] || 0) + a;
  }
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function APPerformancePage() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<"week" | "month">("month");

  useEffect(() => {
    fetch("/api/payables/bills?limit=2000")
      .then(r => r.ok ? r.json() : { bills: [] })
      .then(d => setBills(Array.isArray(d) ? d : (d.bills ?? [])))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const now = new Date();
  const periodStart = period === "month"
    ? new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    : new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const periodLabel = period === "month" ? "This month" : "Last 7 days";

  // ── Global KPIs ───────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const open = bills.filter(b => b.accountingStatus === "Unpaid" || b.accountingStatus === "Partially Paid");
    const overdue = open.filter(b => daysOver(b.dueDate) > 0);
    const pendingApproval = bills.filter(b => b.workflowStatus === "Pending Approval");
    const onHold = bills.filter(b => b.workflowStatus === "On Hold");
    const readyForPayment = bills.filter(b => b.workflowStatus === "Ready for Payment");
    const paidInPeriod = bills.filter(b => b.accountingStatus === "Paid" && b.updatedAt && b.updatedAt >= periodStart);
    return {
      totalOpenByCcy: byCcy(open, b => b.balance),
      overdueByCcy: byCcy(overdue, b => b.balance),
      paidInPeriodByCcy: byCcy(paidInPeriod, b => b.total),
      openCount: open.length,
      overdueCount: overdue.length,
      pendingApprovalCount: pendingApproval.length,
      onHoldCount: onHold.length,
      readyForPaymentCount: readyForPayment.length,
      paidCount: paidInPeriod.length,
      overduePct: open.length > 0 ? (overdue.length / open.length) * 100 : 0,
    };
  }, [bills, periodStart]);

  // ── By supplier ───────────────────────────────────────────────────────────
  const supplierData = useMemo(() => {
    const map = new Map<string, { name: string; open: Bill[]; overdue: Bill[]; onHold: number; pendingApproval: number }>();
    for (const b of bills) {
      const sid = b.supplierId || "unknown";
      if (!map.has(sid)) map.set(sid, { name: b.supplierName || "Unknown", open: [], overdue: [], onHold: 0, pendingApproval: 0 });
      const g = map.get(sid)!;
      if (b.accountingStatus === "Unpaid" || b.accountingStatus === "Partially Paid") {
        g.open.push(b);
        if (daysOver(b.dueDate) > 0) g.overdue.push(b);
      }
      if (b.workflowStatus === "On Hold") g.onHold++;
      if (b.workflowStatus === "Pending Approval") g.pendingApproval++;
    }
    return [...map.values()]
      .map(s => ({
        ...s,
        openByCcy: byCcy(s.open, b => b.balance),
        overdueByCcy: byCcy(s.overdue, b => b.balance),
        openTotal: s.open.reduce((sum, b) => sum + b.balance, 0),
        overduePct: s.open.length > 0 ? (s.overdue.length / s.open.length) * 100 : 0,
        avgOverdueDays: s.overdue.length > 0
          ? Math.round(s.overdue.reduce((sum, b) => sum + daysOver(b.dueDate), 0) / s.overdue.length)
          : 0,
      }))
      .filter(s => s.open.length > 0)
      .sort((a, b) => b.openTotal - a.openTotal)
      .slice(0, 15);
  }, [bills]);

  // ── Workflow status breakdown ─────────────────────────────────────────────
  const workflowBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const b of bills) counts[b.workflowStatus] = (counts[b.workflowStatus] || 0) + 1;
    const order = ["Pending Review", "Pending Approval", "Approved", "Ready for Payment", "On Hold", "Rejected", "Scheduled"];
    return order.filter(s => counts[s]).map(s => ({ status: s, count: counts[s] }));
  }, [bills]);

  const WORKFLOW_COLORS: Record<string, string> = {
    "Pending Review":    "bg-stone-600",
    "Pending Approval":  "bg-amber-500",
    "Approved":          "bg-emerald-500",
    "Ready for Payment": "bg-blue-500",
    "On Hold":           "bg-orange-500",
    "Rejected":          "bg-rose-500",
    "Scheduled":         "bg-violet-500",
  };

  const maxSupplierTotal = Math.max(...supplierData.map(s => s.openTotal), 1);

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-3 text-stone-400">
        <span className="inline-block w-5 h-5 border-2 border-stone-600 border-t-stone-300 rounded-full animate-spin" />
        Loading payables data…
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Performance</h1>
          <p className="text-sm text-stone-400 mt-1">Payables health, supplier exposure and workflow activity</p>
        </div>
        <div className="flex items-center gap-1 bg-stone-800 p-1 rounded-xl">
          {(["week", "month"] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${period === p ? "bg-stone-700 text-white shadow-sm" : "text-stone-400 hover:text-stone-200"}`}>
              {p === "week" ? "This Week" : "This Month"}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-5 gap-3 mb-5">
        {[
          { label: "Total Open AP",      value: <CurrencyPills breakdown={kpis.totalOpenByCcy} />,   sub: `${kpis.openCount} bills`,                    icon: BarChart3,      color: "text-white"       },
          { label: "Overdue",            value: <CurrencyPills breakdown={kpis.overdueByCcy} />,     sub: `${kpis.overduePct.toFixed(0)}% of open AP`,  icon: AlertTriangle,  color: "text-rose-400"    },
          { label: "Paid",               value: <CurrencyPills breakdown={kpis.paidInPeriodByCcy} />,sub: periodLabel,                                  icon: CheckCircle2,   color: "text-emerald-400" },
          { label: "Pending Approval",   value: String(kpis.pendingApprovalCount),                  sub: "awaiting sign-off",                           icon: Clock,          color: "text-amber-400"   },
          { label: "Ready for Payment",  value: String(kpis.readyForPaymentCount),                  sub: "approved, not yet paid",                      icon: Banknote,       color: "text-blue-400"    },
        ].map(({ label, value, sub, icon: Icon, color }) => (
          <Card key={label} padding="md">
            <div className="flex items-center gap-2 mb-2">
              <Icon size={14} className={`${color} shrink-0`} />
              <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold">{label}</div>
            </div>
            <div className={`text-2xl font-semibold tracking-tight tabular-nums ${color}`}>{value}</div>
            <div className="mt-1 text-[11px] text-stone-400">{sub}</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4 mb-5">
        {/* Workflow breakdown */}
        <Card className="col-span-1">
          <h3 className="text-sm font-semibold text-white mb-4">Workflow Status</h3>
          {workflowBreakdown.length === 0 ? (
            <p className="text-[12px] text-stone-500">No bills in workflow</p>
          ) : (
            <div className="space-y-2.5">
              {workflowBreakdown.map(({ status, count }) => (
                <div key={status}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[12px] text-stone-300">{status}</span>
                    <span className="text-[12px] font-semibold text-stone-400 tabular-nums">{count}</span>
                  </div>
                  <ScoreBar value={count} max={bills.length} color={WORKFLOW_COLORS[status] ?? "bg-stone-600"} />
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Aging distribution */}
        <Card className="col-span-1">
          <h3 className="text-sm font-semibold text-white mb-4">Aging Distribution</h3>
          {(() => {
            const open = bills.filter(b => b.accountingStatus === "Unpaid" || b.accountingStatus === "Partially Paid");
            const buckets = [
              { label: "Current",    count: open.filter(b => daysOver(b.dueDate) === 0).length,                         color: "bg-emerald-500" },
              { label: "1–30 days",  count: open.filter(b => { const d = daysOver(b.dueDate); return d > 0 && d <= 30; }).length,   color: "bg-amber-500"  },
              { label: "31–60 days", count: open.filter(b => { const d = daysOver(b.dueDate); return d > 30 && d <= 60; }).length,  color: "bg-orange-500" },
              { label: "61–90 days", count: open.filter(b => { const d = daysOver(b.dueDate); return d > 60 && d <= 90; }).length,  color: "bg-rose-500"   },
              { label: "90+ days",   count: open.filter(b => daysOver(b.dueDate) > 90).length,                          color: "bg-red-700"    },
            ];
            const maxBucket = Math.max(...buckets.map(b => b.count), 1);
            return (
              <div className="space-y-2.5">
                {buckets.map(({ label, count, color }) => (
                  <div key={label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[12px] text-stone-300">{label}</span>
                      <span className="text-[12px] font-semibold text-stone-400 tabular-nums">{count}</span>
                    </div>
                    <ScoreBar value={count} max={maxBucket} color={color} />
                  </div>
                ))}
              </div>
            );
          })()}
        </Card>

        {/* On hold / blocked */}
        <Card className="col-span-1">
          <h3 className="text-sm font-semibold text-white mb-4">Blocked Bills</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-stone-800 rounded-lg">
              <div className="flex items-center gap-2"><PauseCircle size={15} className="text-orange-400" /><span className="text-[13px] text-stone-300">On Hold</span></div>
              <span className="text-lg font-semibold text-orange-400">{kpis.onHoldCount}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-stone-800 rounded-lg">
              <div className="flex items-center gap-2"><AlertTriangle size={15} className="text-rose-400" /><span className="text-[13px] text-stone-300">Overdue</span></div>
              <span className="text-lg font-semibold text-rose-400">{kpis.overdueCount}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-stone-800 rounded-lg">
              <div className="flex items-center gap-2"><Clock size={15} className="text-amber-400" /><span className="text-[13px] text-stone-300">Pending Approval</span></div>
              <span className="text-lg font-semibold text-amber-400">{kpis.pendingApprovalCount}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Supplier table */}
      <div className="bg-stone-900 rounded-xl ring-1 ring-stone-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-800">
          <div className="text-sm font-semibold text-white">Supplier Exposure</div>
          <div className="text-[11px] text-stone-400 mt-0.5">Top {supplierData.length} suppliers by open payables</div>
        </div>
        {supplierData.length === 0 ? (
          <div className="py-12 text-center">
            <Building2 size={28} className="text-stone-600 mx-auto mb-3" />
            <p className="text-sm text-stone-500">No open payables data found.</p>
            <p className="text-xs text-stone-600 mt-1">
              Sync your accounting system in <Link href="/payables/settings" className="text-stone-400 underline">Payables settings</Link>.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-stone-400 border-b border-stone-800 bg-stone-900/60">
                  <th className="text-left font-semibold px-5 py-3">Supplier</th>
                  <th className="text-right font-semibold px-3 py-3">Open Bills</th>
                  <th className="text-right font-semibold px-3 py-3">Open AP</th>
                  <th className="text-right font-semibold px-3 py-3">Overdue</th>
                  <th className="text-right font-semibold px-3 py-3">Overdue %</th>
                  <th className="text-right font-semibold px-3 py-3">Avg DPO</th>
                  <th className="text-right font-semibold px-3 py-3">On Hold</th>
                  <th className="text-right font-semibold px-5 py-3">Pending Approval</th>
                </tr>
              </thead>
              <tbody>
                {supplierData.map((s, idx) => (
                  <tr key={idx} className="border-b border-stone-800 hover:bg-stone-800/50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-14">
                          <ScoreBar value={s.openTotal} max={maxSupplierTotal} color="bg-violet-500" />
                        </div>
                        <span className="font-semibold text-white">{s.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-stone-400">{s.open.length}</td>
                    <td className="px-3 py-3 text-right font-bold tabular-nums text-white"><CurrencyPills breakdown={s.openByCcy} /></td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {s.overdue.length > 0
                        ? <span className="text-rose-400 font-medium"><CurrencyPills breakdown={s.overdueByCcy} /></span>
                        : <span className="text-stone-600">—</span>}
                    </td>
                    <td className="px-3 py-3 text-right"><OverduePct value={s.overduePct} /></td>
                    <td className="px-3 py-3 text-right">
                      {s.avgOverdueDays > 0
                        ? <span className={`text-xs font-semibold ${s.avgOverdueDays > 60 ? "text-rose-400" : s.avgOverdueDays > 30 ? "text-amber-400" : "text-stone-300"}`}>{s.avgOverdueDays}d</span>
                        : <span className="text-stone-600 text-xs">—</span>}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {s.onHold > 0
                        ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 font-semibold">{s.onHold}</span>
                        : <span className="text-stone-600 text-xs">—</span>}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {s.pendingApproval > 0
                        ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-semibold">{s.pendingApproval}</span>
                        : <span className="text-stone-600 text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
