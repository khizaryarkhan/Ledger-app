"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Card, Badge, Input, EmptyState } from "@/components/ui";
import { fmt, formatDate } from "@/lib/format";
import { Search, ClipboardList } from "lucide-react";

type Estimate = {
  estimate: {
    id: string;
    estimateNumber: string;
    estimateDate: string;
    expiryDate: string | null;
    currency: string;
    amount: number;
    taxAmount: number;
    total: number;
    status: string;
    billingEmail: string | null;
    notes: string | null;
    lineItems: any[];
    qboId: string | null;
    source: string;
  };
  customerName: string | null;
  projectName: string | null;
};

const STATUS_COLORS: Record<string, "default" | "success" | "warning" | "error" | "info"> = {
  Pending:  "warning",
  Accepted: "success",
  Closed:   "default",
  Rejected: "error",
};

export default function EstimatesPage() {
  const [rows, setRows] = useState<Estimate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch("/api/estimates")
      .then(r => r.ok ? r.json() : [])
      .then(setRows)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter(r => {
      if (statusFilter && r.estimate.status !== statusFilter) return false;
      if (q) {
        const hay = [
          r.estimate.estimateNumber,
          r.customerName,
          r.projectName,
          r.estimate.billingEmail,
        ].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, statusFilter]);

  const statuses = useMemo(() => Array.from(new Set(rows.map(r => r.estimate.status))).sort(), [rows]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Estimates</h1>
          <p className="text-sm text-stone-400 mt-0.5">Quotes and proposals synced from QuickBooks</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
          <Input
            placeholder="Search estimates…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 w-60"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="h-9 px-3 pr-8 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none w-40"
        >
          <option value="">All statuses</option>
          {statuses.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Summary strip */}
      {!loading && rows.length > 0 && (
        <div className="flex gap-4 text-sm text-stone-400">
          <span>{filtered.length} estimate{filtered.length !== 1 ? "s" : ""}</span>
          <span>
            Total: <span className="text-stone-100 font-medium">
              {fmt.money(filtered.reduce((s, r) => s + r.estimate.total, 0), filtered[0]?.estimate.currency ?? "GBP")}
            </span>
          </span>
        </div>
      )}

      {/* Table */}
      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="p-8 text-center text-stone-400 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No estimates found"
            description={rows.length === 0 ? "Run a full QBO sync to import estimates." : "Try adjusting your filters."}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-700 text-stone-400 text-xs uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Estimate #</th>
                <th className="px-4 py-3 text-left">Customer</th>
                <th className="px-4 py-3 text-left">Project</th>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Expiry</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const est = r.estimate;
                const isExp = expanded === est.id;
                return (
                  <React.Fragment key={est.id}>
                    <tr
                      onClick={() => setExpanded(isExp ? null : est.id)}
                      className="border-b border-stone-800 hover:bg-stone-800/40 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-stone-100">{est.estimateNumber}</td>
                      <td className="px-4 py-3 text-stone-300">{r.customerName || "—"}</td>
                      <td className="px-4 py-3 text-stone-400">{r.projectName || "—"}</td>
                      <td className="px-4 py-3 text-stone-400">{formatDate(est.estimateDate)}</td>
                      <td className="px-4 py-3 text-stone-400">{est.expiryDate ? formatDate(est.expiryDate) : "—"}</td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_COLORS[est.status] ?? "default"}>{est.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-stone-100">{fmt.money(est.total, est.currency)}</td>
                    </tr>
                    {isExp && est.lineItems?.length > 0 && (
                      <tr className="bg-stone-900 border-b border-stone-800">
                        <td colSpan={7} className="px-8 py-3">
                          <table className="w-full text-xs text-stone-400">
                            <thead>
                              <tr className="border-b border-stone-700">
                                <th className="pb-1.5 text-left">Description</th>
                                <th className="pb-1.5 text-right">Qty</th>
                                <th className="pb-1.5 text-right">Unit Price</th>
                                <th className="pb-1.5 text-right">Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {est.lineItems.map((li: any, i: number) => (
                                <tr key={i} className="border-b border-stone-800/50">
                                  <td className="py-1">{li.description || "—"}</td>
                                  <td className="py-1 text-right">{li.qty}</td>
                                  <td className="py-1 text-right">{fmt.money(li.unitPrice, est.currency)}</td>
                                  <td className="py-1 text-right">{fmt.money(li.amount, est.currency)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {est.notes && (
                            <p className="mt-2 text-stone-400 text-xs italic">Note: {est.notes}</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
