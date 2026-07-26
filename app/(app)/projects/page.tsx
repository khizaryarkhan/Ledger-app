"use client";

import { useState, useMemo, useCallback, memo, useEffect } from "react";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { Card, Badge, Button, EmptyState } from "@/components/ui";
import { ProjectModal } from "@/components/forms";
import { fmt, daysOverdue } from "@/lib/format";
import { Briefcase, Plus, Trash2, X, RefreshCw, Search } from "lucide-react";
import { useDataTable, ColHeader, ActiveFiltersBar, type ColDef } from "@/components/data-table";

function ReclassifyModal({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const { regions, reclassifyProjects } = useData() as any;
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
      await reclassifyProjects(ids, repVal, regVal);
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-stone-900 border border-stone-800 rounded-xl shadow-xl w-full max-w-sm p-6">
        <h2 className="text-base font-semibold text-white mb-1">Reclassify projects</h2>
        <p className="text-sm text-stone-400 mb-4">Make changes to all <strong>{ids.length}</strong> selected project{ids.length > 1 ? "s" : ""}.</p>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider block mb-1">Change Rep / ED/RM to</label>
            <select value={repId} onChange={e => setRepId(e.target.value)}
              className="w-full h-9 px-3 text-sm rounded-md border border-stone-700 bg-stone-800 text-stone-300 focus:border-emerald-500 focus:outline-none">
              <option value="">— No change —</option>
              <option value="null">Unassign</option>
              {freshReps.filter((r: any) => r.tier !== "ed" && r.tier !== "rd").length > 0 && (
                freshReps.filter((r: any) => r.tier !== "ed" && r.tier !== "rd")
                  .map((r: any) => <option key={r.id} value={r.id}>{r.name} (PM)</option>)
              )}
              {freshReps.filter((r: any) => r.tier === "ed" || r.tier === "rd").length > 0 && (
                freshReps.filter((r: any) => r.tier === "ed" || r.tier === "rd")
                  .map((r: any) => <option key={r.id} value={r.id}>{r.name} (ED/RM)</option>)
              )}
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

const ProjectRow = memo(function ProjectRow({ p, isSelected, onToggle, statusColor }: { p: any; isSelected: boolean; onToggle: (id: string) => void; statusColor: (s: string) => string }) {
  return (
    <tr className={`border-b border-stone-800 hover:bg-stone-800/50 ${isSelected ? "bg-emerald-500/10" : ""}`}>
      <td className="px-4 py-3 w-10">
        <input type="checkbox" checked={isSelected} onChange={() => onToggle(p.id)} className="rounded border-stone-300 cursor-pointer" />
      </td>
      <td className="px-4 py-3">
        <Link href={`/projects/${p.id}`} className="font-medium text-white hover:text-emerald-400 hover:underline block">{p.name}</Link>
        {p.code && !p.code.startsWith("QBO-") && (
          <div className="text-[11px] text-stone-500 font-mono mt-0.5">{p.code}</div>
        )}
      </td>
      <td className="px-4 py-3">
        {p.customer && <Link href={`/customers/${p.customer.id}`} className="text-stone-300 hover:text-white hover:underline">{p.customer.name}</Link>}
      </td>
      <td className="px-4 py-3">
        {p.repName ? <span className="text-[11px] bg-blue-500/15 text-blue-400 px-2 py-0.5 rounded font-medium">{p.repName}</span> : <span className="text-stone-600 text-[11px]">—</span>}
      </td>
      <td className="px-4 py-3">
        {p.regionName ? <span className="text-[11px] bg-stone-800 text-stone-400 px-2 py-0.5 rounded font-medium">{p.regionName}</span> : <span className="text-stone-600 text-[11px]">—</span>}
      </td>
      <td className="px-4 py-3"><Badge variant={statusColor(p.effectiveStatus) as any} size="sm">{p.effectiveStatus}</Badge></td>
      <td className="px-4 py-3 text-right tabular-nums">{p.openCount}</td>
      <td className="px-4 py-3 text-right font-semibold tabular-nums">{fmt.money(p.outstanding, p.customer?.currency)}</td>
      <td className={`px-4 py-3 text-right font-semibold tabular-nums ${p.overdue > 0 ? "text-rose-600" : "text-stone-500"}`}>{fmt.money(p.overdue, p.customer?.currency)}</td>
    </tr>
  );
});

export default function ProjectsPage() {
  const { projects, customers, invoices, reps, regions, bulkDeleteProjects } = useData() as any;
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [repFilter, setRepFilter] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("Active");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showReclassify, setShowReclassify] = useState(false);

  const enriched = useMemo(() => projects.map((p: any) => {
    const customer = customers.find((c: any) => c.id === p.customerId);
    const projInvoices = invoices.filter((i: any) => i.projectId === p.id);
    const open = projInvoices.filter((i: any) => i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off" && i.txnType !== "CreditMemo");
    const outstanding = open.reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);
    const overdue = open.filter((i: any) => daysOverdue(i.dueDate) > 0).reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);
    const rep = reps.find((r: any) => r.id === p.repId);
    const region = regions.find((r: any) => r.id === p.regionId);
    // Compute status from outstanding — real-time, same logic as customers.
    const effectiveStatus = p.status === "On Hold" ? "On Hold" : outstanding > 0 ? "Active" : "Inactive";
    return { ...p, customer, openCount: open.length, outstanding, overdue, repName: rep?.name, regionName: region?.name, effectiveStatus };
  }), [projects, customers, invoices, reps, regions]);

  const filtered = useMemo(() => {
    let res = enriched;
    if (search) {
      const s = search.toLowerCase();
      res = res.filter((p: any) =>
        p.name?.toLowerCase().includes(s) ||
        p.code?.toLowerCase().includes(s) ||
        p.customer?.name?.toLowerCase().includes(s)
      );
    }
    if (statusFilter) res = res.filter((p: any) => p.effectiveStatus === statusFilter);
    if (repFilter) res = res.filter((p: any) => p.repId === repFilter);
    if (regionFilter) res = res.filter((p: any) => p.regionId === regionFilter);
    return res;
  }, [enriched, search, statusFilter, repFilter, regionFilter]);

  const PROJ_COLS: ColDef[] = useMemo(() => [
    { key: "name", label: "Project", sortValue: (r: any) => r.name, filterLabel: (r: any) => r.name },
    { key: "customer", label: "Customer", sortValue: (r: any) => r.customer?.name ?? "", filterLabel: (r: any) => r.customer?.name ?? "(None)" },
    { key: "repName", label: "Rep", sortValue: (r: any) => r.repName ?? "", filterLabel: (r: any) => r.repName ?? "(Unassigned)" },
    { key: "regionName", label: "Region", sortValue: (r: any) => r.regionName ?? "", filterLabel: (r: any) => r.regionName ?? "(Unassigned)" },
    { key: "status", label: "Status", sortValue: (r: any) => r.status ?? "", filterLabel: (r: any) => r.status ?? "" },
    { key: "openCount", label: "Open Inv.", sortValue: (r: any) => r.openCount ?? 0, align: "right" as const, noFilter: true },
    { key: "outstanding", label: "Outstanding", sortValue: (r: any) => r.outstanding ?? 0, align: "right" as const, noFilter: true },
    { key: "overdue", label: "Overdue", sortValue: (r: any) => r.overdue ?? 0, align: "right" as const, noFilter: true },
  ], []);

  const dt = useDataTable(filtered, PROJ_COLS, { defaultSort: "outstanding", defaultDir: "desc" });

  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [search, statusFilter, repFilter, regionFilter, dt.sortKey, dt.sortDir]);
  const totalPages = Math.ceil(dt.rows.length / PAGE_SIZE);
  const visible = useMemo(() => dt.rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [dt.rows, page]);

  const allSelected = dt.rows.length > 0 && dt.rows.every((p: any) => selected.has(p.id));
  const toggleAll = () => allSelected ? setSelected(new Set()) : setSelected(new Set(dt.rows.map((p: any) => p.id)));
  const toggleOne = useCallback((id: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  }), []);

  const handleBulkDelete = async () => {
    setDeleting(true);
    try {
      await bulkDeleteProjects(Array.from(selected));
      setSelected(new Set());
      setConfirmDelete(false);
    } finally { setDeleting(false); }
  };

  const statusColor = useCallback((s: string) => ({ "Active": "blue", "Inactive": "neutral", "On Hold": "orange", "In Progress": "purple", "Completed": "green", "Pending": "yellow", "Cancelled": "neutral" }[s] || "neutral"), []);

  return (
    <div className="p-6 max-w-[1300px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Projects</h1>
          <p className="text-sm text-stone-500 mt-1">{filtered.length} projects</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search project, code, customer…"
              className="h-9 pl-8 pr-3 text-sm rounded-md border border-stone-700 bg-stone-800 text-stone-300 placeholder-stone-500 focus:border-emerald-500 focus:outline-none w-64"
            />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 px-3 pr-8 text-sm rounded-md border border-stone-700 bg-stone-800 text-stone-300 appearance-none"
            style={{backgroundImage:`url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,backgroundRepeat:"no-repeat",backgroundPosition:"right 0.5rem center",backgroundSize:"12px"}}>
            <option value="">All statuses</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
            <option value="On Hold">On Hold</option>
          </select>
          <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)}
            className="h-9 px-3 pr-8 text-sm rounded-md border border-stone-700 bg-stone-800 text-stone-300 appearance-none"
            style={{backgroundImage:`url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,backgroundRepeat:"no-repeat",backgroundPosition:"right 0.5rem center",backgroundSize:"12px"}}>
            <option value="">All reps / ED/RM</option>
            {reps.filter((r: any) => r.tier !== "ed" && r.tier !== "rd").map((r: any) =>
              <option key={r.id} value={r.id}>{r.name} (PM)</option>
            )}
            {reps.filter((r: any) => r.tier === "ed" || r.tier === "rd").map((r: any) =>
              <option key={r.id} value={r.id}>{r.name} (ED/RM)</option>
            )}
          </select>
          <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)}
            className="h-9 px-3 pr-8 text-sm rounded-md border border-stone-700 bg-stone-800 text-stone-300 appearance-none"
            style={{backgroundImage:`url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,backgroundRepeat:"no-repeat",backgroundPosition:"right 0.5rem center",backgroundSize:"12px"}}>
            <option value="">All regions</option>
            {regions.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          {(search || statusFilter !== "Active" || repFilter || regionFilter) && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setStatusFilter("Active"); setRepFilter(""); setRegionFilter(""); }}>Clear</Button>
          )}
          <Button icon={Plus} onClick={() => setShowCreate(true)}>New project</Button>
        </div>
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

      {dt.rows.length === 0 ? (
        <Card>
          <EmptyState icon={Briefcase} title="No projects found"
            description={projects.length === 0 ? "Projects group invoices for a customer engagement." : "Try adjusting your filters."}
            action={projects.length === 0 ? <Button icon={Plus} onClick={() => setShowCreate(true)}>New project</Button> : undefined} />
        </Card>
      ) : (
        <Card padding="none">
          <ActiveFiltersBar dt={dt} cols={PROJ_COLS} />
          <div className="px-4 py-2.5 border-b border-stone-800 flex items-center gap-2">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-stone-600 cursor-pointer" />
            <span className="text-[11px] text-stone-400">Select all ({dt.rows.length})</span>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-stone-800 bg-stone-900/60">
              <th className="w-10 px-4 py-2.5"></th>
              {PROJ_COLS.map(col => <ColHeader key={col.key} col={col} dt={dt} />)}
            </tr></thead>
            <tbody>
              {visible.map((p: any) => (
                <ProjectRow key={p.id} p={p} isSelected={selected.has(p.id)} onToggle={toggleOne} statusColor={statusColor} />
              ))}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-stone-800">
              <span className="text-xs text-stone-400">Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, dt.rows.length)} of {dt.rows.length}</span>
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
        </Card>
      )}

      {showCreate && <ProjectModal onClose={() => setShowCreate(false)} />}
      {showReclassify && (
        <ReclassifyModal
          ids={Array.from(selected)}
          onClose={() => { setShowReclassify(false); setSelected(new Set()); }}
        />
      )}
    </div>
  );
}
