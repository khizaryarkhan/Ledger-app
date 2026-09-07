"use client";

import { useState, useEffect, useMemo, useCallback, memo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  Plus,
  Users,
  AlertCircle,
  X,
  LayoutGrid,
  List,
} from "lucide-react";
import { Card, Badge, Button, Input, Select, Modal, EmptyState } from "@/components/ui";
import { fmt, formatDate } from "@/lib/format";
import { useDataTable, ColHeader, ActiveFiltersBar, type ColDef } from "@/components/data-table";

// ── Supplier card (grid view) — mirrors AR CustomerCard ────────────────────────
const SupplierCard = memo(function SupplierCard({
  s, isSelected, onToggle,
}: { s: any; isSelected: boolean; onToggle: (id: string) => void }) {
  return (
    <div className={`relative rounded-lg ring-1 transition-colors ${isSelected ? "ring-violet-500 ring-2" : "ring-stone-700 hover:ring-stone-600"}`}>
      <div className="absolute top-3 left-3 z-10">
        <input type="checkbox" checked={isSelected} onChange={() => onToggle(s.id)}
          className="rounded border-stone-600 cursor-pointer" onClick={(e) => e.stopPropagation()} />
      </div>
      <Link href={`/payables/suppliers/${s.id}`}>
        <Card className="cursor-pointer h-full ring-0 hover:ring-0">
          <div className="flex items-start gap-3 mb-3 pl-5">
            <div className="w-10 h-10 rounded-md bg-gradient-to-br from-stone-700 to-stone-800 flex items-center justify-center text-stone-300 text-sm font-semibold flex-shrink-0">
              {(s.name || "?").split(" ").slice(0, 2).map((w: string) => w[0]).join("")}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white truncate">{s.name}</div>
              <div className="text-[11px] text-stone-500 mt-0.5">
                {s.code ? `${s.code} · ` : ""}{s.country || "—"}
              </div>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <span className="text-[10px] bg-stone-800 text-stone-400 px-1.5 py-0.5 rounded font-medium">{normalizeSource(s.source)}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1 items-end">
              {s.riskRating === "High" && <Badge variant="red" size="sm">High</Badge>}
              {s.riskRating === "Medium" && <Badge variant="yellow" size="sm">Med</Badge>}
              {s.status !== "Active" && <Badge variant="orange" size="sm">{s.status}</Badge>}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 pt-3 border-t border-stone-800">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold">Outstanding</div>
              <div className="text-sm font-semibold text-white tabular-nums mt-0.5">{fmt.money(s.totalOutstanding, s.currency)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold">Overdue</div>
              <div className={`text-sm font-semibold tabular-nums mt-0.5 ${s.overdueCount > 0 ? "text-rose-400" : "text-white"}`}>{s.overdueCount || 0}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold">Open bills</div>
              <div className="text-sm font-semibold text-white tabular-nums mt-0.5">{s.openBillsCount}</div>
            </div>
          </div>
        </Card>
      </Link>
    </div>
  );
});

// ── Types ────────────────────────────────────────────────────────────────────

type SupplierStatus = "Active" | "Inactive" | "Suspended";
type SupplierSource = "qbo" | "xero" | "manual";

interface Supplier {
  id: string;
  name: string;
  displayName?: string;
  code?: string;
  email?: string;
  phone?: string;
  currency: string;
  paymentTerms?: number;
  status: SupplierStatus;
  source: SupplierSource | string;
  lastSynced?: string;
  country?: string;
  taxNumber?: string;
  riskRating?: string;
  totalOutstanding: number;
  overdueCount: number;
  openBillsCount: number;
  createdAt?: string;
}

type StatusFilter = "All" | "Active" | "Inactive" | "Suspended";
type SourceFilter = "All" | "QBO" | "Xero" | "Manual";

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeSource(source: string | undefined | null): string {
  if (!source) return "Manual";
  const map: Record<string, string> = { qbo: "QBO", xero: "Xero", manual: "Manual" };
  return map[source.toLowerCase()] ?? source;
}

function sourceBadgeVariant(source: string): string {
  const normalized = normalizeSource(source);
  const map: Record<string, string> = { QBO: "blue", Xero: "purple", Manual: "neutral" };
  return map[normalized] ?? "neutral";
}

function statusBadgeVariant(status: SupplierStatus) {
  return status === "Active" ? "green" : "neutral";
}

function riskBadgeVariant(risk: string | undefined | null): string {
  const map: Record<string, string> = { Low: "green", Medium: "yellow", High: "red" };
  return (risk && map[risk]) ?? "neutral";
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-stone-800 rounded ${className}`} />;
}

// ── Add Supplier Modal ────────────────────────────────────────────────────────

const EMPTY_FORM = {
  name: "",
  displayName: "",
  code: "",
  email: "",
  phone: "",
  currency: "",
  paymentTerms: "",
  country: "",
  taxNumber: "",
  status: "Active" as SupplierStatus,
};

function AddSupplierModal({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (supplier: Supplier) => void;
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default the currency field to the org's home currency — never hardcode
  // one, since a supplier created here with no explicit choice should match
  // the books it's posted into, not an arbitrary literal.
  useEffect(() => {
    fetch("/api/org/settings").then(r => r.json()).then(o => {
      if (o?.currency) setForm(prev => (prev.currency ? prev : { ...prev, currency: o.currency }));
    }).catch(() => {});
  }, []);

  function set(field: keyof typeof EMPTY_FORM) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Supplier name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/payables/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          paymentTerms: form.paymentTerms ? Number(form.paymentTerms) : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Server error ${res.status}`);
      }
      const supplier = await res.json();
      onAdded(supplier);
      setForm(EMPTY_FORM);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to add supplier");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Supplier"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <button
            type="submit"
            form="add-supplier-form"
            disabled={saving}
            className="inline-flex items-center justify-center font-medium rounded-md transition-colors bg-violet-600 text-white hover:bg-violet-500 disabled:bg-stone-700 disabled:text-stone-500 h-9 px-3.5 text-sm gap-2"
          >
            {saving ? "Saving…" : "Add Supplier"}
          </button>
        </>
      }
    >
      <form
        id="add-supplier-form"
        onSubmit={handleSubmit}
        className="p-5 space-y-4"
      >
        {error && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-rose-500/10 ring-1 ring-rose-500/30 text-rose-400 text-sm">
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {/* Name */}
          <div className="col-span-2">
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Name <span className="text-rose-400">*</span>
            </label>
            <Input
              value={form.name}
              onChange={set("name")}
              placeholder="Acme Corp"
            />
          </div>

          {/* Display Name */}
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Display Name
            </label>
            <Input
              value={form.displayName}
              onChange={set("displayName")}
              placeholder="Optional"
            />
          </div>

          {/* Code */}
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Code
            </label>
            <Input
              value={form.code}
              onChange={set("code")}
              placeholder="SUP-001"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Email
            </label>
            <Input
              type="email"
              value={form.email}
              onChange={set("email")}
              placeholder="accounts@acme.com"
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Phone
            </label>
            <Input
              value={form.phone}
              onChange={set("phone")}
              placeholder="+1 555 000 0000"
            />
          </div>

          {/* Currency */}
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Currency
            </label>
            <Select
              value={form.currency}
              onChange={set("currency")}
              options={["USD", "EUR", "GBP", "AED"]}
              className="w-full"
            />
          </div>

          {/* Payment Terms */}
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Payment Terms (days)
            </label>
            <Input
              type="number"
              value={form.paymentTerms}
              onChange={set("paymentTerms")}
              placeholder="30"
            />
          </div>

          {/* Country */}
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Country
            </label>
            <Input
              value={form.country}
              onChange={set("country")}
              placeholder="United States"
            />
          </div>

          {/* Tax Number */}
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Tax Number
            </label>
            <Input
              value={form.taxNumber}
              onChange={set("taxNumber")}
              placeholder="Optional"
            />
          </div>

          {/* Status */}
          <div className="col-span-2">
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Status
            </label>
            <Select
              value={form.status}
              onChange={set("status")}
              options={["Active", "Inactive"]}
              className="w-full"
            />
          </div>
        </div>
      </form>
    </Modal>
  );
}

// ── Column definitions ────────────────────────────────────────────────────────

const SUPPLIER_COLS: ColDef[] = [
  { key: "name",             label: "Supplier",      sortValue: (r) => r.name,              filterLabel: (r) => r.name },
  { key: "code",             label: "Code",           sortValue: (r) => r.code ?? "",        filterLabel: (r) => r.code ?? "(None)" },
  { key: "country",          label: "Country",        sortValue: (r) => r.country ?? "",     filterLabel: (r) => r.country ?? "(None)" },
  { key: "riskRating",       label: "Risk",           sortValue: (r) => r.riskRating ?? "",  filterLabel: (r) => r.riskRating ?? "" },
  { key: "status",           label: "Status",         sortValue: (r) => r.status ?? "",      filterLabel: (r) => r.status ?? "" },
  { key: "source",           label: "Source",         sortValue: (r) => normalizeSource(r.source), filterLabel: (r) => normalizeSource(r.source) },
  { key: "totalOutstanding", label: "Outstanding",    sortValue: (r) => r.totalOutstanding ?? 0, align: "right" as const, noFilter: true },
  { key: "overdueCount",     label: "Overdue",        sortValue: (r) => r.overdueCount ?? 0,     align: "right" as const, noFilter: true },
  { key: "openBillsCount",   label: "Open Bills",     sortValue: (r) => r.openBillsCount ?? 0,   align: "right" as const, noFilter: true },
];

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SuppliersPage() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("Active");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("All");
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 48;

  // "Add supplier" from the Create menu (any module) lands here with ?new=1
  // and opens the same modal the inline "Add" button uses — one real add
  // flow, not a second one on a thinner accounting-only screen.
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setShowAdd(true);
      router.replace("/payables/suppliers");
    }
  }, [searchParams, router]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/payables/suppliers");
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const json = await res.json();
      setSuppliers(Array.isArray(json) ? json : json.suppliers ?? []);
    } catch (e: any) {
      setError(e.message || "Failed to load suppliers");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    let rows = suppliers;
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(
        (sup) =>
          sup.name.toLowerCase().includes(s) ||
          (sup.code ?? "").toLowerCase().includes(s) ||
          (sup.email ?? "").toLowerCase().includes(s)
      );
    }
    if (riskFilter) {
      rows = rows.filter((s) => s.riskRating === riskFilter);
    }
    if (statusFilter !== "All") {
      rows = rows.filter((s) => s.status === statusFilter);
    }
    if (sourceFilter !== "All") {
      rows = rows.filter((s) => normalizeSource(s.source) === sourceFilter);
    }
    return rows;
  }, [suppliers, search, riskFilter, statusFilter, sourceFilter]);

  const dt = useDataTable(filtered, SUPPLIER_COLS, { defaultSort: "totalOutstanding", defaultDir: "desc" });

  const hasFilters = search || riskFilter || statusFilter !== "All" || sourceFilter !== "All";

  const allSelected = dt.rows.length > 0 && dt.rows.every((r: any) => selected.has(r.id));
  const toggleAll = useCallback(() => {
    allSelected
      ? setSelected(new Set())
      : setSelected(new Set(dt.rows.map((r: any) => r.id)));
  }, [allSelected, dt.rows]);
  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">
            Suppliers
          </h1>
          <p className="text-sm text-stone-500 mt-1">
            {loading ? "Loading…" : `${dt.rows.length} supplier${dt.rows.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <Button icon={Plus} onClick={() => setShowAdd(true)}>Add supplier</Button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-5 flex items-center gap-2 px-4 py-3 rounded-lg bg-rose-500/10 ring-1 ring-rose-500/30 text-rose-400 text-sm">
          <AlertCircle size={16} />
          {error}
          <button
            onClick={load}
            className="ml-auto underline hover:no-underline text-rose-300"
          >
            Retry
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Input
          value={search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setSearch(e.target.value)
          }
          placeholder="Search name, code, email…"
          icon={Search}
          className="w-72"
        />
        <Select
          value={riskFilter}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setRiskFilter(e.target.value)}
          placeholder="All risk levels"
          options={["Low", "Medium", "High"]}
          className="w-36"
        />
        <Select
          value={statusFilter}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
            setStatusFilter(e.target.value as StatusFilter)
          }
          options={["All", "Active", "Inactive", "Suspended"]}
          className="w-36"
        />
        <Select
          value={sourceFilter}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
            setSourceFilter(e.target.value as SourceFilter)
          }
          options={["All", "QBO", "Xero", "Manual"]}
          className="w-36"
        />
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            icon={X}
            onClick={() => {
              setSearch("");
              setRiskFilter("");
              setStatusFilter("All");
              setSourceFilter("All");
            }}
          >
            Clear
          </Button>
        )}
        {/* View toggle */}
        <div className="ml-auto flex items-center gap-1 bg-stone-800 rounded-lg p-1">
          <button onClick={() => setViewMode("list")} title="List view"
            className={`p-1.5 rounded-md transition-colors ${viewMode === "list" ? "bg-stone-700 shadow-sm text-white" : "text-stone-400 hover:text-stone-200"}`}>
            <List size={14} />
          </button>
          <button onClick={() => setViewMode("grid")} title="Card view"
            className={`p-1.5 rounded-md transition-colors ${viewMode === "grid" ? "bg-stone-700 shadow-sm text-white" : "text-stone-400 hover:text-stone-200"}`}>
            <LayoutGrid size={14} />
          </button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="p-5 space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="animate-pulse bg-stone-800 rounded h-10 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title="No suppliers found"
            description={
              hasFilters
                ? "Try adjusting your filters."
                : "Add your first supplier to get started."
            }
            action={
              !hasFilters ? <Button icon={Plus} onClick={() => setShowAdd(true)}>Add supplier</Button> : undefined
            }
          />
        </Card>
      ) : viewMode === "list" ? (
        <div className="bg-stone-900 rounded-xl ring-1 ring-stone-800 overflow-hidden">
          <ActiveFiltersBar dt={dt} cols={SUPPLIER_COLS} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-800 bg-stone-900/60">
                  <th className="px-3 py-2.5 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="rounded border-stone-600 cursor-pointer"
                    />
                  </th>
                  {SUPPLIER_COLS.map((col) => (
                    <ColHeader
                      key={col.key}
                      col={col}
                      dt={dt}
                      className={col.align === "right" ? "text-right" : "text-left"}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {dt.rows.map((sup: any) => (
                  <tr
                    key={sup.id}
                    onClick={() => router.push(`/payables/suppliers/${sup.id}`)}
                    className={`border-b border-stone-800 hover:bg-stone-800/50 cursor-pointer transition-colors ${selected.has(sup.id) ? "bg-violet-500/10" : ""}`}
                  >
                    <td className="px-3 py-2.5 w-10" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(sup.id)}
                        onChange={() => toggleOne(sup.id)}
                        className="rounded border-stone-600 cursor-pointer"
                      />
                    </td>
                    {/* Supplier */}
                    <td className="px-3 py-2.5 font-medium text-white whitespace-nowrap">
                      {sup.name}
                    </td>
                    {/* Code */}
                    <td className="px-3 py-2.5 font-mono text-[12px] text-stone-400">
                      {sup.code || "—"}
                    </td>
                    {/* Country */}
                    <td className="px-3 py-2.5 text-stone-400 text-[12px]">
                      {sup.country || "—"}
                    </td>
                    {/* Risk */}
                    <td className="px-3 py-2.5">
                      {sup.riskRating ? (
                        <Badge variant={riskBadgeVariant(sup.riskRating)} size="sm">
                          {sup.riskRating}
                        </Badge>
                      ) : (
                        <span className="text-stone-600 text-[12px]">—</span>
                      )}
                    </td>
                    {/* Status */}
                    <td className="px-3 py-2.5">
                      <Badge variant={statusBadgeVariant(sup.status)} size="sm">
                        {sup.status}
                      </Badge>
                    </td>
                    {/* Source */}
                    <td className="px-3 py-2.5">
                      <Badge variant={sourceBadgeVariant(sup.source)} size="sm">
                        {normalizeSource(sup.source)}
                      </Badge>
                    </td>
                    {/* Outstanding */}
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      <span className={sup.totalOutstanding > 0 ? "font-semibold text-white" : "text-stone-500"}>
                        {fmt.money(sup.totalOutstanding, sup.currency)}
                      </span>
                    </td>
                    {/* Overdue */}
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      <span className={sup.overdueCount > 0 ? "font-semibold text-rose-400" : "text-stone-500"}>
                        {sup.overdueCount > 0 ? sup.overdueCount : "—"}
                      </span>
                    </td>
                    {/* Open Bills */}
                    <td className="px-3 py-2.5 text-right text-stone-400 tabular-nums">
                      {sup.openBillsCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* ── GRID VIEW ── */
        <>
          <div className="grid grid-cols-3 gap-3">
            {dt.rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((s: any) => (
              <SupplierCard key={s.id} s={s} isSelected={selected.has(s.id)} onToggle={toggleOne} />
            ))}
          </div>
          {Math.ceil(dt.rows.length / PAGE_SIZE) > 1 && (
            <div className="flex items-center justify-between px-1 mt-4">
              <span className="text-xs text-stone-500">
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, dt.rows.length)} of {dt.rows.length}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                  className="px-3 py-1.5 text-xs rounded-md border border-stone-700 text-stone-400 disabled:opacity-40 hover:bg-stone-800/50">Prev</button>
                {Array.from({ length: Math.ceil(dt.rows.length / PAGE_SIZE) }, (_, i) => (
                  <button key={i} onClick={() => setPage(i)}
                    className={`px-3 py-1.5 text-xs rounded-md border ${page === i ? "bg-stone-700 text-white border-stone-600" : "border-stone-700 text-stone-400 hover:bg-stone-800/50"}`}>{i + 1}</button>
                ))}
                <button onClick={() => setPage((p) => Math.min(Math.ceil(dt.rows.length / PAGE_SIZE) - 1, p + 1))} disabled={page >= Math.ceil(dt.rows.length / PAGE_SIZE) - 1}
                  className="px-3 py-1.5 text-xs rounded-md border border-stone-700 text-stone-400 disabled:opacity-40 hover:bg-stone-800/50">Next</button>
              </div>
            </div>
          )}
        </>
      )}

      <AddSupplierModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onAdded={(sup) => setSuppliers((prev) => [sup, ...prev])}
      />
    </div>
  );
}
