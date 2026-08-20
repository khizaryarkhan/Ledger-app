"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Card, Badge, Input, Select, Button, EmptyState } from "@/components/ui";
import { useDataTable, ColHeader, ActiveFiltersBar, type ColDef } from "@/components/data-table";
import { fmt, formatDate, sourceLabel, sourceBadgeVariant } from "@/lib/format";
import { Search, Receipt, X, CalendarDays, AlertCircle } from "lucide-react";

const WORKFLOW_STATUSES = [
  "Pending Review",
  "Pending Approval",
  "Approved",
  "On Hold",
  "Ready for Payment",
  "Rejected",
];

// ── Date period helpers ────────────────────────────────────────────────────────
type PeriodId = "this-month" | "last-month" | "last-3m" | "last-6m" | "all" | "custom";

const PERIODS: { id: PeriodId; label: string }[] = [
  { id: "this-month", label: "This Month" },
  { id: "last-month", label: "Last Month" },
  { id: "last-3m",    label: "Last 3M"    },
  { id: "last-6m",    label: "Last 6M"    },
  { id: "all",        label: "All Time"   },
  { id: "custom",     label: "Custom"     },
];

function getPeriodRange(id: PeriodId): { from: Date; to: Date } {
  const now = new Date();
  if (id === "this-month")
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 0) };
  if (id === "last-month")
    return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 0) };
  if (id === "last-3m")
    return { from: new Date(now.getFullYear(), now.getMonth() - 3, 1), to: now };
  if (id === "last-6m")
    return { from: new Date(now.getFullYear(), now.getMonth() - 6, 1), to: now };
  return { from: new Date(2000, 0, 1), to: now };
}

// ── Types ─────────────────────────────────────────────────────────────────────
type AccountingStatus = "Unpaid" | "Partially Paid" | "Paid" | "Voided";
type WorkflowStatus =
  | "Synced from Accounting"
  | "Pending Review"
  | "Pending Approval"
  | "Approved"
  | "On Hold"
  | "Ready for Payment"
  | "Rejected"
  | "Scheduled"
  | "Paid";

interface Bill {
  id: string;
  billNumber: string | null;
  supplierId: string | null;
  supplierName: string | null;
  billDate: string | null;
  dueDate: string | null;
  currency: string;
  total: number;
  amountPaid: number;
  balance: number;
  accountingStatus: AccountingStatus;
  workflowStatus: WorkflowStatus;
  qboId: string | null;
  xeroId: string | null;
  createdAt: string;
}

// ── Badge helpers ─────────────────────────────────────────────────────────────
function accountingBadge(s: AccountingStatus): string {
  const m: Record<AccountingStatus, string> = {
    "Unpaid":         "yellow",
    "Partially Paid": "blue",
    "Paid":           "green",
    "Voided":         "neutral",
  };
  return m[s] ?? "neutral";
}

function workflowBadge(s: WorkflowStatus): string {
  const m: Record<WorkflowStatus, string> = {
    "Synced from Accounting": "neutral",
    "Pending Review":         "yellow",
    "Pending Approval":       "orange",
    "Approved":               "green",
    "On Hold":                "orange",
    "Ready for Payment":      "purple",
    "Rejected":               "red",
    "Scheduled":              "blue",
    "Paid":                   "green",
  };
  return m[s] ?? "neutral";
}

function isOverdue(bill: Bill): boolean {
  if (!bill.dueDate) return false;
  if (bill.balance <= 0) return false;
  if (bill.accountingStatus === "Paid" || bill.accountingStatus === "Voided") return false;
  if (bill.workflowStatus === "Paid" || bill.workflowStatus === "Approved" || bill.workflowStatus === "Ready for Payment") return false;
  return new Date(bill.dueDate + "T00:00:00") < new Date();
}

function daysOverdue(bill: Bill): number {
  if (!isOverdue(bill)) return 0;
  const diff = new Date().getTime() - new Date(bill.dueDate! + "T00:00:00").getTime();
  return Math.floor(diff / 86_400_000);
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function BillsPage() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [workflowFilter, setWorkflowFilter] = useState("");
  const [accountingFilter, setAccountingFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkChanging, setBulkChanging] = useState(false);

  const todayStr = new Date().toISOString().slice(0, 10);
  const lastMonthStart = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); })();
  const [period, setPeriod] = useState<PeriodId>("all");
  const [customFrom, setCustomFrom] = useState(lastMonthStart);
  const [customTo, setCustomTo] = useState(todayStr);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/payables/bills");
      if (!res.ok) throw new Error("Failed to load bills");
      const data = await res.json();
      setBills(Array.isArray(data) ? data : data.bills ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleBulkStatusChange(status: string) {
    if (!status || selected.size === 0) return;
    setBulkChanging(true);
    try {
      await Promise.all(
        Array.from(selected).map((id) =>
          fetch(`/api/payables/bills/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workflowStatus: status }),
          })
        )
      );
      await load();
      setSelected(new Set());
    } catch (err: any) {
      setError(err.message || "Failed to update bills");
    } finally {
      setBulkChanging(false);
    }
  }

  useEffect(() => { load(); }, []);

  const { from: periodFrom, to: periodTo } = useMemo(() => {
    if (period === "custom")
      return { from: new Date(customFrom + "T00:00:00"), to: new Date(customTo + "T23:59:59") };
    if (period === "all")
      return { from: new Date(2000, 0, 1), to: new Date(9999, 11, 31) };
    return getPeriodRange(period);
  }, [period, customFrom, customTo]);

  const enriched = useMemo(() => bills.map(b => ({
    ...b,
    overdue: isOverdue(b),
    daysOvr: daysOverdue(b),
  })), [bills]);

  const filtered = useMemo(() => {
    let rows = enriched;

    // Date filter on billDate
    rows = rows.filter(b => {
      if (!b.billDate) return true;
      const d = new Date(b.billDate + "T00:00:00");
      return d >= periodFrom && d <= periodTo;
    });

    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(b =>
        (b.billNumber || "").toLowerCase().includes(s) ||
        (b.supplierName || "").toLowerCase().includes(s)
      );
    }
    if (workflowFilter)   rows = rows.filter(b => b.workflowStatus === workflowFilter);
    if (accountingFilter) rows = rows.filter(b => b.accountingStatus === accountingFilter);

    return rows;
  }, [enriched, periodFrom, periodTo, search, workflowFilter, accountingFilter]);

  const BILL_COLS: ColDef[] = [
    { key: "billNumber",   label: "Bill #",      sortValue: r => r.billNumber ?? "", filterLabel: r => r.billNumber ?? "" },
    { key: "supplier",     label: "Supplier",    sortValue: r => r.supplierName ?? "", filterLabel: r => r.supplierName ?? "(Unknown)" },
    { key: "billDate",     label: "Bill Date",   sortValue: r => r.billDate ?? "" },
    { key: "dueDate",      label: "Due Date",    sortValue: r => r.dueDate ?? "" },
    { key: "accounting",   label: "Accounting",  sortValue: r => r.accountingStatus ?? "", filterLabel: r => r.accountingStatus ?? "" },
    { key: "workflow",     label: "Workflow",    sortValue: r => r.workflowStatus ?? "", filterLabel: r => r.workflowStatus ?? "" },
    { key: "total",        label: "Total",       sortValue: r => r.total ?? 0, align: "right" as const, noFilter: true },
    { key: "balance",      label: "Balance",     sortValue: r => r.balance ?? 0, align: "right" as const, noFilter: true },
  ];
  const dt = useDataTable(filtered, BILL_COLS);

  const allSelected = filtered.length > 0 && filtered.every(b => selected.has(b.id));
  const someSelected = selected.size > 0;
  const toggleAll = () => allSelected ? setSelected(new Set()) : setSelected(new Set(filtered.map(b => b.id)));
  const toggleOne = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Bills</h1>
          <p className="text-sm text-stone-500 mt-1">
            {dt.rows.length} bill{dt.rows.length !== 1 ? "s" : ""}
            <span className="text-stone-400"> · {PERIODS.find(p => p.id === period)?.label ?? "Custom"}</span>
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-sm">
          <AlertCircle size={14} />
          {error}
          <button onClick={load} className="ml-auto text-rose-300 hover:text-white underline text-xs">Retry</button>
        </div>
      )}

      {/* Bulk action bar */}
      {someSelected && (
        <div className="mb-3 flex items-center gap-3 px-4 py-2.5 bg-stone-900 text-white rounded-lg flex-wrap">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="flex-1" />
          <select
            value=""
            disabled={bulkChanging}
            onChange={(e) => { const s = e.target.value; e.target.value = ""; handleBulkStatusChange(s); }}
            className="bg-stone-700 text-white text-xs rounded-md px-2.5 py-1.5 border-0 focus:outline-none focus:ring-2 focus:ring-stone-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="" disabled>{bulkChanging ? "Updating…" : "Change status…"}</option>
            {WORKFLOW_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={() => setSelected(new Set())} className="text-stone-400 hover:text-white p-1 rounded">
            <X size={14} />
          </button>
        </div>
      )}

      <Card padding="none">
        {/* ── Date period picker ── */}
        <div className="px-3 py-2.5 border-b border-stone-800 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-[11px] text-stone-400 font-medium shrink-0">
            <CalendarDays size={13} />
            Bill date
          </div>
          <div className="flex items-center gap-0.5 bg-stone-800 p-0.5 rounded-lg">
            {PERIODS.map(p => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  period === p.id ? "bg-stone-700 text-white shadow-sm" : "text-stone-400 hover:text-stone-200"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {period === "custom" && (
            <div className="flex items-center gap-1.5 bg-stone-800 border border-stone-700 rounded-lg px-3 py-1.5">
              <span className="text-[11px] text-stone-400 font-medium">From</span>
              <input type="date" value={customFrom} max={customTo}
                onChange={e => setCustomFrom(e.target.value)}
                className="text-xs text-stone-300 border-none outline-none bg-transparent cursor-pointer" />
              <span className="text-[11px] text-stone-400 font-medium ml-1">To</span>
              <input type="date" value={customTo} min={customFrom} max={todayStr}
                onChange={e => setCustomTo(e.target.value)}
                className="text-xs text-stone-300 border-none outline-none bg-transparent cursor-pointer" />
            </div>
          )}
        </div>

        {/* ── Search + filters ── */}
        <div className="p-3 border-b border-stone-800 flex items-center gap-2 flex-wrap">
          <Input value={search} onChange={(e: any) => setSearch(e.target.value)}
            placeholder="Search bill #, supplier…" icon={Search} className="w-72" />
          <Select value={workflowFilter} onChange={(e: any) => setWorkflowFilter(e.target.value)}
            placeholder="All workflow statuses"
            options={["Synced from Accounting","Pending Review","Pending Approval","Approved","On Hold","Ready for Payment","Rejected","Scheduled","Paid"]} />
          <Select value={accountingFilter} onChange={(e: any) => setAccountingFilter(e.target.value)}
            placeholder="All accounting statuses"
            options={["Unpaid","Partially Paid","Paid","Voided"]} />
          {(search || workflowFilter || accountingFilter) && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setWorkflowFilter(""); setAccountingFilter(""); }}>Clear</Button>
          )}
        </div>
        <ActiveFiltersBar dt={dt} cols={BILL_COLS} />

        {/* ── Table ── */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-5 space-y-2">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-10 bg-stone-800 rounded animate-pulse" />
              ))}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-800 bg-stone-900/60">
                  <th className="px-3 py-2.5 w-10">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll}
                      className="rounded border-stone-300 cursor-pointer" />
                  </th>
                  {BILL_COLS.map(col => (
                    <ColHeader key={col.key} col={col} dt={dt}
                      className={col.align === "right" ? "text-right" : "text-left"} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {dt.rows.map((bill: any) => (
                  <tr key={bill.id}
                    className={`border-b border-stone-800 hover:bg-stone-800/50 ${selected.has(bill.id) ? "bg-violet-500/10" : ""}`}>
                    <td className="px-3 py-2.5 w-10">
                      <input type="checkbox" checked={selected.has(bill.id)} onChange={() => toggleOne(bill.id)}
                        className="rounded border-stone-300 cursor-pointer" onClick={e => e.stopPropagation()} />
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[12px]">
                      <Link href={`/payables/bills/${bill.id}`} className="flex items-center gap-1.5 text-violet-400 hover:text-violet-300">
                        <span>{bill.billNumber || <span className="text-stone-600 italic">No #</span>}</span>
                        <Badge variant={sourceBadgeVariant(bill.source)} size="sm">{sourceLabel(bill.source)}</Badge>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 font-medium text-white">
                      <Link href={`/payables/bills/${bill.id}`} className="block w-full truncate max-w-[180px]">
                        {bill.supplierName || <span className="text-stone-500 italic">Unknown</span>}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-stone-400 text-[12px] whitespace-nowrap">
                      <Link href={`/payables/bills/${bill.id}`} className="block w-full">
                        {bill.billDate ? formatDate(bill.billDate, "DD MMM YYYY") : "—"}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-[12px] whitespace-nowrap">
                      <Link href={`/payables/bills/${bill.id}`} className="block w-full">
                        <span className={bill.overdue ? "text-rose-400 font-medium" : "text-stone-300"}>
                          {bill.dueDate ? formatDate(bill.dueDate, "DD MMM YYYY") : "—"}
                        </span>
                        {bill.overdue && bill.daysOvr > 0 && (
                          <span className="ml-1 text-[11px] text-rose-600 font-medium">+{bill.daysOvr}d</span>
                        )}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <Link href={`/payables/bills/${bill.id}`}>
                        <Badge variant={accountingBadge(bill.accountingStatus)}>{bill.accountingStatus}</Badge>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <Link href={`/payables/bills/${bill.id}`}>
                        <Badge variant={workflowBadge(bill.workflowStatus)}>{bill.workflowStatus}</Badge>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right text-stone-400 tabular-nums text-[13px]">
                      <Link href={`/payables/bills/${bill.id}`} className="block w-full">
                        {fmt.money(bill.total, bill.currency)}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-white tabular-nums text-[13px]">
                      <Link href={`/payables/bills/${bill.id}`} className="block w-full">
                        {fmt.money(bill.balance, bill.currency)}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!loading && filtered.length === 0 && (
            <EmptyState icon={Receipt} title="No bills found"
              description={bills.length === 0
                ? "Use the Sync button in the top bar (or Settings → Integrations) to import bills."
                : "Try adjusting your filters."} />
          )}
        </div>
      </Card>
    </div>
  );
}
