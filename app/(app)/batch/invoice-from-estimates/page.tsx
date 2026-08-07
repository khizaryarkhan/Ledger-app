"use client";

import { useEffect, useState, useMemo, useCallback, useRef, Fragment } from "react";
import Link from "next/link";
import { FileInput, Loader2, Search, ArrowLeft, CheckCircle2, XCircle, ChevronRight, ChevronDown } from "lucide-react";

interface Line { index: number; item: string; description: string; estAmount: number; }
interface Est { id: string; number: string; customer: string; project: string; memo: string; date: string; currency: string; status: string; total: number; lines: Line[]; }

const STATUS_ORDER = ["Accepted", "Converted", "Pending", "Closed", "Rejected", "(Blank)"];
// Hide a project when EVERY estimate is one of these (no live/invoiceable work).
const HIDE_ALONE = new Set(["Closed", "Pending", "Rejected"]);
// Excluded from the default row view (chips can re-add).
const HIDE_ROWS = ["Pending", "Rejected"];

const selCls = "h-9 px-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-200 focus:border-amber-500 focus:outline-none";
const num2 = (n: number) => (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round(n * 100) / 100;

// Parse a "% or value" cell → an amount, capped at the line's remaining.
function parseAmt(raw: string | undefined, estAmount: number, remaining: number): number {
  const s = (raw ?? "").trim();
  if (!s) return 0;
  let amt: number;
  if (s.endsWith("%")) { const p = parseFloat(s.slice(0, -1)); if (isNaN(p)) return 0; amt = estAmount * p / 100; }
  else { const v = parseFloat(s.replace(/[^0-9.\-]/g, "")); if (isNaN(v)) return 0; amt = v; }
  return Math.min(Math.max(0, round2(amt)), Math.max(0, round2(remaining)));
}

export default function InvoiceWorksheetPage() {
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set());
  const [onlyQualified, setOnlyQualified] = useState(true);
  const [ests, setEsts] = useState<Est[]>([]);
  const [loading, setLoading] = useState(true);
  const [hydrating, setHydrating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [startInvoiceNo, setStartInvoiceNo] = useState("");
  const [globalVal, setGlobalVal] = useState("");

  const [invoiced, setInvoiced] = useState<Record<string, number[]>>({});
  const [estRaw, setEstRaw] = useState<Record<string, string>>({});                    // estId → "% or value" text
  const [lineRaw, setLineRaw] = useState<Record<string, Record<number, string>>>({});  // estId → idx → text
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const hydratedRef = useRef<Set<string>>(new Set());

  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<any>(null);

  const load = useCallback(() => {
    setLoading(true); setError(null); setResult(null);
    hydratedRef.current = new Set();
    fetch(`/api/batch/estimates/worksheet`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        const list: Est[] = d.estimates || [];
        setEsts(list); setInvoiced({}); setEstRaw({}); setLineRaw({}); setExpanded(new Set());
        const present = new Set(list.map((e) => e.status));
        HIDE_ROWS.forEach((s) => present.delete(s));
        setSelectedStatuses(present);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

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

  const qualifiedProjects = useMemo(() => {
    const s = new Set<string>();
    for (const e of ests) if (!HIDE_ALONE.has(e.status)) s.add(`${e.customer}|||${e.project}`);
    return s;
  }, [ests]);

  const statusFiltered = useMemo(
    () => ests.filter((e) => selectedStatuses.has(e.status) && (!onlyQualified || qualifiedProjects.has(`${e.customer}|||${e.project}`))),
    [ests, selectedStatuses, onlyQualified, qualifiedProjects],
  );

  useEffect(() => {
    const need = statusFiltered.map((e) => e.id).filter((id) => !hydratedRef.current.has(id));
    if (need.length === 0) return;
    need.forEach((id) => hydratedRef.current.add(id));
    (async () => {
      setHydrating(true);
      try {
        for (let i = 0; i < need.length; i += 100) {
          const r = await fetch("/api/batch/estimates/invoiced", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: need.slice(i, i + 100) }) });
          const d = await r.json();
          if (r.ok && d.invoiced) setInvoiced((prev) => ({ ...prev, ...d.invoiced }));
        }
      } catch { /* usable */ } finally { setHydrating(false); }
    })();
  }, [statusFiltered]);

  const toggleStatus = (s: string) => setSelectedStatuses((p) => { const n = new Set(p); n.has(s) ? n.delete(s) : n.add(s); return n; });

  const visible = useMemo(() => {
    const query = q.trim().toLowerCase();
    return query ? statusFiltered.filter((e) => `${e.number} ${e.customer} ${e.project} ${e.memo}`.toLowerCase().includes(query)) : statusFiltered;
  }, [statusFiltered, q]);

  const invoicedTotalOf = (e: Est) => (invoiced[e.id] || []).reduce((s, n) => s + (n || 0), 0);
  const progressOf = (e: Est) => (e.total ? Math.round((invoicedTotalOf(e) / e.total) * 10000) / 100 : 0);
  const alreadyLine = (estId: string, idx: number) => invoiced[estId]?.[idx] || 0;
  const remLine = (e: Est, l: Line) => round2(l.estAmount - alreadyLine(e.id, l.index));
  const lineAmt = (e: Est, l: Line) => parseAmt(lineRaw[e.id]?.[l.index], l.estAmount, remLine(e, l));
  const estToInvoice = (e: Est) => e.lines.reduce((s, l) => s + lineAmt(e, l), 0);

  // Estimate-level "% or value" quick-fill → writes each line's cell.
  function setEstInput(e: Est, raw: string) {
    setEstRaw((r) => ({ ...r, [e.id]: raw }));
    const s = raw.trim();
    setLineRaw((prev) => {
      const next = { ...prev, [e.id]: { ...(prev[e.id] || {}) } };
      if (!s) { for (const l of e.lines) next[e.id][l.index] = ""; return next; }
      if (s.endsWith("%")) { for (const l of e.lines) next[e.id][l.index] = s; return next; }
      // Plain value → distribute across each line's remaining.
      const rems = e.lines.map((l) => Math.max(0, remLine(e, l)));
      const totalRem = rems.reduce((a, b) => a + b, 0);
      const v = parseFloat(s.replace(/[^0-9.\-]/g, "")) || 0;
      e.lines.forEach((l, i) => {
        const share = totalRem > 0 ? Math.min(round2(v * rems[i] / totalRem), rems[i]) : 0;
        next[e.id][l.index] = share > 0.005 ? String(share) : "";
      });
      return next;
    });
  }
  const setLineInput = (estId: string, idx: number, raw: string) =>
    setLineRaw((p) => ({ ...p, [estId]: { ...(p[estId] || {}), [idx]: raw } }));
  const toggleExpand = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const staged = useMemo(() => {
    const items: any[] = [];
    for (const e of ests) {
      const lines = e.lines.map((l) => ({ index: l.index, amount: lineAmt(e, l) })).filter((l) => l.amount > 0.005);
      if (lines.length) items.push({ estimateId: e.id, estimateNumber: e.number, lines });
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ests, lineRaw, invoiced]);

  const resultByEst = useMemo(() => {
    const m: Record<string, { ok: boolean; docNumber?: string; error?: string }> = {};
    for (const r of (result?.results || [])) if (r.estimate) m[String(r.estimate)] = r;
    return m;
  }, [result]);

  function applyGlobal() {
    const s = globalVal.trim();
    if (!s) return;
    for (const e of visible) setEstInput(e, s);
  }

  async function rehydrate(ids: string[]) {
    for (let i = 0; i < ids.length; i += 100) {
      const r = await fetch("/api/batch/estimates/invoiced", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: ids.slice(i, i + 100) }) }).catch(() => null);
      if (r?.ok) { const d = await r.json(); if (d.invoiced) setInvoiced((prev) => ({ ...prev, ...d.invoiced })); }
    }
  }

  async function createAll() {
    if (staged.length === 0) { setError("Enter a % or amount on at least one estimate."); return; }
    setError(null); setResult(null); setCreating(true);
    const ids = staged.map((s: any) => s.estimateId);
    try {
      const res = await fetch("/api/batch/estimates/invoice-batch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: staged, invoiceDate: invoiceDate || undefined, startInvoiceNo: startInvoiceNo.trim() || undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to create invoices");
      setResult(d);
      setEstRaw({}); setLineRaw({});   // clear inputs; created amounts are done
      rehydrate(ids);
    } catch (e: any) { setError(e.message); } finally { setCreating(false); }
  }

  const cols = 8;

  return (
    <div className="p-6 max-w-7xl">
      <Link href="/batch/e/estimateinvoice" className="inline-flex items-center gap-1.5 text-[13px] text-stone-400 hover:text-stone-200 mb-4"><ArrowLeft size={14} /> Back</Link>
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center"><FileInput size={18} className="text-amber-400" /></div>
        <h1 className="text-xl font-semibold text-stone-100">Invoice from Estimates</h1>
      </div>
      <p className="text-sm text-stone-400 mb-4 ml-12">Enter a % or an amount to invoice against each estimate (or expand to bill specific lines), then create every invoice — each linked to its estimate.</p>

      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error}</div>}

      <div className="flex items-center gap-3 flex-wrap mb-3">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className={`${selCls} pl-8 w-44`} />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {statusList.map((s) => (
            <button key={s} onClick={() => toggleStatus(s)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[12px] transition-colors ${selectedStatuses.has(s) ? "border-amber-500/50 bg-amber-500/10 text-amber-200" : "border-stone-700 text-stone-400 hover:bg-stone-800"}`}>
              {s} <span className="text-stone-500 tabular-nums">{statusCounts[s]}</span>
            </button>
          ))}
        </div>
        <button onClick={() => setOnlyQualified((v) => !v)} title="Hide projects where every estimate is Closed, Pending or Rejected"
          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[12px] transition-colors ${onlyQualified ? "border-amber-500/50 bg-amber-500/10 text-amber-200" : "border-stone-700 text-stone-400 hover:bg-stone-800"}`}>
          {onlyQualified ? <CheckCircle2 size={13} /> : <span className="w-[13px]" />} Invoiceable projects only
        </button>
        <label className="flex items-center gap-1.5 text-[12px] text-stone-400">Date<input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className={selCls} /></label>
        <label className="flex items-center gap-1.5 text-[12px] text-stone-400">Start #<input value={startInvoiceNo} onChange={(e) => setStartInvoiceNo(e.target.value)} placeholder="auto" className={`${selCls} w-24`} /></label>
        <div className="flex items-center gap-1.5">
          <input value={globalVal} onChange={(e) => setGlobalVal(e.target.value)} placeholder="% or £" className={`${selCls} w-20 text-right`} />
          <button onClick={applyGlobal} className="px-2.5 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-[13px]">Apply to all</button>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {hydrating && <span className="text-[12px] text-stone-500 inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> loading invoiced…</span>}
          <button onClick={createAll} disabled={creating || staged.length === 0} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium disabled:opacity-40">
            {creating ? <Loader2 size={15} className="animate-spin" /> : <FileInput size={15} />} Create {staged.length} invoice{staged.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>

      {result && (
        <div className="mb-3">
          <div className="flex gap-4 text-sm mb-1.5">
            <span className="inline-flex items-center gap-1.5 text-emerald-400"><CheckCircle2 size={15} /> {result.successCount} created</span>
            {result.errorCount > 0 && <span className="inline-flex items-center gap-1.5 text-rose-400"><XCircle size={15} /> {result.errorCount} failed</span>}
          </div>
          {(result.results || []).filter((r: any) => !r.ok).length > 0 && (
            <ul className="text-[12px] text-rose-300/90 space-y-0.5 border border-rose-500/25 bg-rose-500/5 rounded-md px-3 py-2 max-h-52 overflow-y-auto mb-1.5">
              {(result.results || []).filter((r: any) => !r.ok).map((r: any, i: number) => (
                <li key={i}><span className="text-rose-400 font-medium">{r.estimate || `Row ${r.row}`}:</span> {r.error}</li>
              ))}
            </ul>
          )}
          {(result.results || []).filter((r: any) => r.ok).length > 0 && (
            <ul className="text-[12px] space-y-0.5 border border-stone-700/60 bg-stone-800/30 rounded-md px-3 py-2 max-h-52 overflow-y-auto">
              {(result.results || []).filter((r: any) => r.ok).map((r: any, i: number) => (
                <li key={i} className="text-stone-300">
                  <span className="text-stone-100 font-medium">{r.estimate || `Row ${r.row}`}</span> → invoice {r.docNumber || r.qboId}{" "}
                  {r.linkedToEstimate
                    ? <span className="text-emerald-400">· linked to estimate ✓</span>
                    : <span className="text-amber-400">· NOT linked ✗</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-stone-500 py-12">Loading estimates…</div>
      ) : visible.length === 0 ? (
        <div className="text-sm text-stone-500 py-12 text-center">No estimates found. They sync from QuickBooks — try toggling the status chips or “Invoiceable projects only”.</div>
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
                <th className="text-right px-3 py-2 font-semibold w-40">% or Amount</th>
              </tr>
            </thead>
            <tbody>
              {[...grouped(visible).entries()].map(([customer, byProj]) => (
                <Fragment key={customer}>
                  <tr className="bg-stone-900/80"><td colSpan={cols} className="px-3 py-1.5 text-stone-100 font-semibold border-t border-stone-800">{customer}</td></tr>
                  {[...byProj.entries()].map(([proj, list]) => (
                    <Fragment key={proj || "_"}>
                      {proj && <tr className="bg-stone-900/40"><td colSpan={cols} className="px-3 py-1 pl-6 text-stone-400 text-[12px] border-t border-stone-800/50">{proj}</td></tr>}
                      {list.map((e) => {
                        const inv = invoicedTotalOf(e);
                        const prog = progressOf(e);
                        const res = resultByEst[e.number];
                        const multi = e.lines.length > 1;
                        const isOpen = multi && expanded.has(e.id);
                        const toInv = estToInvoice(e);
                        return (
                          <Fragment key={e.id}>
                            <tr className="border-t border-stone-800/40 hover:bg-stone-800/20">
                              <td className="px-3 py-1.5 pl-6 text-stone-200 whitespace-nowrap">
                                {multi ? (
                                  <button onClick={() => toggleExpand(e.id)} className="inline-flex items-center gap-1 hover:text-amber-300">
                                    {isOpen ? <ChevronDown size={13} className="text-stone-500" /> : <ChevronRight size={13} className="text-stone-500" />}
                                    <span>{e.number}</span><span className="text-[10px] text-stone-500">({e.lines.length})</span>
                                  </button>
                                ) : <span className="pl-[18px] inline-block">{e.number}</span>}
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
                                <div className="inline-flex flex-col items-end">
                                  <input value={estRaw[e.id] ?? ""} onChange={(ev) => setEstInput(e, ev.target.value)} placeholder="% or £"
                                    className="h-7 w-24 px-2 text-right text-[13px] rounded border border-stone-700 bg-stone-800/60 text-stone-100 focus:border-amber-500 focus:outline-none" />
                                  {toInv > 0.005 && <span className="text-[11px] text-amber-400/80 mt-0.5">= {num2(toInv)}</span>}
                                </div>
                              </td>
                            </tr>
                            {isOpen && e.lines.map((l) => (
                              <tr key={`${e.id}-${l.index}`} className="bg-stone-900/30 border-t border-stone-800/30 text-[12px]">
                                <td className="px-3 py-1 pl-12 text-stone-600">Line {l.index + 1}</td>
                                <td className="px-3 py-1 text-stone-400 truncate max-w-[360px]">{l.description || l.item || "—"}</td>
                                <td className="px-3 py-1"></td>
                                <td className="px-3 py-1"></td>
                                <td className="px-3 py-1 text-right text-stone-500 tabular-nums">{num2(l.estAmount)}</td>
                                <td className="px-3 py-1 text-right text-emerald-400/60 tabular-nums">{alreadyLine(e.id, l.index) ? num2(alreadyLine(e.id, l.index)) : ""}</td>
                                <td className="px-3 py-1 text-right text-sky-400/80 tabular-nums">{num2(remLine(e, l))}</td>
                                <td className="px-3 py-1 text-right">
                                  <input value={lineRaw[e.id]?.[l.index] ?? ""} onChange={(ev) => setLineInput(e.id, l.index, ev.target.value)} placeholder="% or £"
                                    className="h-7 w-24 px-2 text-right text-[12px] rounded border border-stone-700 bg-stone-800/60 text-stone-100 focus:border-amber-500 focus:outline-none" />
                                </td>
                              </tr>
                            ))}
                          </Fragment>
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

// Group visible estimates: Customer → Project → estimates.
function grouped(visible: Est[]): Map<string, Map<string, Est[]>> {
  const byCust = new Map<string, Map<string, Est[]>>();
  for (const e of visible) {
    if (!byCust.has(e.customer)) byCust.set(e.customer, new Map());
    const byProj = byCust.get(e.customer)!;
    const pk = e.project || "";
    if (!byProj.has(pk)) byProj.set(pk, []);
    byProj.get(pk)!.push(e);
  }
  return byCust;
}
