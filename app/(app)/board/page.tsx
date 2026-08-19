"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { fmt, daysOverdue } from "@/lib/format";
import { Users, Briefcase, ChevronRight, LayoutGrid, List as ListIcon, Search } from "lucide-react";
import { DEFAULT_STAGES, STAGE_COLOR_CLASSES, resolveStageLabel, Stage } from "@/lib/stages";
import { BoardList, type BoardRow } from "@/components/board-list";

// Renders a compact "PKR 1,499,999 · USD 25,000" breakdown — one pill per currency.
function CurrencyPills({ breakdown, className }: { breakdown: Record<string, number>; className?: string }) {
  const entries = Object.entries(breakdown).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return <span className={className}>—</span>;
  return (
    <span className={className}>
      {entries.map(([c, v], i) => (
        <span key={c}>
          {i > 0 && <span className="text-stone-600 mx-1.5">·</span>}
          {fmt.money(v, c)}
        </span>
      ))}
    </span>
  );
}

// Use qboBalance as the authoritative open balance — same as dashboard & reports.
// Falls back to total-paid for rows that pre-date the QBO snapshot.
function openBal(inv: any): number {
  if (inv.qboBalance != null) return Number(inv.qboBalance);
  if (inv.xeroBalance != null) return Math.max(0, Number(inv.xeroBalance));
  return Math.max(0, Number(inv.total || 0) - Number(inv.paid || 0));
}

const AGING_COLORS = [
  { label: "Current", color: "bg-emerald-500", key: "current" },
  { label: "1–30d", color: "bg-amber-400", key: "d30" },
  { label: "31–60d", color: "bg-orange-500", key: "d60" },
  { label: "61–90d", color: "bg-rose-500", key: "d90" },
  { label: "90+d", color: "bg-rose-700", key: "d90plus" },
];

function getAgingBuckets(invs: any[]) {
  const buckets = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0, total: 0 };
  for (const inv of invs) {
    if (inv.paymentStatus === "Paid" || inv.paymentStatus === "Written Off" || inv.txnType === "CreditMemo") continue;
    const out = openBal(inv);
    const d = daysOverdue(inv.dueDate);
    buckets.total += out;
    if (d <= 0) buckets.current += out;
    else if (d <= 30) buckets.d30 += out;
    else if (d <= 60) buckets.d60 += out;
    else if (d <= 90) buckets.d90 += out;
    else buckets.d90plus += out;
  }
  return buckets;
}

function AgingBar({ buckets }: { buckets: ReturnType<typeof getAgingBuckets> }) {
  if (buckets.total === 0) return null;
  return (
    <div className="mt-3">
      <div className="flex h-1.5 rounded-full overflow-hidden gap-px">
        {AGING_COLORS.map(({ key, color }) => {
          const pct = buckets.total > 0 ? (buckets[key as keyof typeof buckets] as number) / buckets.total * 100 : 0;
          if (pct === 0) return null;
          return <div key={key} className={`${color} h-full`} style={{ width: `${pct}%` }} title={`${key}: ${pct.toFixed(0)}%`} />;
        })}
      </div>
      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
        {AGING_COLORS.map(({ key, color, label }) => {
          const val = buckets[key as keyof typeof buckets] as number;
          const pct = buckets.total > 0 ? val / buckets.total * 100 : 0;
          if (pct === 0) return null;
          return (
            <div key={key} className="flex items-center gap-1">
              <div className={`w-1.5 h-1.5 rounded-full ${color}`} />
              <span className="text-[10px] text-stone-500">{label} <span className="font-medium text-stone-300">{pct.toFixed(0)}%</span></span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CollectionCard({ entity, invoices, href, draggingId, setDraggingId, stages, repName }: any) {
  const closedLabel = (stages as Stage[]).find(s => s.isClosed)?.label ?? "Closed";
  const open = invoices.filter((i: any) => i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off" && resolveStageLabel(i.collectionStage, stages) !== closedLabel && i.txnType !== "CreditMemo" && openBal(i) > 0);
  const outstanding = open.reduce((s: number, i: any) => s + openBal(i), 0);
  // Use the currency from the invoices themselves — entity.currency can be stale
  const invoiceCurrency = open[0]?.currency ?? invoices[0]?.currency ?? entity.currency;
  const buckets = getAgingBuckets(open);
  const hasOverdue = open.some((i: any) => daysOverdue(i.dueDate) > 0);

  // Dominant stage (resolved to current label)
  const stageCounts: Record<string, number> = {};
  open.forEach((i: any) => {
    const resolved = resolveStageLabel(i.collectionStage, stages);
    stageCounts[resolved] = (stageCounts[resolved] || 0) + 1;
  });
  const dominantLabel = Object.entries(stageCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? (stages[0]?.label ?? "New");
  const dominantStage = (stages as Stage[]).find(s => s.label === dominantLabel);
  const badgeCls = STAGE_COLOR_CLASSES[dominantStage?.color ?? "stone"]?.badge ?? "bg-stone-100 text-stone-700";

  // Per-invoice customer-response signals — so a single disputed/promised
  // invoice never hides behind the entity's dominant stage.
  const disputedCount = open.filter((i: any) => i.hasOpenDispute).length;
  const promisedCount = open.filter((i: any) => !i.hasOpenDispute && i.promiseDate).length;

  return (
    <Link href={href}
      draggable
      onDragStart={() => setDraggingId(entity.id)}
      onDragEnd={() => setDraggingId(null)}
      className={`block bg-stone-900 rounded-lg border border-stone-700 p-3.5 hover:border-stone-500 hover:bg-stone-800/80 cursor-pointer transition-all ${draggingId === entity.id ? "opacity-40" : ""}`}>

      <div className="flex items-start justify-between mb-1">
        <div className="flex-1 min-w-0">
          {entity.code && !entity.code.startsWith("QBO-") && (
            <div className="text-[10px] text-stone-500 font-mono mb-0.5">{entity.code}</div>
          )}
          <div className="text-sm font-semibold text-white leading-tight truncate">{entity.name}</div>
        </div>
        {hasOverdue && <div className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1 flex-shrink-0 ml-2" />}
      </div>

      <div className="flex items-center justify-between mt-2">
        <div className="text-base font-semibold tabular-nums text-white">{fmt.money(outstanding, invoiceCurrency)}</div>
        <div className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${badgeCls}`}>{dominantLabel}</div>
      </div>

      <div className="flex items-center gap-2 mt-2 text-[11px] text-stone-400">
        <span>{open.length} open invoice{open.length !== 1 ? "s" : ""}</span>
        {invoices.length > open.length && <span>· {invoices.length - open.length} closed</span>}
      </div>
      {repName && (
        <div className="flex items-center gap-1 mt-1.5 text-[11px] text-stone-500">
          <Users size={11} /> {repName}
        </div>
      )}

      {(disputedCount > 0 || promisedCount > 0) && (
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          {disputedCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/20 font-semibold">⚠ {disputedCount} disputed</span>
          )}
          {promisedCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/20 font-semibold">📅 {promisedCount} committed</span>
          )}
        </div>
      )}

      <AgingBar buckets={buckets} />
    </Link>
  );
}

export default function BoardPage() {
  const { invoices, customers, projects, regions, reps, updateInvoice, orgSettings, refresh, toast, communications } = useData() as any;

  // Consolidated (group) context — when a Head-Office group is active, rows span
  // multiple branches; fetch their names so the board can tag each customer.
  const [orgScope, setOrgScope] = useState<{ isGroup: boolean; orgNames: Record<string, string> }>({ isGroup: false, orgNames: {} });
  useEffect(() => {
    fetch("/api/org/scope").then(r => r.json()).then((d) => {
      if (d && Array.isArray(d.orgs)) {
        setOrgScope({ isGroup: !!d.isGroup, orgNames: Object.fromEntries(d.orgs.map((o: any) => [o.id, o.name])) });
      }
    }).catch(() => {});
  }, []);

  // invoiceId → most-recent outbound email { date, ref } (for Last sent / Last ref columns)
  // "at" = newest outbound date (including refless replies)
  // "ref" = newest outbound ref that is non-null (replies have no ref and must not blank it)
  const lastSentByInv = useMemo(() => {
    const lastAt:  Record<string, string> = {};
    const lastRef: Record<string, { at: string; ref: string }> = {};
    (communications ?? []).forEach((c: any) => {
      if (!c.invoiceId || c.direction !== "Outbound") return;
      // "Last Email Ref" must reflect actual outbound EMAILS / logged chases only.
      // Internal notes, stage changes, promises and disputes are also stored as
      // Outbound (channel "Note"/"StageChange"/"Promise"/"Dispute") and were
      // wrongly bumping the date. Match the canonical contact rule used elsewhere.
      if (c.channel !== "Email" && c.channel !== "Chase") return;
      const t = c.sentAt ?? c.createdAt;
      if (!t) return;
      if (!lastAt[c.invoiceId] || new Date(t) > new Date(lastAt[c.invoiceId]))
        lastAt[c.invoiceId] = t;
      if (c.refNumber && (!lastRef[c.invoiceId] || new Date(t) > new Date(lastRef[c.invoiceId].at)))
        lastRef[c.invoiceId] = { at: t, ref: c.refNumber };
    });
    const m: Record<string, { at: string; ref: string | null }> = {};
    Object.keys(lastAt).forEach(id => { m[id] = { at: lastAt[id], ref: lastRef[id]?.ref ?? null }; });
    return m;
  }, [communications]);
  const stages: Stage[] = orgSettings?.stages?.length ? orgSettings.stages : DEFAULT_STAGES;
  const visibleLabels = stages.filter(s => s.visible).map(s => s.label);
  const closedLabel = stages.find(s => s.isClosed)?.label ?? "Closed";

  const [groupBy, setGroupBy] = useState<"customer" | "project">("customer");
  const [viewMode, setViewMode] = useState<"cards" | "list">("cards");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingOverStage, setDraggingOverStage] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [regionFilter, setRegionFilter] = useState("");
  const [repFilter, setRepFilter] = useState("");
  const [search, setSearch] = useState("");

  const repName = (id: string | null | undefined) => (reps ?? []).find((r: any) => r.id === id)?.name ?? null;

  // Group entities by their dominant collection stage
  const grouped = useMemo(() => {
    const entities = groupBy === "customer" ? customers : projects;
    const map: Record<string, { entity: any; invoices: any[]; outstanding: number; currencyBreakdown: Record<string, number>; stage: string }> = {};

    const q = search.trim().toLowerCase();
    entities.forEach((e: any) => {
      // Rep filter — skip entities not assigned to the selected rep
      if (repFilter && e.repId !== repFilter) return;
      // Search filter — match entity name or code
      if (q && !(`${e.name ?? ""} ${e.code ?? ""}`.toLowerCase().includes(q))) return;

      // Get invoices for this entity
      let entityInvoices = invoices.filter((i: any) =>
        groupBy === "customer" ? i.customerId === e.id : i.projectId === e.id
      );
      if (entityInvoices.length === 0) return;

      // Region filter — scope invoices to only those in the selected region
      if (regionFilter) {
        entityInvoices = entityInvoices.filter((i: any) => {
          const cust = customers.find((c: any) => c.id === i.customerId);
          if (cust?.regionId === regionFilter) return true;
          const proj = projects.find((p: any) => p.id === i.projectId);
          return proj?.regionId === regionFilter;
        });
        if (entityInvoices.length === 0) return; // skip entity if no invoices in region
      }

      const open = entityInvoices.filter((i: any) => i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off" && resolveStageLabel(i.collectionStage, stages) !== closedLabel && i.txnType !== "CreditMemo" && openBal(i) > 0);
      const outstanding = open.reduce((s: number, i: any) => s + openBal(i), 0);
      if (open.length === 0) return;
      // Native per-currency breakdown for display
      const currencyBreakdown: Record<string, number> = {};
      open.forEach((i: any) => {
        const c = i.currency ?? "USD";
        currencyBreakdown[c] = (currencyBreakdown[c] || 0) + openBal(i);
      });

      const stageValues: Record<string, number> = {};
      open.forEach((i: any) => {
        const ns = resolveStageLabel(i.collectionStage, stages);
        stageValues[ns] = (stageValues[ns] || 0) + openBal(i);
      });
      const stage = Object.entries(stageValues).sort((a, b) => b[1] - a[1])[0]?.[0] || "New";

      map[e.id] = { entity: e, invoices: entityInvoices, outstanding, currencyBreakdown, stage };
    });

    return map;
  }, [invoices, customers, projects, groupBy, regionFilter, repFilter, search, stages, closedLabel]);

  const byStage = useMemo(() => {
    const result: Record<string, typeof grouped[string][]> = {};
    visibleLabels.forEach(s => result[s] = []);
    Object.values(grouped).forEach(item => {
      if (result[item.stage]) result[item.stage].push(item);
      // Overflow: items whose stage isn't visible go into first visible column
      else if (visibleLabels.length > 0) result[visibleLabels[0]].push(item);
    });
    Object.keys(result).forEach(s => result[s].sort((a, b) => b.outstanding - a.outstanding));
    return result;
  }, [grouped, visibleLabels]);

  const stageTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    visibleLabels.forEach(s => {
      totals[s] = (byStage[s] || []).reduce((sum, item) => sum + item.outstanding, 0);
    });
    return totals;
  }, [byStage, visibleLabels]);

  // Per-currency native totals for display (SUMIF by currency per stage)
  const stageCurrencyTotals = useMemo(() => {
    const totals: Record<string, Record<string, number>> = {};
    visibleLabels.forEach(s => { totals[s] = {}; });
    Object.values(grouped).forEach(item => {
      const bucket = totals[item.stage] ?? totals[visibleLabels[0]];
      if (!bucket) return;
      Object.entries(item.currencyBreakdown).forEach(([c, amt]) => {
        bucket[c] = (bucket[c] || 0) + amt;
      });
    });
    return totals;
  }, [grouped, visibleLabels]);

  const totalAR = Object.values(stageTotals).reduce((s, v) => s + v, 0);

  // Per-currency grand total for header
  const totalByCurrency = useMemo(() => {
    const t: Record<string, number> = {};
    Object.values(stageCurrencyTotals).forEach(stageMap => {
      Object.entries(stageMap).forEach(([c, amt]) => { t[c] = (t[c] || 0) + amt; });
    });
    return t;
  }, [stageCurrencyTotals]);

  const handleDrop = async (stage: string) => {
    if (!draggingId) return;
    setDraggingOverStage(null);
    const item = grouped[draggingId];
    if (!item || item.stage === stage) return;
    // Update all open invoices for this entity to the new stage
    const openInvs = item.invoices.filter((i: any) => i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off" && resolveStageLabel(i.collectionStage, stages) !== closedLabel && i.txnType !== "CreditMemo" && openBal(i) > 0);
    await Promise.all(openInvs.map((i: any) => updateInvoice(i.id, { collectionStage: stage })));
    setDraggingId(null);
  };

  const visibleStages = stageFilter ? [stageFilter] : visibleLabels;

  // ── Invoice-level rows for the List view (honours all the same filters) ────
  const openInvoiceRows = useMemo<BoardRow[]>(() => {
    const rows: BoardRow[] = [];
    invoices.forEach((i: any) => {
      if (i.paymentStatus === "Paid" || i.paymentStatus === "Written Off" || i.txnType === "CreditMemo") return;
      const stageLabel = resolveStageLabel(i.collectionStage, stages);
      if (stageLabel === closedLabel) return;
      if (openBal(i) <= 0) return;
      const cust = customers.find((c: any) => c.id === i.customerId);
      const proj = projects.find((p: any) => p.id === i.projectId);
      if (repFilter && (proj?.repId ?? cust?.repId) !== repFilter) return;
      if (regionFilter && !(cust?.regionId === regionFilter || proj?.regionId === regionFilter)) return;
      if (stageFilter && stageLabel !== stageFilter) return;
      const q = search.trim().toLowerCase();
      if (q && !(`${cust?.name ?? ""} ${proj?.name ?? ""} ${i.invoiceNumber ?? ""} ${i.billingEmail ?? cust?.email ?? ""}`.toLowerCase().includes(q))) return;
      const regionId = cust?.regionId ?? proj?.regionId;
      rows.push({
        inv: i,
        custId: i.customerId,
        custName: cust?.name ?? "—",
        projName: proj?.name ?? null,
        regionName: (regions ?? []).find((r: any) => r.id === regionId)?.name ?? null,
        repName: repName(proj?.repId ?? cust?.repId),
        stageLabel,
        bal: openBal(i),
        days: daysOverdue(i.dueDate),
        email: i.billingEmail || cust?.email || null,
        lastSent: lastSentByInv[i.id]?.at ?? null,
        lastRef: lastSentByInv[i.id]?.ref ?? null,
      });
    });
    // Disputes first, then promises, then by balance — most actionable on top
    rows.sort((a, b) => {
      const score = (r: BoardRow) => (r.inv.hasOpenDispute ? 2 : r.inv.promiseDate ? 1 : 0);
      const d = score(b) - score(a);
      return d !== 0 ? d : b.bal - a.bal;
    });
    return rows;
  }, [invoices, customers, projects, regions, stages, closedLabel, repFilter, regionFilter, stageFilter, search, lastSentByInv]);

  return (
    // h-screen would overshoot by the 44px app top bar and force a useless
    // outer scrollbar — size to the space the layout actually gives us.
    <div className="flex flex-col h-[calc(100vh-44px)]">
      {/* Header */}
      <div className="px-6 py-4 border-b border-stone-800 flex items-center justify-between bg-stone-950 flex-shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-white tracking-tight">Collections Board</h1>
          <p className="text-sm text-stone-400 mt-0.5">
            <CurrencyPills breakdown={totalByCurrency} /> · {Object.values(grouped).length} {groupBy === "customer" ? "customers" : "projects"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${groupBy === "customer" ? "customer" : "project"}…`}
              className="h-8 w-48 pl-7 pr-2 text-xs rounded-md border border-stone-700 bg-stone-800/60 text-stone-200 placeholder-stone-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          {/* Rep filter */}
          {(reps ?? []).length > 0 && (
            <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)}
              className="h-8 px-2 pr-6 text-xs rounded-md border border-stone-700 bg-stone-800/60 text-stone-200 appearance-none"
              style={{backgroundImage:`url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2378716c' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,backgroundRepeat:"no-repeat",backgroundPosition:"right 0.35rem center",backgroundSize:"12px"}}>
              <option value="">All reps</option>
              {(reps ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
          {/* Region filter */}
          <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)}
            className="h-8 px-2 pr-6 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-300 appearance-none"
            style={{backgroundImage:`url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,backgroundRepeat:"no-repeat",backgroundPosition:"right 0.35rem center",backgroundSize:"12px"}}>
            <option value="">All regions</option>
            {(regions ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          {/* Stage filter */}
          <select value={stageFilter || ""} onChange={(e) => setStageFilter(e.target.value || null)}
            className="h-8 px-2 pr-6 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-300 appearance-none"
            style={{backgroundImage:`url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,backgroundRepeat:"no-repeat",backgroundPosition:"right 0.35rem center",backgroundSize:"12px"}}>
            <option value="">All stages</option>
            {visibleLabels.map(s => <option key={s} value={s}>{s} ({byStage[s]?.length || 0})</option>)}
          </select>

          {/* Group by toggle — only meaningful in card view */}
          {viewMode === "cards" && (
            <div className="flex bg-stone-800 rounded-md p-0.5 border border-stone-700">
              <button onClick={() => setGroupBy("customer")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${groupBy === "customer" ? "bg-stone-600 text-white shadow-sm" : "text-stone-400 hover:text-stone-200"}`}>
                <Users size={12} /> Customers
              </button>
              <button onClick={() => setGroupBy("project")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${groupBy === "project" ? "bg-stone-600 text-white shadow-sm" : "text-stone-400 hover:text-stone-200"}`}>
                <Briefcase size={12} /> Projects
              </button>
            </div>
          )}

          {/* Cards / List view toggle */}
          <div className="flex bg-stone-800 rounded-md p-0.5 border border-stone-700">
            <button onClick={() => setViewMode("cards")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${viewMode === "cards" ? "bg-emerald-500 text-white shadow-sm" : "text-stone-400 hover:text-stone-200"}`}>
              <LayoutGrid size={12} /> Cards
            </button>
            <button onClick={() => setViewMode("list")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${viewMode === "list" ? "bg-emerald-500 text-white shadow-sm" : "text-stone-400 hover:text-stone-200"}`}>
              <ListIcon size={12} /> List
            </button>
          </div>
        </div>
      </div>

      {/* Board — card (entity) view */}
      {viewMode === "cards" && (
      <div className="flex-1 overflow-x-auto">
        <div className="flex gap-3 p-4 h-full" style={{ minWidth: `${visibleStages.length * 280}px` }}>
          {visibleStages.map(stage => {
            const items = byStage[stage] || [];
            const stageTotal = stageTotals[stage] || 0;
            const isDragOver = draggingOverStage === stage;

            return (
              <div key={stage}
                className={`w-68 flex-shrink-0 flex flex-col rounded-xl transition-colors ${isDragOver ? "bg-stone-700" : "bg-stone-900/60"} border border-stone-800`}
                style={{ width: "272px" }}
                onDragOver={(e) => { e.preventDefault(); setDraggingOverStage(stage); }}
                onDragLeave={() => setDraggingOverStage(null)}
                onDrop={() => handleDrop(stage)}>

                {/* Column header */}
                <div className="p-3 border-b border-stone-800 flex-shrink-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${STAGE_COLOR_CLASSES[stages.find(s => s.label === stage)?.color ?? "stone"]?.badge ?? "bg-stone-800 text-stone-300"}`}>{stage}</span>
                    <span className="text-[11px] text-stone-500 font-mono">{items.length}</span>
                  </div>
                  <CurrencyPills breakdown={stageCurrencyTotals[stage] || {}} className="text-sm font-semibold text-white tabular-nums" />
                  {totalAR > 0 && stageTotal > 0 && (
                    <div className="text-[10px] text-stone-500 mt-0.5">{(stageTotal / totalAR * 100).toFixed(1)}% of total AR</div>
                  )}
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-16">
                  {items.map(({ entity, invoices: entityInvoices, outstanding }) => (
                    <CollectionCard
                      key={entity.id}
                      entity={entity}
                      invoices={entityInvoices}
                      href={groupBy === "customer" ? `/customers/${entity.id}` : `/projects/${entity.id}`}
                      updateInvoice={updateInvoice}
                      draggingId={draggingId}
                      setDraggingId={setDraggingId}
                      stages={stages}
                      repName={repName(entity.repId)}
                    />
                  ))}
                  {items.length === 0 && (
                    <div className={`text-xs text-stone-600 text-center py-6 rounded-lg border-2 border-dashed transition-colors ${isDragOver ? "border-stone-500 text-stone-400" : "border-stone-800"}`}>
                      {isDragOver ? "Drop here" : "No items"}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* Invoice-level List view — editable, bulk-action grid */}
      {viewMode === "list" && (
        <div className="flex-1 min-h-0">
        <BoardList
          rows={openInvoiceRows}
          stages={stages}
          updateInvoice={updateInvoice}
          refresh={refresh}
          toast={toast}
          comments={communications ?? []}
          orgName={orgSettings?.displayName ?? orgSettings?.name}
          orgLogoUrl={orgSettings?.logoUrl}
          isGroup={orgScope.isGroup}
          orgNames={orgScope.orgNames}
        />
        </div>
      )}

      {/* Legend */}
      <div className="px-6 py-2 border-t border-stone-800 bg-stone-950 flex-shrink-0 flex items-center gap-6">
        <span className="text-[11px] text-stone-500 font-medium uppercase tracking-wider">Aging</span>
        {AGING_COLORS.map(({ label, color }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded ${color}`} />
            <span className="text-[11px] text-stone-400">{label}</span>
          </div>
        ))}
        <span className="text-[11px] text-stone-600 ml-4">Drag a card to move all its open invoices to a new stage</span>
      </div>
    </div>
  );
}
