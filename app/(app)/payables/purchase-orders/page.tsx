"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Plus,
  ShoppingCart,
  AlertCircle,
  X,
  CloudUpload,
  Loader2,
} from "lucide-react";
import { Card, Badge, Button, Input, Select, Modal, EmptyState } from "@/components/ui";
import { useDataTable, ColHeader, ActiveFiltersBar, type ColDef } from "@/components/data-table";
import { fmt, formatDate } from "@/lib/format";

// ── Types ─────────────────────────────────────────────────────────────────────

type POStatus = "Draft" | "Pending Approval" | "Approved" | "Cancelled" | "Closed";
type POApprovalStatus = "Not Required" | "Pending" | "Approved" | "Rejected";
type POPushStatus = "Not Pushed" | "Pending" | "Pushed" | "Failed";
type PeriodId = "this-month" | "last-month" | "last-3m" | "last-6m" | "all" | "custom";

interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierName: string;
  supplierId: string;
  poDate: string;
  total: number;
  currency: string;
  status: POStatus;
  approvalStatus: POApprovalStatus;
  pushStatus: POPushStatus;
  createdAt: string;
}

interface Supplier {
  id: string;
  name: string;
  currency?: string | null;
}

// ── Period helpers ─────────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function poStatusBadge(status: POStatus): string {
  const map: Record<POStatus, string> = {
    Draft: "neutral",
    "Pending Approval": "orange",
    Approved: "green",
    Cancelled: "neutral",
    Closed: "neutral",
  };
  return map[status] ?? "neutral";
}

function approvalStatusBadge(status: POApprovalStatus): string {
  const map: Record<POApprovalStatus, string> = {
    "Not Required": "neutral",
    Pending: "yellow",
    Approved: "green",
    Rejected: "red",
  };
  return map[status] ?? "neutral";
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-stone-800 rounded ${className}`} />;
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-stone-900 border border-stone-800 rounded-lg px-4 py-3 flex flex-col gap-1 min-w-[120px]">
      <span className={`text-xl font-bold tabular-nums ${color}`}>{value}</span>
      <span className="text-[11px] text-stone-400 font-medium">{label}</span>
    </div>
  );
}

function PushStatusIcon({ status }: { status: POPushStatus }) {
  if (status === "Pushed")
    return <span title="Pushed to accounting"><CloudUpload size={15} className="text-violet-400" /></span>;
  if (status === "Pending")
    return <span title="Push pending"><CloudUpload size={15} className="text-amber-400 animate-pulse" /></span>;
  if (status === "Failed")
    return <span title="Push failed"><CloudUpload size={15} className="text-rose-400" /></span>;
  return <span title="Not pushed"><CloudUpload size={15} className="text-stone-600" style={{ strokeDasharray: "4 2" }} /></span>;
}

// ── Create PO Modal ───────────────────────────────────────────────────────────

const EMPTY_PO_FORM = {
  supplierId: "",
  supplierSearch: "",
  poDate: new Date().toISOString().slice(0, 10),
  currency: "",
  notes: "",
};

const CURRENCIES = ["USD", "EUR", "GBP", "AUD", "CAD", "NZD", "SGD", "HKD", "JPY", "ZAR"];

function CreatePOModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState(EMPTY_PO_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierResults, setSupplierResults] = useState<Supplier[]>([]);
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);
  const [orgCurrency, setOrgCurrency] = useState("USD");

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY_PO_FORM);
    setError(null);
    fetch("/api/payables/suppliers")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setSuppliers(Array.isArray(data) ? data : data.suppliers ?? []))
      .catch(() => {});
    // Default to the org's own currency, never a hardcoded literal — a
    // supplier picked below overrides this with its own currency if set.
    fetch("/api/org/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((o) => { if (o?.currency) { setOrgCurrency(o.currency); setForm((prev) => ({ ...prev, currency: prev.currency || o.currency })); } })
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!form.supplierSearch.trim()) { setSupplierResults([]); return; }
    const q = form.supplierSearch.toLowerCase();
    setSupplierResults(suppliers.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 8));
  }, [form.supplierSearch, suppliers]);

  async function handleSubmit() {
    if (!form.supplierId) { setError("Please select a supplier."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/payables/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: form.supplierId,
          poDate: form.poDate,
          currency: form.currency,
          notes: form.notes || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to create purchase order");
      }
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Purchase Order"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 size={13} className="animate-spin" />}
            Create PO
          </Button>
        </>
      }
    >
      <div className="p-5 space-y-4">
        {error && (
          <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-sm">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {/* Supplier combobox */}
        <div className="relative">
          <label className="block text-xs font-medium text-stone-400 mb-1.5">
            Supplier <span className="text-rose-400">*</span>
          </label>
          <Input
            value={form.supplierSearch}
            onChange={(e: any) => {
              setForm((prev) => ({ ...prev, supplierSearch: e.target.value, supplierId: "" }));
              setShowSupplierDropdown(true);
            }}
            onFocus={() => setShowSupplierDropdown(true)}
            placeholder="Search suppliers…"
            icon={Search}
            className="w-full"
          />
          {showSupplierDropdown && supplierResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-stone-800 border border-stone-700 rounded-lg shadow-lg overflow-hidden">
              {supplierResults.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setForm((prev) => ({ ...prev, supplierId: s.id, supplierSearch: s.name, currency: s.currency || orgCurrency }));
                    setShowSupplierDropdown(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-stone-200 hover:bg-stone-700 transition-colors"
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1.5">PO Date</label>
            <input
              type="date"
              value={form.poDate}
              onChange={(e) => setForm((prev) => ({ ...prev, poDate: e.target.value }))}
              className="w-full h-9 px-3 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-200 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1.5">Currency</label>
            <Select
              value={form.currency}
              onChange={(e: any) => setForm((prev) => ({ ...prev, currency: e.target.value }))}
              options={CURRENCIES}
              className="w-full"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-stone-400 mb-1.5">Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
            rows={2}
            className="w-full px-3 py-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none resize-none"
          />
        </div>
      </div>
    </Modal>
  );
}

// ── Column definitions ─────────────────────────────────────────────────────────

const PO_COLS: ColDef[] = [
  { key: "poNumber",      label: "PO #",      sortValue: (r) => r.poNumber },
  { key: "supplierName",  label: "Supplier",   sortValue: (r) => r.supplierName ?? "", filterLabel: (r) => r.supplierName ?? "—" },
  { key: "poDate",        label: "PO Date",    sortValue: (r) => r.poDate ?? "" },
  { key: "total",         label: "Total",      sortValue: (r) => r.total ?? 0, align: "right" as const, noFilter: true },
  { key: "status",        label: "Status",     sortValue: (r) => r.status ?? "", filterLabel: (r) => r.status ?? "" },
  { key: "approvalStatus",label: "Approval",   sortValue: (r) => r.approvalStatus ?? "", filterLabel: (r) => r.approvalStatus ?? "" },
  { key: "pushStatus",    label: "Push",       sortValue: (r) => r.pushStatus ?? "", filterLabel: (r) => r.pushStatus ?? "", align: "center" as const },
  { key: "createdAt",     label: "Created",    sortValue: (r) => r.createdAt ?? "", noFilter: true },
];

// ── Main Page ─────────────────────────────────────────────────────────────────

const STATUS_OPTIONS: POStatus[] = ["Draft", "Pending Approval", "Approved", "Cancelled", "Closed"];

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
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
      const [poRes, supRes] = await Promise.all([
        fetch("/api/payables/purchase-orders"),
        fetch("/api/payables/suppliers"),
      ]);
      if (!poRes.ok) throw new Error("Failed to load purchase orders");
      const poData = await poRes.json();
      setOrders(Array.isArray(poData) ? poData : poData.purchaseOrders ?? []);
      if (supRes.ok) {
        const supData = await supRes.json();
        setSuppliers(Array.isArray(supData) ? supData : supData.suppliers ?? []);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const { from: periodFrom, to: periodTo } = useMemo(() => {
    if (period === "custom") return { from: new Date(customFrom + "T00:00:00"), to: new Date(customTo + "T23:59:59") };
    if (period === "all") return { from: new Date(2000, 0, 1), to: new Date(9999, 11, 31) };
    return getPeriodRange(period);
  }, [period, customFrom, customTo]);

  const baseFiltered = useMemo(() => {
    let rows = orders;

    // Date filter on PO date
    rows = rows.filter((o) => {
      if (!o.poDate) return true;
      const d = new Date(o.poDate + "T00:00:00");
      return d >= periodFrom && d <= periodTo;
    });

    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.poNumber.toLowerCase().includes(s) ||
          r.supplierName.toLowerCase().includes(s)
      );
    }
    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
    if (supplierFilter) rows = rows.filter((r) => r.supplierId === supplierFilter);
    return rows;
  }, [orders, search, statusFilter, supplierFilter, periodFrom, periodTo]);

  const dt = useDataTable(baseFiltered, PO_COLS, { defaultSort: "poDate", defaultDir: "desc" });

  const stats = useMemo(() => ({
    draft: orders.filter((o) => o.status === "Draft").length,
    pendingApproval: orders.filter((o) => o.status === "Pending Approval").length,
    approved: orders.filter((o) => o.status === "Approved").length,
    pushedToAccounting: orders.filter((o) => o.pushStatus === "Pushed").length,
  }), [orders]);

  const allSelected = dt.rows.length > 0 && dt.rows.every((r) => selected.has(r.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(dt.rows.map((r) => r.id)));
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Purchase Orders</h1>
          <p className="text-sm text-stone-500 mt-1">
            {loading ? "Loading…" : `${dt.rows.length} order${dt.rows.length !== 1 ? "s" : ""}`}
            <span className="text-stone-400"> · {PERIODS.find((p) => p.id === period)?.label ?? "Custom"}</span>
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors"
        >
          <Plus size={15} />
          New PO
        </button>
      </div>

      {/* Stats Row */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <StatCard label="Draft"              value={stats.draft}              color="text-stone-300" />
        <StatCard label="Pending Approval"   value={stats.pendingApproval}    color="text-orange-400" />
        <StatCard label="Approved"           value={stats.approved}           color="text-emerald-400" />
        <StatCard label="Pushed to Accounting" value={stats.pushedToAccounting} color="text-violet-400" />
      </div>

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
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
                period === p.id
                  ? "border-violet-500 text-violet-400"
                  : "border-transparent text-stone-500 hover:text-stone-300"
              }`}
            >
              {p.label}
            </button>
          ))}
          {period === "custom" && (
            <div className="ml-3 flex items-center gap-2">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-7 px-2 text-xs rounded border border-stone-700 bg-stone-800 text-stone-300 focus:border-violet-500 focus:outline-none"
              />
              <span className="text-stone-600 text-xs">→</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-7 px-2 text-xs rounded border border-stone-700 bg-stone-800 text-stone-300 focus:border-violet-500 focus:outline-none"
              />
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="px-3 py-2.5 border-b border-stone-800 flex items-center gap-2 flex-wrap">
          <Input
            value={search}
            onChange={(e: any) => setSearch(e.target.value)}
            placeholder="Search PO # or supplier…"
            icon={Search}
            className="w-72"
          />
          <Select
            value={statusFilter}
            onChange={(e: any) => setStatusFilter(e.target.value)}
            placeholder="All statuses"
            options={STATUS_OPTIONS}
          />
          <Select
            value={supplierFilter}
            onChange={(e: any) => setSupplierFilter(e.target.value)}
            placeholder="All suppliers"
            options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
          />
          {(search || statusFilter || supplierFilter) && (
            <Button variant="ghost" size="sm" icon={X} onClick={() => { setSearch(""); setStatusFilter(""); setSupplierFilter(""); }}>
              Clear
            </Button>
          )}
        </div>

        <ActiveFiltersBar dt={dt} cols={PO_COLS} />

        {/* Table */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-5 space-y-2">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : dt.rows.length === 0 ? (
            <EmptyState
              icon={ShoppingCart}
              title="No purchase orders found"
              description={
                orders.length === 0
                  ? "Create your first purchase order to get started."
                  : "Try adjusting your filters."
              }
              action={
                orders.length === 0 ? (
                  <button
                    onClick={() => setShowCreate(true)}
                    className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors"
                  >
                    <Plus size={14} />
                    New PO
                  </button>
                ) : undefined
              }
            />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-800 bg-stone-900/60">
                  <th className="px-4 py-2.5 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="rounded border-stone-600 text-violet-500 focus:ring-violet-500"
                    />
                  </th>
                  {PO_COLS.map((col) => (
                    <ColHeader key={col.key} col={col} dt={dt} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {dt.rows.map((po) => (
                  <tr
                    key={po.id}
                    onClick={() => router.push(`/payables/purchase-orders/${po.id}`)}
                    className={`border-b border-stone-800 cursor-pointer transition-colors ${
                      selected.has(po.id) ? "bg-violet-500/10" : "hover:bg-stone-800/50"
                    }`}
                  >
                    <td className="px-4 py-3" onClick={(e) => { e.stopPropagation(); toggleOne(po.id); }}>
                      <input
                        type="checkbox"
                        checked={selected.has(po.id)}
                        onChange={() => toggleOne(po.id)}
                        className="rounded border-stone-600 text-violet-500 focus:ring-violet-500"
                      />
                    </td>
                    <td className="px-3 py-3 font-mono text-[12px] text-violet-400">{po.poNumber}</td>
                    <td className="px-3 py-3 font-medium text-white">{po.supplierName}</td>
                    <td className="px-3 py-3 text-stone-400 text-[13px] whitespace-nowrap">{formatDate(po.poDate)}</td>
                    <td className="px-3 py-3 text-right text-stone-300 tabular-nums text-[13px] font-semibold">{fmt.money(po.total, po.currency)}</td>
                    <td className="px-3 py-3"><Badge variant={poStatusBadge(po.status)}>{po.status}</Badge></td>
                    <td className="px-3 py-3"><Badge variant={approvalStatusBadge(po.approvalStatus)}>{po.approvalStatus}</Badge></td>
                    <td className="px-3 py-3 text-center"><PushStatusIcon status={po.pushStatus} /></td>
                    <td className="px-3 py-3 text-stone-500 text-[12px] whitespace-nowrap">{formatDate(po.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <CreatePOModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={load} />
    </div>
  );
}
