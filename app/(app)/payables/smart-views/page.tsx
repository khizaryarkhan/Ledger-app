"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Card, Badge, EmptyState } from "@/components/ui";
import { fmt } from "@/lib/format";
import { Filter, ChevronRight } from "lucide-react";

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
}

function daysUntil(dateStr?: string): number {
  if (!dateStr) return 0;
  return Math.round((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

function daysOver(dateStr?: string): number {
  if (!dateStr) return 0;
  return Math.round((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

const VIEWS = [
  // IMMEDIATE ACTION
  { id: "due-today",          name: "Due today",                    description: "Bills due today — arrange payment or get approval now",           group: "Immediate", filter: (b: Bill) => b.accountingStatus === "Unpaid" && daysUntil(b.dueDate) === 0 },
  { id: "due-week",           name: "Due this week",                description: "Bills due in the next 7 days",                                   group: "Immediate", filter: (b: Bill) => b.accountingStatus === "Unpaid" && daysUntil(b.dueDate) > 0 && daysUntil(b.dueDate) <= 7 },
  { id: "overdue",            name: "Overdue bills",                description: "Past due — requires immediate action",                            group: "Immediate", filter: (b: Bill) => b.accountingStatus === "Unpaid" && daysOver(b.dueDate) > 0 },
  { id: "pending-approval",   name: "Pending approval",             description: "Awaiting sign-off — action required",                            group: "Immediate", filter: (b: Bill) => b.workflowStatus === "Pending Approval" },
  // AGING BUCKETS
  { id: "1-30",               name: "1–30 days overdue",            description: "First overdue bucket — escalate to approver",                    group: "Aging",     filter: (b: Bill) => { const d = daysOver(b.dueDate); return b.accountingStatus === "Unpaid" && d > 0 && d <= 30; } },
  { id: "31-60",              name: "31–60 days overdue",           description: "Second bucket — escalate to senior contact",                     group: "Aging",     filter: (b: Bill) => { const d = daysOver(b.dueDate); return b.accountingStatus === "Unpaid" && d > 30 && d <= 60; } },
  { id: "61-90",              name: "61–90 days overdue",           description: "Third bucket — final notice before dispute",                     group: "Aging",     filter: (b: Bill) => { const d = daysOver(b.dueDate); return b.accountingStatus === "Unpaid" && d > 60 && d <= 90; } },
  { id: "90-plus",            name: "90+ days overdue",             description: "Long overdue — contact supplier immediately",                    group: "Aging",     filter: (b: Bill) => b.accountingStatus === "Unpaid" && daysOver(b.dueDate) > 90 },
  // WORKFLOW
  { id: "needs-review",       name: "Needs review",                 description: "New bills requiring initial review before routing",              group: "Workflow",  filter: (b: Bill) => b.workflowStatus === "Pending Review" || b.workflowStatus === "Synced from Accounting" },
  { id: "on-hold",            name: "On hold",                      description: "Bills currently paused — review and unblock",                    group: "Workflow",  filter: (b: Bill) => b.workflowStatus === "On Hold" },
  { id: "rejected",           name: "Rejected",                     description: "Rejected by approver — review comments and resubmit",           group: "Workflow",  filter: (b: Bill) => b.workflowStatus === "Rejected" },
  { id: "ready-for-payment",  name: "Ready for payment",            description: "Approved and ready to be included in a payment run",            group: "Workflow",  filter: (b: Bill) => b.workflowStatus === "Ready for Payment" },
  // RISK
  { id: "large-bills",        name: "Large bills (>10k)",           description: "High-value bills requiring additional scrutiny",                 group: "Risk",      filter: (b: Bill) => b.accountingStatus === "Unpaid" && b.balance > 10000 },
  { id: "partial-paid",       name: "Partially paid",               description: "Payment made but balance still outstanding",                     group: "Risk",      filter: (b: Bill) => b.accountingStatus === "Partially Paid" },
  { id: "no-supplier",        name: "No supplier assigned",         description: "Bills missing supplier details — may indicate import errors",    group: "Risk",      filter: (b: Bill) => !b.supplierId || !b.supplierName },
];

const GROUP_LABELS: Record<string, string> = {
  Immediate: "IMMEDIATE ACTION",
  Aging:     "AGING BUCKETS",
  Workflow:  "WORKFLOW",
  Risk:      "RISK",
};

const WORKFLOW_COLOR: Record<string, string> = {
  "Pending Review":          "bg-stone-500/20 text-stone-300",
  "Pending Approval":        "bg-amber-500/20 text-amber-300",
  "Approved":                "bg-emerald-500/20 text-emerald-300",
  "On Hold":                 "bg-orange-500/20 text-orange-300",
  "Ready for Payment":       "bg-blue-500/20 text-blue-300",
  "Rejected":                "bg-rose-500/20 text-rose-300",
  "Scheduled":               "bg-violet-500/20 text-violet-300",
  "Synced from Accounting":  "bg-stone-500/20 text-stone-400",
};

export default function APSmartViewsPage() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(VIEWS[0].id);

  useEffect(() => {
    fetch("/api/payables/bills?limit=2000")
      .then(r => r.ok ? r.json() : { bills: [] })
      .then(d => setBills(Array.isArray(d) ? d : (d.bills ?? [])))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const view = VIEWS.find(v => v.id === selected)!;
  const results = useMemo(() => bills.filter(view.filter), [bills, view]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white tracking-tight">Smart Views</h1>
        <p className="text-sm text-stone-400 mt-1">Pre-built filters for common payables workflows</p>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Left: view list */}
        <div className="col-span-4">
          <div className="space-y-0.5">
            {(["Immediate", "Aging", "Workflow", "Risk"] as const).map(group => {
              const groupViews = VIEWS.filter(v => v.group === group);
              return (
                <div key={group} className="mb-3">
                  <div className={`px-2 mb-1 text-[10px] font-semibold tracking-widest ${group === "Workflow" ? "text-violet-400" : "text-stone-400"}`}>
                    {GROUP_LABELS[group]}
                  </div>
                  {groupViews.map(v => {
                    const count = loading ? 0 : bills.filter(v.filter).length;
                    const active = selected === v.id;
                    return (
                      <button key={v.id} onClick={() => setSelected(v.id)}
                        className={`w-full text-left px-3 py-2.5 rounded-md transition-colors ${active ? "bg-stone-800 border border-stone-700" : "hover:bg-stone-800/50"}`}>
                        <div className="flex items-center justify-between mb-0.5">
                          <div className="text-sm font-medium text-white">{v.name}</div>
                          <span className={`text-[11px] font-semibold tabular-nums ${count > 0 && group === "Workflow" ? "text-violet-400" : "text-stone-400"}`}>{count}</span>
                        </div>
                        <div className="text-[11px] text-stone-500">{v.description}</div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: results */}
        <div className="col-span-8">
          <Card padding="none">
            <div className="px-4 py-3 border-b border-stone-800">
              <div className="text-sm font-semibold text-white">{view.name}</div>
              <div className="text-[11px] text-stone-500 mt-0.5">{loading ? "Loading…" : `${results.length} bill${results.length !== 1 ? "s" : ""}`}</div>
            </div>
            {loading ? (
              <div className="py-12 text-center">
                <span className="inline-block w-5 h-5 border-2 border-stone-600 border-t-stone-300 rounded-full animate-spin" />
              </div>
            ) : results.length === 0 ? (
              <EmptyState icon={Filter} title="No matching bills" description="Nothing matches this filter right now." />
            ) : (
              <div>
                {results.slice(0, 50).map(bill => {
                  const overdue = daysOver(bill.dueDate);
                  const statusColor = WORKFLOW_COLOR[bill.workflowStatus] ?? "bg-stone-500/20 text-stone-300";
                  return (
                    <Link key={bill.id} href={`/payables/bills/${bill.id}`}
                      className="flex items-center gap-3 px-4 py-2.5 border-b border-stone-800 last:border-0 hover:bg-stone-800/50">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {bill.billNumber && <span className="text-[12px] font-mono text-stone-500">{bill.billNumber}</span>}
                          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${statusColor}`}>{bill.workflowStatus}</span>
                        </div>
                        <div className="text-sm font-medium text-white truncate mt-0.5">{bill.supplierName || "Unknown supplier"}</div>
                        {bill.dueDate && (
                          <div className={`text-[11px] mt-0.5 ${overdue > 0 ? "text-rose-400" : "text-stone-400"}`}>
                            {overdue > 0 ? `${overdue}d overdue` : `Due ${bill.dueDate}`}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold tabular-nums text-white">{fmt.money(bill.balance, bill.currency)}</div>
                        <div className="text-[11px] text-stone-500">{bill.accountingStatus}</div>
                      </div>
                      <ChevronRight size={14} className="text-stone-500" />
                    </Link>
                  );
                })}
                {results.length > 50 && (
                  <div className="px-4 py-3 text-center text-xs text-stone-400 bg-stone-800/40">
                    Showing first 50 of {results.length}
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
