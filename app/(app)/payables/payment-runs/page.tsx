"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  AlertCircle,
  Loader2,
  RefreshCw,
  Banknote,
  Search,
  X,
} from "lucide-react";
import { Badge, Card, Button, Input, Select, EmptyState } from "@/components/ui";
import { useDataTable, ColHeader, ActiveFiltersBar, type ColDef } from "@/components/data-table";
import { fmt, formatDate } from "@/lib/format";

// ── Types ─────────────────────────────────────────────────────────────────────

type RunStatus =
  | "Draft"
  | "Pending Approval"
  | "Approved"
  | "Scheduled"
  | "Posted"
  | "Cancelled";

interface PaymentRun {
  id: string;
  runNumber: string;
  currency: string;
  scheduledDate: string;
  billCount: number;
  totalAmount: number;
  status: RunStatus;
  createdByName: string;
  approvedByName?: string;
  createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusBadge(status: RunStatus): string {
  const map: Record<RunStatus, string> = {
    Draft: "neutral",
    "Pending Approval": "orange",
    Approved: "purple",
    Scheduled: "blue",
    Posted: "green",
    Cancelled: "red",
  };
  return map[status];
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-stone-800 rounded ${className}`} />;
}

function AmountStatCard({
  label, count, amount, currency, color,
}: {
  label: string; count: number; amount: number; currency: string; color: string;
}) {
  return (
    <div className="bg-stone-900 border border-stone-800 rounded-lg px-4 py-3 flex flex-col gap-1 min-w-[160px]">
      <span className={`text-xl font-bold tabular-nums ${color}`}>{count}</span>
      <span className="text-[11px] text-stone-400 font-medium">{label}</span>
      {amount > 0 && (
        <span className={`text-xs tabular-nums font-medium ${color} opacity-70`}>
          {fmt.money(amount, currency)}
        </span>
      )}
    </div>
  );
}

// ── Column definitions ─────────────────────────────────────────────────────────

const RUN_COLS: ColDef[] = [
  { key: "runNumber",      label: "Run #",         sortValue: (r) => r.runNumber },
  { key: "currency",       label: "Currency",       sortValue: (r) => r.currency ?? "", filterLabel: (r) => r.currency ?? "" },
  { key: "scheduledDate",  label: "Scheduled Date", sortValue: (r) => r.scheduledDate ?? "", noFilter: true },
  { key: "billCount",      label: "Bills",          sortValue: (r) => r.billCount ?? 0, align: "right" as const, noFilter: true },
  { key: "totalAmount",    label: "Total Amount",   sortValue: (r) => r.totalAmount ?? 0, align: "right" as const, noFilter: true },
  { key: "status",         label: "Status",         sortValue: (r) => r.status ?? "", filterLabel: (r) => r.status ?? "" },
  { key: "createdByName",  label: "Created By",     sortValue: (r) => r.createdByName ?? "", filterLabel: (r) => r.createdByName ?? "" },
  { key: "approvedByName", label: "Approved By",    sortValue: (r) => r.approvedByName ?? "", filterLabel: (r) => r.approvedByName ?? "—" },
  { key: "createdAt",      label: "Created",        sortValue: (r) => r.createdAt ?? "", noFilter: true },
];

const STATUS_OPTIONS: RunStatus[] = ["Draft", "Pending Approval", "Approved", "Scheduled", "Posted", "Cancelled"];

type PeriodId = "this-month" | "last-month" | "last-3m" | "last-6m" | "all" | "custom";
const PERIODS: { id: PeriodId; label: string }[] = [
  { id: "this-month", label: "This Month" },
  { id: "last-month", label: "Last Month" },
  { id: "last-3m",    label: "Last 3M" },
  { id: "last-6m",    label: "Last 6M" },
  { id: "all",        label: "All Time" },
  { id: "custom",     label: "Custom" },
];
function getPeriodRange(id: PeriodId): { from: Date; to: Date } {
  const now = new Date();
  if (id === "this-month") return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 0) };
  if (id === "last-month") return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 0) };
  if (id === "last-3m")    return { from: new Date(now.getFullYear(), now.getMonth() - 3, 1), to: now };
  if (id === "last-6m")    return { from: new Date(now.getFullYear(), now.getMonth() - 6, 1), to: now };
  return { from: new Date(2000, 0, 1), to: now };
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PaymentRunsPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<PaymentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const todayStr = new Date().toISOString().slice(0, 10);
  const lastMonthStart = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); })();
  const [period, setPeriod] = useState<PeriodId>("all");
  const [customFrom, setCustomFrom] = useState(lastMonthStart);
  const [customTo, setCustomTo]   = useState(todayStr);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/payables/payment-runs");
      if (!res.ok) throw new Error("Failed to load payment runs");
      const data = await res.json();
      setRuns(Array.isArray(data) ? data : data.runs ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleNewRun() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/payables/payment-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No currency here — the API resolves the org's own home currency.
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Failed to create payment run");
      const data = await res.json();
      const id = data.id ?? data.run?.id;
      if (id) {
        router.push(`/payables/payment-runs/${id}`);
      } else {
        await load();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  const { from: periodFrom, to: periodTo } = useMemo(() => {
    if (period === "custom") return { from: new Date(customFrom + "T00:00:00"), to: new Date(customTo + "T23:59:59") };
    if (period === "all") return { from: new Date(2000, 0, 1), to: new Date(9999, 11, 31) };
    return getPeriodRange(period);
  }, [period, customFrom, customTo]);

  const baseFiltered = useMemo(() => {
    let rows = runs;

    rows = rows.filter((r) => {
      if (!r.scheduledDate) return true;
      const d = new Date(r.scheduledDate + "T00:00:00");
      return d >= periodFrom && d <= periodTo;
    });

    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.runNumber.toLowerCase().includes(s) ||
          r.createdByName.toLowerCase().includes(s)
      );
    }
    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
    return rows;
  }, [runs, search, statusFilter, periodFrom, periodTo]);

  const dt = useDataTable(baseFiltered, RUN_COLS, { defaultSort: "createdAt", defaultDir: "desc" });

  const stats = useMemo(() => {
    const defaultCurrency = runs[0]?.currency ?? "USD";
    return {
      draft:           { count: runs.filter((r) => r.status === "Draft").length,            amount: runs.filter((r) => r.status === "Draft").reduce((s, r) => s + r.totalAmount, 0) },
      pendingApproval: { count: runs.filter((r) => r.status === "Pending Approval").length,  amount: runs.filter((r) => r.status === "Pending Approval").reduce((s, r) => s + r.totalAmount, 0) },
      approved:        { count: runs.filter((r) => r.status === "Approved").length,          amount: runs.filter((r) => r.status === "Approved").reduce((s, r) => s + r.totalAmount, 0) },
      posted:          { count: runs.filter((r) => r.status === "Posted").length,            amount: runs.filter((r) => r.status === "Posted").reduce((s, r) => s + r.totalAmount, 0) },
      currency: defaultCurrency,
    };
  }, [runs]);

  return (
    <div className="p-6 max-w-[1300px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Payment Runs</h1>
          <p className="text-sm text-stone-500 mt-1">
            {loading ? "Loading…" : `${dt.rows.length} run${dt.rows.length !== 1 ? "s" : ""}`}
            <span className="text-stone-400"> · {PERIODS.find((p) => p.id === period)?.label ?? "Custom"}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-stone-800 hover:bg-stone-700 text-stone-200 ring-1 ring-stone-700 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refresh
          </button>
          <button
            onClick={handleNewRun}
            disabled={creating}
            className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={15} />}
            New Payment Run
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <AmountStatCard label="Draft"            count={stats.draft.count}           amount={stats.draft.amount}           currency={stats.currency} color="text-stone-300" />
        <AmountStatCard label="Pending Approval" count={stats.pendingApproval.count} amount={stats.pendingApproval.amount} currency={stats.currency} color="text-orange-400" />
        <AmountStatCard label="Approved"         count={stats.approved.count}        amount={stats.approved.amount}        currency={stats.currency} color="text-violet-400" />
        <AmountStatCard label="Posted"           count={stats.posted.count}          amount={stats.posted.amount}          currency={stats.currency} color="text-emerald-400" />
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-sm">
          <AlertCircle size={14} /> {error}
          <button onClick={load} className="ml-auto text-rose-300 hover:text-white underline text-xs">Retry</button>
        </div>
      )}

      <Card padding="none">
        {/* Period tabs */}
        <div className="flex items-center gap-0 border-b border-stone-800 px-3 pt-1">
          {PERIODS.map((p) => (
            <button key={p.id} onClick={() => setPeriod(p.id)}
              className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
                period === p.id ? "border-violet-500 text-violet-400" : "border-transparent text-stone-500 hover:text-stone-300"
              }`}>{p.label}</button>
          ))}
          {period === "custom" && (
            <div className="ml-3 flex items-center gap-2">
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                className="h-7 px-2 text-xs rounded border border-stone-700 bg-stone-800 text-stone-300 focus:border-violet-500 focus:outline-none" />
              <span className="text-stone-600 text-xs">→</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                className="h-7 px-2 text-xs rounded border border-stone-700 bg-stone-800 text-stone-300 focus:border-violet-500 focus:outline-none" />
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="px-3 py-2.5 border-b border-stone-800 flex items-center gap-2 flex-wrap">
          <Input
            value={search}
            onChange={(e: any) => setSearch(e.target.value)}
            placeholder="Search run # or creator…"
            icon={Search}
            className="w-64"
          />
          <Select
            value={statusFilter}
            onChange={(e: any) => setStatusFilter(e.target.value)}
            placeholder="All statuses"
            options={STATUS_OPTIONS}
          />
          {(search || statusFilter) && (
            <Button variant="ghost" size="sm" icon={X} onClick={() => { setSearch(""); setStatusFilter(""); }}>
              Clear
            </Button>
          )}
        </div>

        <ActiveFiltersBar dt={dt} cols={RUN_COLS} />

        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-5 space-y-2">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : dt.rows.length === 0 ? (
            <EmptyState
              icon={Banknote}
              title="No payment runs"
              description={runs.length === 0 ? "Create a payment run to batch bill payments." : "Try adjusting your filters."}
              action={
                runs.length === 0 ? (
                  <button
                    onClick={handleNewRun}
                    disabled={creating}
                    className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50"
                  >
                    <Plus size={14} />
                    New Payment Run
                  </button>
                ) : undefined
              }
            />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-800 bg-stone-900/60">
                  <th className="px-4 py-2.5 w-10">
                    <input type="checkbox"
                      checked={dt.rows.length > 0 && dt.rows.every((r) => selected.has(r.id))}
                      onChange={() => { const all = dt.rows.every((r) => selected.has(r.id)); setSelected(all ? new Set() : new Set(dt.rows.map((r) => r.id))); }}
                      className="rounded border-stone-600 text-violet-500 focus:ring-violet-500" />
                  </th>
                  {RUN_COLS.map((col) => (
                    <ColHeader key={col.key} col={col} dt={dt} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {dt.rows.map((run) => (
                  <tr
                    key={run.id}
                    onClick={() => router.push(`/payables/payment-runs/${run.id}`)}
                    className={`border-b border-stone-800 cursor-pointer transition-colors ${selected.has(run.id) ? "bg-violet-500/10" : "hover:bg-stone-800/50"}`}
                  >
                    <td className="px-4 py-3" onClick={(e) => { e.stopPropagation(); setSelected((prev) => { const n = new Set(prev); n.has(run.id) ? n.delete(run.id) : n.add(run.id); return n; }); }}>
                      <input type="checkbox" checked={selected.has(run.id)} onChange={() => {}}
                        className="rounded border-stone-600 text-violet-500 focus:ring-violet-500" />
                    </td>
                    <td className="px-3 py-3 font-mono text-[12px] text-violet-400">{run.runNumber}</td>
                    <td className="px-3 py-3 text-stone-300 font-medium">{run.currency}</td>
                    <td className="px-3 py-3 text-stone-400 text-[13px] whitespace-nowrap">{formatDate(run.scheduledDate)}</td>
                    <td className="px-3 py-3 text-right text-stone-300 tabular-nums">{run.billCount}</td>
                    <td className="px-3 py-3 text-right font-semibold text-white tabular-nums text-[13px]">
                      {fmt.money(run.totalAmount, run.currency)}
                    </td>
                    <td className="px-3 py-3"><Badge variant={statusBadge(run.status)}>{run.status}</Badge></td>
                    <td className="px-3 py-3 text-stone-400 text-[13px]">{run.createdByName}</td>
                    <td className="px-3 py-3 text-stone-400 text-[13px]">
                      {run.approvedByName ?? <span className="text-stone-600 italic">—</span>}
                    </td>
                    <td className="px-3 py-3 text-stone-400 text-[13px] whitespace-nowrap">{formatDate(run.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}
