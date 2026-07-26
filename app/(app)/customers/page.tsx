"use client";

import { useState, useMemo, useCallback, memo, useEffect } from "react";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { Card, Badge, Input, Select, Button, EmptyState } from "@/components/ui";
import { CustomerModal } from "@/components/forms";
import { fmt, daysOverdue } from "@/lib/format";
import { Search, Users, Plus, Trash2, X, RefreshCw, LayoutGrid, List } from "lucide-react";
import { useDataTable, ColHeader, ActiveFiltersBar, type ColDef } from "@/components/data-table";
import { InlineAssign, type AssignGroup } from "@/components/inline-assign";


function ReclassifyModal({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const { regions, reclassifyCustomers } = useData() as any;
  const [repId, setRepId] = useState("");
  const [regionId, setRegionId] = useState("");
  const [saving, setSaving] = useState(false);

  // Always fetch fresh reps when the modal opens so newly-created users appear immediately
  const [freshReps, setFreshReps] = useState<any[]>([]);
  useEffect(() => {
    fetch("/api/org/assignable-reps").then(r => r.json()).then(setFreshReps).catch(() => {});
  }, []);

  const handleApply = async () => {
    if (!repId && !regionId) return;
    setSaving(true);
    try {
      const repVal = repId === "null" ? null : repId || undefined;
      const regVal = regionId === "null" ? null : regionId || undefined;
      await reclassifyCustomers(ids, repVal, regVal);
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-stone-900 border border-stone-800 rounded-xl shadow-xl w-full max-w-sm p-6">
        <h2 className="text-base font-semibold text-white mb-1">Reclassify customers</h2>
        <p className="text-sm text-stone-400 mb-4">Make changes to all <strong>{ids.length}</strong> selected customer{ids.length > 1 ? "s" : ""}.</p>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider block mb-1">Change Rep to</label>
            <select value={repId} onChange={e => setRepId(e.target.value)}
              className="w-full h-9 px-3 text-sm rounded-md border border-stone-700 bg-stone-800 text-stone-300 focus:border-emerald-500 focus:outline-none">
              <option value="">— No change —</option>
              <option value="null">Unassign rep</option>
              {freshReps.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider block mb-1">Change Region to</label>
            <select value={regionId} onChange={e => setRegionId(e.target.value)}
              className="w-full h-9 px-3 text-sm rounded-md border border-stone-700 bg-stone-800 text-stone-300 focus:border-emerald-500 focus:outline-none">
              <option value="">— No change —</option>
              <option value="null">Unassign region</option>
              {regions.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button onClick={handleApply} disabled={saving || (!repId && !regionId)}>
            {saving ? "Applying…" : "Apply"}
          </Button>
        </div>
      </div>
    </div>
  );
}

const CustomerCard = memo(function CustomerCard({ c, isSelected, onToggle, repGroups, regionGroups, onAssign, busy }: { c: any; isSelected: boolean; onToggle: (id: string) => void; repGroups: AssignGroup[]; regionGroups: AssignGroup[]; onAssign: (id: string, field: "rep" | "region", value: string | null) => void; busy: boolean }) {
  return (
    <div className={`relative rounded-lg ring-1 transition-colors ${isSelected ? "ring-emerald-500 ring-2" : "ring-stone-700 hover:ring-stone-600"}`}>
      <div className="absolute top-3 left-3 z-10">
        <input type="checkbox" checked={isSelected} onChange={() => onToggle(c.id)}
          className="rounded border-stone-600 cursor-pointer" onClick={(e) => e.stopPropagation()} />
      </div>
      <Link href={`/customers/${c.id}`}>
        <Card className="cursor-pointer h-full ring-0 hover:ring-0">
          <div className="flex items-start gap-3 mb-3 pl-5">
            <div className="w-10 h-10 rounded-md bg-gradient-to-br from-stone-700 to-stone-800 flex items-center justify-center text-stone-300 text-sm font-semibold flex-shrink-0">
              {c.name.split(" ").slice(0, 2).map((w: string) => w[0]).join("")}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white truncate">{c.name}</div>
              <div className="text-[11px] text-stone-500 mt-0.5">
                {c.code && !c.code.startsWith("QBO-") ? `${c.code} · ` : ""}{c.country || "—"}
              </div>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap"
                onClick={e => { e.preventDefault(); e.stopPropagation(); }}>
                <InlineAssign value={c.repId ?? null} tone="blue" title="Assign rep / ED-RM" busy={busy}
                  groups={repGroups} onChange={v => onAssign(c.id, "rep", v)} />
                <InlineAssign value={c.regionId ?? null} tone="stone" title="Assign region" busy={busy}
                  groups={regionGroups} onChange={v => onAssign(c.id, "region", v)} />
              </div>
            </div>
            <div className="flex flex-col gap-1 items-end">
              {c.riskRating === "High" && <Badge variant="red" size="sm">High</Badge>}
              {c.riskRating === "Medium" && <Badge variant="yellow" size="sm">Med</Badge>}
              {c.status !== "Active" && <Badge variant="orange" size="sm">{c.status}</Badge>}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 pt-3 border-t border-stone-800">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold">Outstanding</div>
              <div className="text-sm font-semibold text-white tabular-nums mt-0.5">{fmt.money(c.outstanding, c.invoiceCurrency)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold">Overdue</div>
              <div className={`text-sm font-semibold tabular-nums mt-0.5 ${c.overdue > 0 ? "text-rose-400" : "text-white"}`}>{fmt.money(c.overdue, c.invoiceCurrency)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold">Open inv.</div>
              <div className="text-sm font-semibold text-white tabular-nums mt-0.5">{c.openCount}</div>
            </div>
          </div>
        </Card>
      </Link>
    </div>
  );
});

export default function CustomersPage() {
  const { customers, invoices, reps, regions, bulkDeleteCustomers, reclassifyCustomers } = useData() as any;

  // Assignable people for inline Rep editing (reps/EDs + admins, incl. multi-org).
  const [assignableReps, setAssignableReps] = useState<{ id: string; name: string; tier: string }[]>([]);
  useEffect(() => {
    fetch("/api/org/assignable-reps").then(r => r.json()).then(d => Array.isArray(d) && setAssignableReps(d)).catch(() => {});
  }, []);
  const repGroups: AssignGroup[] = useMemo(() => [
    { label: "Rep / PM", items: assignableReps.filter(r => r.tier !== "ed" && r.tier !== "rd") },
    { label: "ED / RM", items: assignableReps.filter(r => r.tier === "ed" || r.tier === "rd") },
  ], [assignableReps]);
  const regionGroups: AssignGroup[] = useMemo(() => [{ label: "", items: regions }], [regions]);
  const repNameById = useMemo(() => {
    const m = new Map<string, string>();
    reps.forEach((r: any) => m.set(r.id, r.name));
    assignableReps.forEach(r => m.set(r.id, r.name));
    return m;
  }, [reps, assignableReps]);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const onAssign = useCallback(async (id: string, field: "rep" | "region", value: string | null) => {
    setAssigningId(id);
    try {
      if (field === "rep") await reclassifyCustomers([id], value);
      else await reclassifyCustomers([id], undefined, value);
    } finally { setAssigningId(null); }
  }, [reclassifyCustomers]);

  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("Active");
  const [repFilter, setRepFilter] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showReclassify, setShowReclassify] = useState(false);

  const enriched = useMemo(() => {
    return customers.map((c: any) => {
      const custInvoices = invoices.filter((i: any) => i.customerId === c.id);
      const open = custInvoices.filter((i: any) => i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off" && i.txnType !== "CreditMemo");
      const outstanding = open.reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);
      const overdue = open.filter((i: any) => daysOverdue(i.dueDate) > 0).reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);
      const region = regions.find((r: any) => r.id === c.regionId);
      // Compute status from outstanding — always real-time, no sync delay needed.
      // "On Hold" is a manual override and is preserved regardless of AR balance.
      const effectiveStatus = c.status === "On Hold" ? "On Hold" : outstanding > 0 ? "Active" : "Inactive";
      const invoiceCurrency = open[0]?.currency ?? "?";
      return { ...c, outstanding, overdue, openCount: open.length, repName: c.repId ? repNameById.get(c.repId) : undefined, regionName: region?.name, effectiveStatus, invoiceCurrency };
    });
  }, [customers, invoices, regions, repNameById]);

  const filtered = useMemo(() => {
    let res = enriched;
    if (search) {
      const s = search.toLowerCase();
      res = res.filter((c: any) => c.name.toLowerCase().includes(s) || c.code.toLowerCase().includes(s) || (c.email || "").toLowerCase().includes(s));
    }
    if (riskFilter) res = res.filter((c: any) => c.riskRating === riskFilter);
    if (statusFilter) res = res.filter((c: any) => c.effectiveStatus === statusFilter);
    if (repFilter) res = res.filter((c: any) => c.repId === repFilter);
    if (regionFilter) res = res.filter((c: any) => c.regionId === regionFilter);
    return res.sort((a: any, b: any) => b.outstanding - a.outstanding);
  }, [enriched, search, riskFilter, statusFilter, repFilter, regionFilter]);

  const toggleOne = useCallback((id: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  }), []);

  const PAGE_SIZE = 48;
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [search, riskFilter, statusFilter, repFilter, regionFilter]);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const visible = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);

  const allSelected = filtered.length > 0 && filtered.every((c: any) => selected.has(c.id));
  const toggleAll = () => allSelected ? setSelected(new Set()) : setSelected(new Set(filtered.map((c: any) => c.id)));

  const handleBulkDelete = async () => {
    setDeleting(true);
    try {
      await bulkDeleteCustomers(Array.from(selected));
      setSelected(new Set());
      setConfirmDelete(false);
    } finally { setDeleting(false); }
  };

  const hasFilters = search || riskFilter || statusFilter || repFilter || regionFilter;
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");

  // Column definitions for list view
  const CUST_COLS: ColDef[] = [
    { key: "name",        label: "Customer",    sortValue: (r) => r.name,        filterLabel: (r) => r.name },
    { key: "code",        label: "Code",         sortValue: (r) => r.code,        filterLabel: (r) => r.code },
    { key: "country",     label: "Country",      sortValue: (r) => r.country ?? "", filterLabel: (r) => r.country ?? "(None)" },
    { key: "repName",     label: "Rep",          sortValue: (r) => r.repName ?? "", filterLabel: (r) => r.repName ?? "(Unassigned)" },
    { key: "regionName",  label: "Region",       sortValue: (r) => r.regionName ?? "", filterLabel: (r) => r.regionName ?? "(Unassigned)" },
    { key: "riskRating",  label: "Risk",         sortValue: (r) => r.riskRating ?? "", filterLabel: (r) => r.riskRating ?? "" },
    { key: "status",      label: "Status",       sortValue: (r) => r.status ?? "", filterLabel: (r) => r.status ?? "" },
    { key: "outstanding", label: "Outstanding",  sortValue: (r) => r.outstanding ?? 0, align: "right" as const, noFilter: true },
    { key: "overdue",     label: "Overdue",      sortValue: (r) => r.overdue ?? 0,     align: "right" as const, noFilter: true },
    { key: "openCount",   label: "Open Inv.",    sortValue: (r) => r.openCount ?? 0,   align: "right" as const, noFilter: true },
  ];
  const dt = useDataTable(filtered, CUST_COLS, { defaultSort: "outstanding", defaultDir: "desc" });

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Customers</h1>
          <p className="text-sm text-stone-500 mt-1">{filtered.length} customers</p>
        </div>
        <Button icon={Plus} onClick={() => setShowCreate(true)}>New customer</Button>
      </div>

      <div className={selected.size > 0 ? "mb-3" : "h-0 overflow-hidden"}>
        <div className="flex items-center gap-3 px-4 py-2.5 bg-stone-900 text-white rounded-lg">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="flex-1" />
          <button onClick={() => setSelected(new Set())} className="text-stone-400 hover:text-white p-1 rounded"><X size={14} /></button>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => setShowReclassify(true)}>Reclassify</Button>
          {!confirmDelete ? (
            <Button variant="danger" size="sm" icon={Trash2} onClick={() => setConfirmDelete(true)}>Delete {selected.size}</Button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-amber-300">Cannot be undone. Sure?</span>
              <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button variant="danger" size="sm" onClick={handleBulkDelete} disabled={deleting}>{deleting ? "Deleting…" : "Yes, delete"}</Button>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Input value={search} onChange={(e: any) => setSearch(e.target.value)} placeholder="Search by name, code or email..." icon={Search} className="w-72" />
        <Select value={riskFilter} onChange={(e: any) => setRiskFilter(e.target.value)} placeholder="All risk levels" options={["Low", "Medium", "High"]} />
        <Select value={statusFilter} onChange={(e: any) => setStatusFilter(e.target.value)} placeholder="All statuses" options={["Active", "On Hold", "Inactive"]} />
        <select value={repFilter} onChange={(e: any) => setRepFilter(e.target.value)}
          className="h-9 px-3 pr-8 text-sm rounded-md border border-stone-700 bg-stone-800 text-stone-300 appearance-none"
          style={{backgroundImage:`url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,backgroundRepeat:"no-repeat",backgroundPosition:"right 0.5rem center",backgroundSize:"12px"}}>
          <option value="">All reps</option>
          {reps.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select value={regionFilter} onChange={(e: any) => setRegionFilter(e.target.value)}
          className="h-9 px-3 pr-8 text-sm rounded-md border border-stone-700 bg-stone-800 text-stone-300 appearance-none"
          style={{backgroundImage:`url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,backgroundRepeat:"no-repeat",backgroundPosition:"right 0.5rem center",backgroundSize:"12px"}}>
          <option value="">All regions</option>
          {regions.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        {hasFilters && <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setRiskFilter(""); setStatusFilter(""); setRepFilter(""); setRegionFilter(""); }}>Clear</Button>}
        {filtered.length > 0 && viewMode === "grid" && (
          <label className="flex items-center gap-2 text-sm text-stone-600 ml-2 cursor-pointer">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-stone-300" />
            Select all
          </label>
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

      {filtered.length === 0 ? (
        <Card>
          <EmptyState icon={Users} title="No customers found"
            description={customers.length === 0 ? "Create your first customer or sync from QuickBooks." : "Try adjusting your filters."}
            action={customers.length === 0 ? <Button icon={Plus} onClick={() => setShowCreate(true)}>New customer</Button> : undefined} />
        </Card>
      ) : viewMode === "list" ? (
        /* ── LIST VIEW ── */
        <div className="bg-stone-900 rounded-xl ring-1 ring-stone-800 overflow-hidden">
          <ActiveFiltersBar dt={dt} cols={CUST_COLS} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-800 bg-stone-900/60">
                  <th className="px-3 py-2.5 w-10">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-stone-600 cursor-pointer" />
                  </th>
                  {CUST_COLS.map((col) => (
                    <ColHeader key={col.key} col={col} dt={dt} className={col.align === "right" ? "text-right" : "text-left"} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {dt.rows.map((c: any) => (
                  <tr key={c.id} className={`border-b border-stone-800 hover:bg-stone-800/50 ${selected.has(c.id) ? "bg-emerald-500/10" : ""}`}>
                    <td className="px-3 py-2.5 w-10">
                      <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)}
                        className="rounded border-stone-600 cursor-pointer" onClick={(e) => e.stopPropagation()} />
                    </td>
                    <td className="px-3 py-2.5 font-medium text-white">
                      <Link href={`/customers/${c.id}`} className="hover:underline">{c.name}</Link>
                    </td>
                    <td className="px-3 py-2.5 text-stone-400 font-mono text-[12px]">
                      {c.code?.startsWith("QBO-") ? "—" : c.code}
                    </td>
                    <td className="px-3 py-2.5 text-stone-400 text-[12px]">{c.country || "—"}</td>
                    <td className="px-3 py-2.5">
                      <InlineAssign value={c.repId ?? null} tone="blue" title="Assign rep / ED-RM" busy={assigningId === c.id}
                        groups={repGroups} onChange={v => onAssign(c.id, "rep", v)} />
                    </td>
                    <td className="px-3 py-2.5">
                      <InlineAssign value={c.regionId ?? null} tone="stone" title="Assign region" busy={assigningId === c.id}
                        groups={regionGroups} onChange={v => onAssign(c.id, "region", v)} />
                    </td>
                    <td className="px-3 py-2.5">
                      {c.riskRating === "High" && <Badge variant="red" size="sm">High</Badge>}
                      {c.riskRating === "Medium" && <Badge variant="yellow" size="sm">Med</Badge>}
                      {c.riskRating === "Low" && <Badge variant="green" size="sm">Low</Badge>}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant={c.effectiveStatus === "Active" ? "green" : c.effectiveStatus === "On Hold" ? "orange" : "neutral"} size="sm">{c.effectiveStatus}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-white tabular-nums">{fmt.money(c.outstanding, c.invoiceCurrency)}</td>
                    <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${c.overdue > 0 ? "text-rose-400" : "text-stone-500"}`}>{fmt.money(c.overdue, c.invoiceCurrency)}</td>
                    <td className="px-3 py-2.5 text-right text-stone-400 tabular-nums">{c.openCount}</td>
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
          {visible.map((c: any) => (
            <CustomerCard key={c.id} c={c} isSelected={selected.has(c.id)} onToggle={toggleOne} repGroups={repGroups} regionGroups={regionGroups} onAssign={onAssign} busy={assigningId === c.id} />
          ))}
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-1 mt-4">
            <span className="text-xs text-stone-500">Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="px-3 py-1.5 text-xs rounded-md border border-stone-700 text-stone-400 disabled:opacity-40 hover:bg-stone-800/50">Prev</button>
              {Array.from({ length: totalPages }, (_, i) => (
                <button key={i} onClick={() => setPage(i)}
                  className={`px-3 py-1.5 text-xs rounded-md border ${page === i ? "bg-stone-700 text-white border-stone-600" : "border-stone-700 text-stone-400 hover:bg-stone-800/50"}`}>{i + 1}</button>
              ))}
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
                className="px-3 py-1.5 text-xs rounded-md border border-stone-700 text-stone-400 disabled:opacity-40 hover:bg-stone-800/50">Next</button>
            </div>
          </div>
        )}
        </>
      )}

      {showCreate && <CustomerModal onClose={() => setShowCreate(false)} />}
      {showReclassify && (
        <ReclassifyModal
          ids={Array.from(selected)}
          onClose={() => { setShowReclassify(false); setSelected(new Set()); }}
        />
      )}
    </div>
  );
}
