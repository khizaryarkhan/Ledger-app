"use client";

import { useEffect, useState, useMemo, useCallback, useRef, Fragment } from "react";
import Link from "next/link";
import { FileInput, Loader2, Search, ArrowLeft, CheckCircle2, XCircle } from "lucide-react";

interface Line { index: number; item: string; description: string; estAmount: number; }
interface Est { id: string; number: string; customer: string; project: string; memo: string; date: string; currency: string; status: string; total: number; lines: Line[]; }

const STATUS_ORDER = ["Accepted", "Pending", "Closed", "Rejected", "(Blank)"];
const DEFAULT_STATUSES = ["Accepted", "Pending", "(Blank)"]; // hide Closed/Rejected by default

const selCls = "h-9 px-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-200 focus:border-amber-500 focus:outline-none";
const num2 = (n: number) => (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round(n * 100) / 100;

export default function InvoiceWorksheetPage() {
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set(DEFAULT_STATUSES));
  const [ests, setEsts] = useState<Est[]>([]);
  const [loading, setLoading] = useState(true);
  const [hydrating, setHydrating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [startInvoiceNo, setStartInvoiceNo] = useState("");
  const [globalPct, setGlobalPct] = useState("");

  const [invoiced, setInvoiced] = useState<Record<string, number[]>>({});
  const [pcts, setPcts] = useState<Record<string, string>>({});   // estId → "% to be invoiced"
  const hydratedRef = useRef<Set<string>>(new Set());

  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ processed: number; total: number; successCount: number; errorCount: number } | null>(null);
  const [result, setResult] = useState<any>(null);
  const pollTimer = useRef<any>(null);
  useEffect(() => () => { if (pollTimer.current) clearTimeout(pollTimer.current); }, []);

  const load = useCallback(() => {
    setLoading(true); setError(null); setResult(null); setJobId(null); setProgress(null);
    hydratedRef.current = new Set();
    fetch(`/api/batch/estimates/worksheet`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setEsts(d.estimates || []); setInvoiced({}); setPcts({});
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Status counts + list for the PBI-style filter.
  const statusCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of ests) m[e.status] = (m[e.status] || 0) + 1;
    return m;
  }, [ests]);
  const statusList = useMemo(() => {
    const known = STATUS_ORDER.filter((s) => statusCounts[s] != null);
    const extra = Object.keys(statusCounts).filter((s) => !STATUS_ORDER.includes(s)).sort();
    return [...known, ...extra];
  }, [statusCounts]);

  const statusFiltered = useMemo(() => ests.filter((e) => selectedStatuses.has(e.status)), [ests, selectedStatuses]);

  // Hydrate already-invoiced only for the estimates currently shown (by status),
  // in chunks, so selecting "Closed" (hundreds) doesn't block and we never
  // re-fetch the same estimate twice.
  useEffect(() => {
    const need = statusFiltered.map((e) => e.id).filter((id) => !hydratedRef.current.has(id));
    if (need.length === 0) return;
    need.forEach((id) => hydratedRef.current.add(id));
    (async () => {
      setHydrating(true);
      try {
        for (let i = 0; i < need.length; i += 100) {
          const chunk = need.slice(i, i + 100);
          const r = await fetch("/api/batch/estimates/invoiced", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: chunk }) });
          const d = await r.json();
          if (r.ok && d.invoiced) setInvoiced((prev) => ({ ...prev, ...d.invoiced }));
        }
      } catch { /* grid still usable */ } finally { setHydrating(false); }
    })();
  }, [statusFiltered]);

  function toggleStatus(s: string) {
    setSelectedStatuses((prev) => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });
  }

  const visible = useMemo(() => {
    const query = q.trim().toLowerCase();
    return query ? statusFiltered.filter((e) => `${e.number} ${e.customer} ${e.project} ${e.memo}`.toLowerCase().includes(query)) : statusFiltered;
  }, [statusFiltered, q]);

  const invoicedTotalOf = (e: Est) => (invoiced[e.id] || []).reduce((s, n) => s + (n || 0), 0);
  const progressOf = (e: Est) => (e.total ? Math.round((invoicedTotalOf(e) / e.total) * 10000) / 100 : 0);

  // Group: Customer → Project → estimates
  const grouped = useMemo(() => {
    const byCust = new Map<string, Map<string, Est[]>>();
    for (const e of visible) {
      if (!byCust.has(e.customer)) byCust.set(e.customer, new Map());
      const byProj = byCust.get(e.customer)!;
      const pk = e.project || "";
      if (!byProj.has(pk)) byProj.set(pk, []);
      byProj.get(pk)!.push(e);
    }
    return byCust;
  }, [visible]);

  // Build the invoice-batch items from each estimate's % (capped at remaining per line).
  const staged = useMemo(() => {
    const items: any[] = [];
    for (const e of ests) {
      const pct = parseFloat(pcts[e.id] ?? "");
      if (isNaN(pct) || pct <= 0) continue;
      const already = invoiced[e.id] || [];
      const lines = e.lines
        .map((l) => {
          const rem = round2(l.estAmount - (already[l.index] || 0));
          const amt = Math.min(round2(l.estAmount * pct / 100), Math.max(0, rem));
          return { index: l.index, amount: round2(amt) };
        })
        .filter((l) => l.amount > 0.005);
      if (lines.length) items.push({ estimateId: e.id, estimateNumber: e.number, lines });
    }
    return items;
  }, [ests, pcts, invoiced]);

  const resultByEst = useMemo(() => {
    const m: Record<string, { ok: boolean; docNumber?: string; error?: string }> = {};
    for (const r of (result?.results || [])) if (r.estimate) m[String(r.estimate)] = r;
    return m;
  }, [result]);

  function applyGlobalPct() {
    const pct = globalPct.trim();
    if (!pct) return;
    setPcts(() => { const next: Record<string, string> = {}; for (const e of visible) next[e.id] = pct; return next; });
  }

  const lastStagedRef = useRef<string[]>([]);

  async function rehydrate(ids: string[]) {
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const r = await fetch("/api/batch/estimates/invoiced", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: chunk }) }).catch(() => null);
      if (r?.ok) { const d = await r.json(); if (d.invoiced) setInvoiced((prev) => ({ ...prev, ...d.invoiced })); }
    }
  }

  async function createAll() {
    if (staged.length === 0) { setError("Enter a % to invoice on at least one estimate."); return; }
    setError(null); setResult(null);
    lastStagedRef.current = staged.map((s: any) => s.estimateId);
    try {
      const res = await fetch("/api/batch/estimates/invoice-batch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: staged, invoiceDate: invoiceDate || undefined, startInvoiceNo: startInvoiceNo.trim() || undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to queue");
      setJobId(d.jobId); setProgress({ processed: 0, total: d.total, successCount: 0, errorCount: 0 }); poll(d.jobId);
    } catch (e: any) { setError(e.message); }
  }

  function poll(id: string) {
    const tick = async () => {
      try {
        const r = await fetch(`/api/batch/jobs/${id}`);
        const j = await r.json();
        if (r.ok) {
          setProgress({ processed: j.processed, total: j.totalRows, successCount: j.successCount, errorCount: j.errorCount });
          if (j.status === "done" || j.status === "failed") { setResult(j); setTimeout(() => rehydrate(lastStagedRef.current), 600); return; }
        }
      } catch { /* keep polling */ }
      pollTimer.current = setTimeout(tick, 1500);
    };
    tick();
  }

  const running = !!jobId && !result;
  const cols = 8;

  return (
    <div className="p-6 max-w-7xl">
      <Link href="/batch/e/estimateinvoice" className="inline-flex items-center gap-1.5 text-[13px] text-stone-400 hover:text-stone-200 mb-4"><ArrowLeft size={14} /> Back</Link>
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center"><FileInput size={18} className="text-amber-400" /></div>
        <h1 className="text-xl font-semibold text-stone-100">Invoice from Estimates</h1>
      </div>
      <p className="text-sm text-stone-400 mb-4 ml-12">Enter the % to invoice against each estimate, then create every invoice in one go — linked to its estimate.</p>

      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error}</div>}

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className={`${selCls} pl-8 w-48`} />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {statusList.map((s) => (
            <button key={s} onClick={() => toggleStatus(s)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[12px] transition-colors ${selectedStatuses.has(s) ? "border-amber-500/50 bg-amber-500/10 text-amber-200" : "border-stone-700 text-stone-400 hover:bg-stone-800"}`}>
              {s} <span className="text-stone-500 tabular-nums">{statusCounts[s]}</span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-[12px] text-stone-400">Date<input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className={selCls} /></label>
        <label className="flex items-center gap-1.5 text-[12px] text-stone-400">Start #<input value={startInvoiceNo} onChange={(e) => setStartInvoiceNo(e.target.value)} placeholder="auto" className={`${selCls} w-24`} /></label>
        <div className="flex items-center gap-1.5">
          <input value={globalPct} onChange={(e) => setGlobalPct(e.target.value)} inputMode="decimal" placeholder="%" className={`${selCls} w-16 text-right`} />
          <button onClick={applyGlobalPct} className="px-2.5 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-[13px]">Apply % to all</button>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {hydrating && <span className="text-[12px] text-stone-500 inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> loading invoiced…</span>}
          <button onClick={createAll} disabled={running || staged.length === 0} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium disabled:opacity-40">
            {running ? <Loader2 size={15} className="animate-spin" /> : <FileInput size={15} />} Create {staged.length} invoice{staged.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>

      {progress && (
        <div className="mb-3 max-w-lg">
          {!result ? (
            <div className="flex items-center gap-3">
              <div className="h-2 flex-1 rounded-full bg-stone-800 overflow-hidden"><div className="h-full bg-amber-500 transition-all" style={{ width: `${progress.total ? Math.round((progress.processed / progress.total) * 100) : 0}%` }} /></div>
              <span className="text-[12px] text-stone-500 tabular-nums">{progress.processed}/{progress.total}</span>
            </div>
          ) : (
            <div className="flex gap-4 text-sm">
              <span className="inline-flex items-center gap-1.5 text-emerald-400"><CheckCircle2 size={15} /> {result.successCount} created</span>
              {result.errorCount > 0 && <span className="inline-flex items-center gap-1.5 text-rose-400"><XCircle size={15} /> {result.errorCount} failed</span>}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-stone-500 py-12">Loading estimates…</div>
      ) : visible.length === 0 ? (
        <div className="text-sm text-stone-500 py-12 text-center">No estimates found. They sync from QuickBooks — try the “Any” status filter.</div>
      ) : (
        <div className="border border-stone-800 rounded-lg overflow-x-auto">
          <table className="w-full text-[13px] min-w-[1000px]">
            <thead className="sticky top-0 bg-stone-950 z-10">
              <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                <th className="text-left px-3 py-2 font-semibold">Estimate</th>
                <th className="text-left px-3 py-2 font-semibold">Memo</th>
                <th className="text-left px-3 py-2 font-semibold">Cur</th>
                <th className="text-left px-3 py-2 font-semibold">Date</th>
                <th className="text-right px-3 py-2 font-semibold">Estimate Amount</th>
                <th className="text-right px-3 py-2 font-semibold">Invoiced Amount</th>
                <th className="text-right px-3 py-2 font-semibold">% Progress</th>
                <th className="text-right px-3 py-2 font-semibold w-32">% To be Invoiced</th>
              </tr>
            </thead>
            <tbody>
              {[...grouped.entries()].map(([customer, byProj]) => (
                <Fragment key={customer}>
                  <tr className="bg-stone-900/80"><td colSpan={cols} className="px-3 py-1.5 text-stone-100 font-semibold border-t border-stone-800">{customer}</td></tr>
                  {[...byProj.entries()].map(([proj, list]) => (
                    <Fragment key={proj || "_"}>
                      {proj && <tr className="bg-stone-900/40"><td colSpan={cols} className="px-3 py-1 pl-6 text-stone-400 text-[12px] border-t border-stone-800/50">{proj}</td></tr>}
                      {list.map((e) => {
                        const inv = invoicedTotalOf(e);
                        const prog = progressOf(e);
                        const res = resultByEst[e.number];
                        return (
                          <tr key={e.id} className="border-t border-stone-800/40 hover:bg-stone-800/20">
                            <td className="px-3 py-1.5 pl-8 text-stone-200 whitespace-nowrap">
                              {e.number}
                              {res && (res.ok
                                ? <span className="ml-2 text-[11px] text-emerald-400">→ {res.docNumber || "created"}</span>
                                : <span className="ml-2 text-[11px] text-rose-400" title={res.error}>failed</span>)}
                            </td>
                            <td className="px-3 py-1.5 text-stone-400 truncate max-w-[360px]">{e.memo}</td>
                            <td className="px-3 py-1.5 text-stone-500">{e.currency}</td>
                            <td className="px-3 py-1.5 text-stone-500 whitespace-nowrap">{e.date}</td>
                            <td className="px-3 py-1.5 text-right text-stone-300 tabular-nums">{num2(e.total)}</td>
                            <td className="px-3 py-1.5 text-right text-emerald-400/70 tabular-nums">{inv ? num2(inv) : ""}</td>
                            <td className="px-3 py-1.5 text-right text-stone-400 tabular-nums">{inv ? `${prog.toFixed(2)}%` : ""}</td>
                            <td className="px-3 py-1.5 text-right">
                              <div className="inline-flex items-center gap-0.5">
                                <input value={pcts[e.id] ?? ""} onChange={(ev) => setPcts((p) => ({ ...p, [e.id]: ev.target.value }))} inputMode="decimal" placeholder="0"
                                  className="h-7 w-20 px-2 text-right text-[13px] rounded border border-stone-700 bg-stone-800/60 text-stone-100 focus:border-amber-500 focus:outline-none" />
                                <span className="text-stone-500 text-[12px]">%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
