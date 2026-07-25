"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { Card, Badge, Input, Select, Button, EmptyState, stageBadge, dueStatusBadge } from "@/components/ui";
import { InvoiceModal } from "@/components/forms";
import { SendInvoicesModal } from "@/components/send-invoices-modal";
import { fmt, formatDate, daysOverdue, getDueStatus, sourceLabel, sourceBadgeVariant } from "@/lib/format";
import { Search, Upload, Plus, FileText, Trash2, X, Download, Send, CalendarDays, Sheet } from "lucide-react";

// ── Date period helpers ────────────────────────────────────────────────────────
type PeriodId = "this-month" | "last-month" | "last-3m" | "last-6m" | "all" | "custom";

const PERIODS: { id: PeriodId; label: string }[] = [
  { id: "this-month",  label: "This Month"  },
  { id: "last-month",  label: "Last Month"  },
  { id: "last-3m",     label: "Last 3M"     },
  { id: "last-6m",     label: "Last 6M"     },
  { id: "all",         label: "All Time"    },
  { id: "custom",      label: "Custom"      },
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
  // "all" and "custom" handled at call site
  return { from: new Date(2000, 0, 1), to: now };
}
import { useDataTable, ColHeader, ActiveFiltersBar, type ColDef } from "@/components/data-table";

export default function InvoicesPage() {
  const { invoices, customers, projects, contacts, regions, reps, bulkDeleteInvoices, orgSettings, refresh, toast } = useData() as any;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [responseFilter, setResponseFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  // Date period filter — defaults to last month
  const todayStr = new Date().toISOString().slice(0, 10);
  const lastMonthStart = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); })();
  const [period, setPeriod] = useState<PeriodId>("last-month");
  const [customFrom, setCustomFrom] = useState(lastMonthStart);
  const [customTo, setCustomTo]   = useState(todayStr);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [showBatchEmail, setShowBatchEmail] = useState(false);
  const [bulkStageChanging, setBulkStageChanging] = useState(false);

  const df = orgSettings?.dateFormat || "DD MMM YYYY";

  /** Resolve best email: billingEmail → primary contact → customer email */
  function resolveEmail(inv: any): string | null {
    if (inv.billingEmail) return inv.billingEmail;
    const primaryContact = contacts?.find((c: any) => c.customerId === inv.customerId && c.isPrimary && c.email);
    if (primaryContact) return primaryContact.email;
    const customer = customers?.find((c: any) => c.id === inv.customerId);
    return customer?.email || null;
  }

  const handleDownloadPdf = async (e: React.MouseEvent, inv: any) => {
    e.preventDefault();
    e.stopPropagation();
    if (!((inv.qboId && !inv.qboId.startsWith("CM-")) || (inv.xeroId && !inv.xeroId.startsWith("CN-")))) return;
    setDownloadingId(inv.id);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(`/api/invoices/${inv.id}/pdf`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Invoice-${inv.invoiceNumber}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      clearTimeout(timer);
      if (e?.name === "AbortError") alert("PDF download timed out — please try again.");
    } finally {
      setDownloadingId(null);
    }
  };

  // Resolve active date range
  const { from: periodFrom, to: periodTo } = useMemo(() => {
    if (period === "custom") {
      return {
        from: new Date(customFrom + "T00:00:00"),
        to:   new Date(customTo   + "T23:59:59"),
      };
    }
    if (period === "all") return { from: new Date(2000, 0, 1), to: new Date(9999, 11, 31) };
    return getPeriodRange(period);
  }, [period, customFrom, customTo]);

  const handleExportExcel = () => {
    import("xlsx").then((XLSX) => {
      const rows = dt.rows.map((inv: any) => ({
        "Invoice #":      inv.invoiceNumber,
        "Customer":       inv.customer?.name ?? "",
        "Project":        inv.project?.name ?? "",
        "Rep":            inv.rep?.name ?? "",
        "Region":         inv.region?.name ?? "",
        "Invoice Date":   inv.invoiceDate ?? "",
        "Due Date":       inv.dueDate ?? "",
        "Status":         inv.dueStatus ?? "",
        "Stage":          inv.collectionStage ?? "",
        "Billing Email":  inv.resolvedEmail ?? "",
        "Currency":       inv.currency ?? "",
        "Value":          inv.total ?? 0,
        "Paid":           inv.paid ?? 0,
        "Outstanding":    inv.outstanding ?? 0,
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      // Column widths
      ws["!cols"] = [14,28,22,18,16,14,14,14,18,32,8,12,12,12].map(w => ({ wch: w }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Invoices");
      const period_label = PERIODS.find(p => p.id === period)?.label ?? "Custom";
      XLSX.writeFile(wb, `Invoices_${period_label.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0,10)}.xlsx`);
    });
  };

  const filtered = useMemo(() => {
    let res = invoices.map((i: any) => {
      const isPaidOrClosed = ["Paid", "Written Off"].includes(i.paymentStatus) || i.collectionStage === "Closed";
      const customer = customers.find((c: any) => c.id === i.customerId);
      const project  = projects.find((p: any) => p.id === i.projectId);
      const repId    = customer?.repId ?? project?.repId;
      const regionId = customer?.regionId ?? project?.regionId;
      return {
        ...i,
        customer,
        project,
        rep:    reps?.find((r: any) => r.id === repId) ?? null,
        region: regions?.find((r: any) => r.id === regionId) ?? null,
        outstanding: isPaidOrClosed ? 0 : i.total - (i.paid || 0),
        daysOverdue: daysOverdue(i.dueDate),
        dueStatus: getDueStatus(i),
        resolvedEmail: resolveEmail(i),
      };
    });

    // Date filter on invoice date
    // Use T00:00:00 to force local-time parsing — bare "YYYY-MM-DD" is interpreted
    // as UTC midnight, which causes off-by-one errors for users outside UTC.
    res = res.filter((i: any) => {
      if (!i.invoiceDate) return true;
      const d = new Date(i.invoiceDate + "T00:00:00");
      return d >= periodFrom && d <= periodTo;
    });

    if (search) {
      const s = search.toLowerCase();
      res = res.filter((i: any) =>
        i.invoiceNumber.toLowerCase().includes(s) ||
        i.customer?.name.toLowerCase().includes(s) ||
        (i.poNumber || "").toLowerCase().includes(s) ||
        (i.resolvedEmail || "").toLowerCase().includes(s)
      );
    }
    if (statusFilter) res = res.filter((i: any) => i.dueStatus === statusFilter);
    if (stageFilter) {
      // Keep legacy aliases so old data with alternate stage names still matches
      const STAGE_ALIASES: Record<string, string[]> = {
        "Scheduled":   ["Scheduled", "Reminder Scheduled"],
        "Awaiting":    ["Awaiting", "Awaiting Reply"],
        "Promised":    ["Promised", "Promise to Pay"],
        "In Progress": ["In Progress", "Reminder Sent", "Second Notice", "Final Notice"],
      };
      const aliases = STAGE_ALIASES[stageFilter] || [stageFilter];
      res = res.filter((i: any) => aliases.includes(i.collectionStage));
    }
    if (customerFilter) res = res.filter((i: any) => i.customerId === customerFilter);
    if (regionFilter) res = res.filter((i: any) => {
      const cust = customers.find((c: any) => c.id === i.customerId);
      if (cust?.regionId === regionFilter) return true;
      const proj = projects.find((p: any) => p.id === i.projectId);
      return proj?.regionId === regionFilter;
    });
    // Customer Response Portal filters (uses cached invoice fields)
    if (responseFilter === "dispute") res = res.filter((i: any) => i.hasOpenDispute);
    if (responseFilter === "promise") res = res.filter((i: any) => !!i.promiseDate);
    res.sort((a: any, b: any) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
    return res;
  }, [invoices, customers, projects, contacts, reps, regions, search, statusFilter, stageFilter, customerFilter, regionFilter, responseFilter, periodFrom, periodTo]);

  // Column definitions for sort + filter
  const INV_COLS: ColDef[] = [
    { key: "invoiceNumber", label: "Invoice", sortValue: (r) => r.invoiceNumber, filterLabel: (r) => r.invoiceNumber },
    { key: "customer",      label: "Customer", sortValue: (r) => r.customer?.name ?? "", filterLabel: (r) => r.customer?.name ?? "" },
    { key: "project",       label: "Project",  sortValue: (r) => r.project?.name ?? "", filterLabel: (r) => r.project?.name ?? "(None)" },
    { key: "rep",           label: "Rep",      sortValue: (r) => r.rep?.name ?? "", filterLabel: (r) => r.rep?.name ?? "(None)" },
    { key: "region",        label: "Region",   sortValue: (r) => r.region?.name ?? "", filterLabel: (r) => r.region?.name ?? "(None)" },
    { key: "invoiceDate",   label: "Inv. Date", sortValue: (r) => r.invoiceDate ?? "" },
    { key: "dueDate",       label: "Due Date",  sortValue: (r) => r.dueDate ?? "" },
    { key: "dueStatus",     label: "Status",    sortValue: (r) => r.dueStatus ?? "", filterLabel: (r) => r.dueStatus ?? "" },
    { key: "collectionStage", label: "Stage",   sortValue: (r) => r.collectionStage ?? "", filterLabel: (r) => r.collectionStage ?? "" },
    { key: "billingEmail",  label: "Billing Email", sortValue: (r) => r.resolvedEmail ?? "", filterLabel: (r) => r.resolvedEmail ? "Has email" : "No email", noFilter: false },
    { key: "total",         label: "Value",      sortValue: (r) => r.total ?? 0, align: "right" as const, noFilter: true },
    { key: "outstanding",   label: "Outstanding", sortValue: (r) => r.outstanding ?? 0, align: "right" as const, noFilter: true },
  ];
  const dt = useDataTable(filtered, INV_COLS);

  const allSelected = filtered.length > 0 && filtered.every((i: any) => selected.has(i.id));
  const someSelected = selected.size > 0;

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map((i: any) => i.id)));
  };

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkStageChange = async (stage: string) => {
    if (!stage) return;
    setBulkStageChanging(true);
    try {
      await Promise.all(
        Array.from(selected).map((id) =>
          fetch(`/api/invoices/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ collectionStage: stage }),
          })
        )
      );
      await refresh();
      toast?.(`Stage updated for ${selected.size} invoice${selected.size > 1 ? "s" : ""}`);
      setSelected(new Set());
    } finally {
      setBulkStageChanging(false);
    }
  };

  const handleBulkDelete = async () => {
    setDeleting(true);
    try {
      await bulkDeleteInvoices(Array.from(selected));
      setSelected(new Set());
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Invoices</h1>
          <p className="text-sm text-stone-500 mt-1">
            {dt.rows.length} invoice{dt.rows.length !== 1 ? "s" : ""}
            <span className="text-stone-400"> · {PERIODS.find(p => p.id === period)?.label ?? "Custom"}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" icon={Sheet} onClick={handleExportExcel}>Export Excel</Button>
          <Link href="/imports"><Button variant="secondary" icon={Upload}>Import CSV</Button></Link>
          <Button icon={Plus} onClick={() => setShowCreate(true)}>New invoice</Button>
        </div>
      </div>

      {/* Bulk action bar */}
      {someSelected && (
        <div className="mb-3 flex items-center gap-3 px-4 py-2.5 bg-stone-900 text-white rounded-lg flex-wrap">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="flex-1" />
          <button onClick={() => setSelected(new Set())} className="text-stone-400 hover:text-white p-1 rounded">
            <X size={14} />
          </button>
          <select
            value=""
            disabled={bulkStageChanging}
            onChange={(e) => {
              const stage = e.target.value;
              e.target.value = "";
              handleBulkStageChange(stage);
            }}
            className="bg-stone-700 text-white text-xs rounded-md px-2.5 py-1.5 border-0 focus:outline-none focus:ring-2 focus:ring-stone-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="" disabled>
              {bulkStageChanging ? "Updating…" : "Change stage…"}
            </option>
            {(orgSettings?.stages ?? []).map((s: any) => {
              const key   = typeof s === "string" ? s : s.key;
              const label = typeof s === "string" ? s : s.label;
              return (
                <option key={key} value={key}>
                  {label}
                </option>
              );
            })}
          </select>
          <Button variant="secondary" size="sm" icon={Send} onClick={() => setShowBatchEmail(true)}>
            Send email
          </Button>
          {!confirmDelete ? (
            <Button variant="danger" size="sm" icon={Trash2} onClick={() => setConfirmDelete(true)}>
              Delete {selected.size} invoice{selected.size > 1 ? "s" : ""}
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-amber-300">Are you sure? This cannot be undone.</span>
              <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button variant="danger" size="sm" onClick={handleBulkDelete} disabled={deleting}>
                {deleting ? "Deleting…" : "Yes, delete"}
              </Button>
            </div>
          )}
        </div>
      )}

      <Card padding="none">
        {/* ── Date period picker ── */}
        <div className="px-3 py-2.5 border-b border-stone-800 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-[11px] text-stone-400 font-medium shrink-0">
            <CalendarDays size={13} />
            Invoice date
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

        {/* ── Search + column filters ── */}
        <div className="p-3 border-b border-stone-800 flex items-center gap-2 flex-wrap">
          <Input value={search} onChange={(e: any) => setSearch(e.target.value)} placeholder="Search invoice #, customer, email, PO..." icon={Search} className="w-72" />
          <Select value={statusFilter} onChange={(e: any) => setStatusFilter(e.target.value)} placeholder="All statuses" options={["Not Due", "Due Soon", "Due Today", "Overdue", "Paid", "Written Off"]} />
          <Select value={stageFilter} onChange={(e: any) => setStageFilter(e.target.value)} placeholder="All stages"
            options={(orgSettings?.stages ?? ["New","In Progress","Promised","Disputed","Escalated","Closed"]).map((s: any) =>
              typeof s === "string" ? s : { value: s.key, label: s.label }
            )} />
          <Select value={customerFilter} onChange={(e: any) => setCustomerFilter(e.target.value)} placeholder="All customers" options={customers.map((c: any) => ({ value: c.id, label: c.name }))} />
          <select value={regionFilter} onChange={(e: any) => setRegionFilter(e.target.value)}
            className="h-9 px-3 pr-8 text-sm rounded-md border border-stone-700 bg-stone-800 text-stone-300 appearance-none"
            style={{backgroundImage:`url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,backgroundRepeat:"no-repeat",backgroundPosition:"right 0.5rem center",backgroundSize:"12px"}}>
            <option value="">All regions</option>
            {(regions ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <Select value={responseFilter} onChange={(e: any) => setResponseFilter(e.target.value)} placeholder="All responses"
            options={[{ value: "dispute", label: "⚠ Open dispute" }, { value: "promise", label: "📅 Has promise" }]} />
          {(search || statusFilter || stageFilter || customerFilter || regionFilter || responseFilter) && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setStatusFilter(""); setStageFilter(""); setCustomerFilter(""); setRegionFilter(""); setResponseFilter(""); }}>Clear</Button>
          )}
        </div>
        <ActiveFiltersBar dt={dt} cols={INV_COLS} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-800 bg-stone-900/60">
                <th className="px-3 py-2.5 w-10">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-stone-300 cursor-pointer" />
                </th>
                {INV_COLS.map((col) => (
                  <ColHeader key={col.key} col={col} dt={dt} className={col.align === "right" ? "text-right" : "text-left"} />
                ))}
                <th className="w-10 px-2 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {dt.rows.map((inv: any) => (
                <tr key={inv.id} className={`border-b border-stone-800 hover:bg-stone-800/50 ${selected.has(inv.id) ? "bg-emerald-500/10" : ""}`}>
                  <td className="px-3 py-2.5 w-10">
                    <input type="checkbox" checked={selected.has(inv.id)} onChange={() => toggleOne(inv.id)}
                      className="rounded border-stone-300 cursor-pointer" onClick={(e) => e.stopPropagation()} />
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[12px]">
                    <Link href={`/invoices/${inv.id}`} className="flex items-center gap-1.5 w-full">
                      <span>{inv.invoiceNumber}</span>
                      <Badge variant={sourceBadgeVariant(inv.source)} size="sm">{sourceLabel(inv.source)}</Badge>
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 font-medium text-white">
                    <Link href={`/invoices/${inv.id}`} className="block w-full truncate max-w-[160px]">{inv.customer?.name}</Link>
                  </td>
                  <td className="px-3 py-2.5 text-stone-400 text-[12px]">
                    <Link href={`/invoices/${inv.id}`} className="block w-full truncate max-w-[140px]">{inv.project?.name || "—"}</Link>
                  </td>
                  <td className="px-3 py-2.5 text-stone-400 text-[12px]">
                    <Link href={`/invoices/${inv.id}`} className="block w-full truncate max-w-[120px]">{inv.rep?.name || "—"}</Link>
                  </td>
                  <td className="px-3 py-2.5 text-stone-400 text-[12px]">
                    <Link href={`/invoices/${inv.id}`} className="block w-full truncate max-w-[110px]">{inv.region?.name || "—"}</Link>
                  </td>
                  <td className="px-3 py-2.5 text-stone-400 text-[12px] whitespace-nowrap">
                    <Link href={`/invoices/${inv.id}`} className="block w-full">{formatDate(inv.invoiceDate, df)}</Link>
                  </td>
                  <td className="px-3 py-2.5 text-stone-300 whitespace-nowrap">
                    <Link href={`/invoices/${inv.id}`} className="block w-full">
                      {formatDate(inv.dueDate, df)}
                      {inv.daysOverdue > 0 && <span className="ml-1 text-[11px] text-rose-600 font-medium">+{inv.daysOverdue}d</span>}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={`/invoices/${inv.id}`} className="inline-flex items-center gap-1 flex-wrap">
                      <Badge variant={dueStatusBadge(inv.dueStatus)}>{inv.dueStatus}</Badge>
                      {inv.hasOpenDispute && <Badge variant="red" size="sm">⚠ Dispute</Badge>}
                      {!inv.hasOpenDispute && inv.promiseDate && <Badge variant="blue" size="sm">📅 Committed</Badge>}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={`/invoices/${inv.id}`}><Badge variant={stageBadge(inv.collectionStage)}>{inv.collectionStage}</Badge></Link>
                  </td>
                  <td className="px-3 py-2.5 text-[12px] max-w-[200px]">
                    <Link href={`/invoices/${inv.id}`} className="block w-full" title={inv.resolvedEmail || ""}>
                      {inv.resolvedEmail ? (() => {
                        const addrs = inv.resolvedEmail.split(",").map((e: string) => e.trim()).filter(Boolean);
                        return (
                          <span className="text-stone-300 truncate block">
                            {addrs[0]}
                            {addrs.length > 1 && (
                              <span className="ml-1 text-[10px] text-blue-500 font-medium">+{addrs.length - 1}</span>
                            )}
                          </span>
                        );
                      })() : <span className="text-stone-300 italic">No email</span>}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-right text-stone-400 tabular-nums text-[13px]">
                    <Link href={`/invoices/${inv.id}`} className="block w-full">{fmt.money(inv.total, inv.currency)}</Link>
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-white tabular-nums">
                    <Link href={`/invoices/${inv.id}`} className="block w-full">{fmt.money(inv.outstanding, inv.currency)}</Link>
                  </td>
                  <td className="px-2 py-2.5 w-10">
                    {((inv.qboId && !inv.qboId.startsWith("CM-")) || (inv.xeroId && !inv.xeroId.startsWith("CN-"))) && (
                      <button onClick={(e) => handleDownloadPdf(e, inv)}
                        className="p-1.5 rounded hover:bg-stone-800 text-stone-500 hover:text-stone-200 transition-colors"
                        title="Download PDF">
                        {downloadingId === inv.id
                          ? <span className="animate-spin inline-block w-3.5 h-3.5 border border-stone-400 border-t-transparent rounded-full" />
                          : <Download size={14} />}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <EmptyState icon={FileText} title="No invoices found"
              description={invoices.length === 0 ? "Create your first invoice or import from CSV." : "Try adjusting your filters."}
              action={invoices.length === 0 ? <Button icon={Plus} onClick={() => setShowCreate(true)}>New invoice</Button> : undefined} />
          )}
        </div>
      </Card>

      {showCreate && <InvoiceModal onClose={() => setShowCreate(false)} />}
      {showBatchEmail && (() => {
        const sendRows = Array.from(selected)
          .map((sid) => invoices.find((i: any) => i.id === sid))
          .filter(Boolean)
          .map((inv: any) => ({
            inv,
            custId: inv.customerId,
            custName: customers.find((c: any) => c.id === inv.customerId)?.name ?? "Customer",
            projName: projects.find((p: any) => p.id === inv.projectId)?.name ?? null,
            bal: Number(inv.qboBalance ?? inv.xeroBalance ?? Math.max(0, (inv.total ?? 0) - (inv.paid ?? 0))),
            days: daysOverdue(inv.dueDate),
            email: resolveEmail(inv),
          }));
        const multiCustomer = new Set(sendRows.map((r: any) => r.custId)).size > 1;
        return (
          <SendInvoicesModal
            rows={sendRows}
            ccy={sendRows[0]?.inv?.currency ?? "EUR"}
            multiCustomer={multiCustomer}
            orgName={orgSettings?.displayName ?? orgSettings?.name}
            logoUrl={orgSettings?.logoUrl}
            onClose={() => setShowBatchEmail(false)}
            onSent={() => { setShowBatchEmail(false); setSelected(new Set()); refresh(); }}
            toast={toast}
          />
        );
      })()}
    </div>
  );
}
