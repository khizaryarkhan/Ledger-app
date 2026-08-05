"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { FileInput, Loader2, Search, ArrowLeft, CheckCircle2, XCircle, Wand2 } from "lucide-react";

interface Line { index: number; item: string; description: string; qty: number | null; rate: number | null; estAmount: number; }
interface Est { id: string; number: string; customer: string; date: string; currency: string; total: number; lines: Line[]; }

const selCls = "h-9 px-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-200 focus:border-amber-500 focus:outline-none";
const cell = "h-7 px-2 text-right text-[13px] rounded border border-stone-700 bg-stone-800/60 text-stone-100 focus:border-amber-500 focus:outline-none";
const money = (n: number, ccy: string) => `${ccy ? ccy + " " : ""}${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

export default function InvoiceWorksheetPage() {
  const [status, setStatus] = useState("Open");
  const [ests, setEsts] = useState<Est[]>([]);
  const [loading, setLoading] = useState(true);
  const [hydrating, setHydrating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [startInvoiceNo, setStartInvoiceNo] = useState("");
  const [globalPct, setGlobalPct] = useState("");
  const [customTxn, setCustomTxn] = useState(false);

  const [invoiced, setInvoiced] = useState<Record<string, number[]>>({});   // estId → already[] per line
  const [amounts, setAmounts] = useState<Record<string, Record<number, string>>>({});

  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ status: string; processed: number; total: number; successCount: number; errorCount: number } | null>(null);
  const [result, setResult] = useState<any>(null);
  const pollTimer = useRef<any>(null);
  useEffect(() => () => { if (pollTimer.current) clearTimeout(pollTimer.current); }, []);

  const load = useCallback(() => {
    setLoading(true); setError(null); setResult(null); setJobId(null); setProgress(null);
    fetch(`/api/batch/estimates/worksheet?status=${encodeURIComponent(status)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        const list: Est[] = d.estimates || [];
        setEsts(list);
        setInvoiced({}); setAmounts({});   // amounts start EMPTY
        if (list.length) hydrate(list.map((e) => e.id), list);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [status]);
  useEffect(() => { load(); }, [load]);

  async function hydrate(ids: string[], _list: Est[]) {
    setHydrating(true);
    try {
      const r = await fetch("/api/batch/estimates/invoiced", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }),
      });
      const d = await r.json();
      if (r.ok) { setInvoiced(d.invoiced || {}); setCustomTxn(!!d.customTxnNumbers); }
    } catch { /* grid still usable */ } finally { setHydrating(false); }
  }

  const visible = useMemo(() => {
    const query = q.trim().toLowerCase();
    return query ? ests.filter((e) => `${e.number} ${e.customer}`.toLowerCase().includes(query)) : ests;
  }, [ests, q]);

  const alreadyOf = (estId: string, l: Line) => invoiced[estId]?.[l.index] || 0;
  const remainingOf = (estId: string, l: Line) => round2(l.estAmount - alreadyOf(estId, l));
  const progressOf = (estId: string, l: Line) => (l.estAmount ? Math.round((alreadyOf(estId, l) / l.estAmount) * 100) : 0);
  const setAmt = (estId: string, idx: number, v: string) => setAmounts((a) => ({ ...a, [estId]: { ...(a[estId] || {}), [idx]: v } }));

  // "Invoice to %" — bill up to this cumulative % of the estimate line.
  function setPct(est: Est, l: Line, pctStr: string) {
    const pct = parseFloat(pctStr);
    if (isNaN(pct)) { setAmt(est.id, l.index, ""); return; }
    const target = round2(l.estAmount * pct / 100 - alreadyOf(est.id, l));
    setAmt(est.id, l.index, target > 0 ? String(target) : "");
  }
  function applyGlobalPct() {
    const pct = parseFloat(globalPct);
    if (isNaN(pct)) return;
    setAmounts((a) => {
      const next = { ...a };
      for (const e of visible) {
        next[e.id] = { ...(next[e.id] || {}) };
        for (const l of e.lines) {
          const target = round2(l.estAmount * pct / 100 - alreadyOf(e.id, l));
          next[e.id][l.index] = target > 0 ? String(target) : "";
        }
      }
      return next;
    });
  }
  function fillAllRemaining() {
    setAmounts((a) => {
      const next = { ...a };
      for (const e of visible) {
        next[e.id] = { ...(next[e.id] || {}) };
        for (const l of e.lines) { const rem = remainingOf(e.id, l); next[e.id][l.index] = rem > 0 ? String(rem) : ""; }
      }
      return next;
    });
  }

  const staged = useMemo(() => {
    const items: any[] = [];
    for (const e of ests) {
      const lines = e.lines
        .map((l) => ({ index: l.index, amount: parseFloat(amounts[e.id]?.[l.index] ?? "") }))
        .filter((l) => !isNaN(l.amount) && l.amount !== 0);
      if (lines.length) items.push({ estimateId: e.id, estimateNumber: e.number, lines });
    }
    return items;
  }, [ests, amounts]);

  const resultByEst = useMemo(() => {
    const m: Record<string, { ok: boolean; docNumber?: string; error?: string }> = {};
    for (const r of (result?.results || [])) if (r.estimate) m[String(r.estimate)] = r;
    return m;
  }, [result]);

  async function createAll() {
    if (staged.length === 0) { setError("Enter an amount (or %) on at least one estimate."); return; }
    setError(null); setResult(null);
    try {
      const res = await fetch("/api/batch/estimates/invoice-batch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: staged, invoiceDate: invoiceDate || undefined, startInvoiceNo: startInvoiceNo.trim() || undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to queue");
      setJobId(d.jobId);
      setProgress({ status: "queued", processed: 0, total: d.total, successCount: 0, errorCount: 0 });
      poll(d.jobId);
    } catch (e: any) { setError(e.message); }
  }

  function poll(id: string) {
    const tick = async () => {
      try {
        const r = await fetch(`/api/batch/jobs/${id}`);
        const j = await r.json();
        if (r.ok) {
          setProgress({ status: j.status, processed: j.processed, total: j.totalRows, successCount: j.successCount, errorCount: j.errorCount });
          if (j.status === "done" || j.status === "failed") { setResult(j); setTimeout(() => hydrate(ests.map((e) => e.id), ests), 600); return; }
        }
      } catch { /* keep polling */ }
      pollTimer.current = setTimeout(tick, 1500);
    };
    tick();
  }

  const running = !!jobId && !result;

  return (
    <div className="p-6 max-w-6xl">
      <Link href="/batch/e/estimateinvoice" className="inline-flex items-center gap-1.5 text-[13px] text-stone-400 hover:text-stone-200 mb-4"><ArrowLeft size={14} /> Back</Link>
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center"><FileInput size={18} className="text-amber-400" /></div>
        <h1 className="text-xl font-semibold text-stone-100">Invoice from Estimates</h1>
      </div>
      <p className="text-sm text-stone-400 mb-5 ml-12">Enter an amount or a % against each line, then create every invoice in one go — each linked to its estimate.</p>

      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error}</div>}

      {/* Toolbar */}
      <div className="sticky top-0 z-10 -mx-6 px-6 py-3 bg-stone-950/80 backdrop-blur border-b border-stone-800 flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className={`${selCls} pl-8 w-48`} />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={selCls}>
          <option value="Open">Open (not closed)</option>
          <option value="Accepted">Accepted</option>
          <option value="Pending">Pending</option>
          <option value="Any">Any</option>
        </select>
        <label className="flex items-center gap-1.5 text-[12px] text-stone-400">Date
          <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className={selCls} />
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-stone-400">Start invoice #
          <input value={startInvoiceNo} onChange={(e) => setStartInvoiceNo(e.target.value)} placeholder="auto" className={`${selCls} w-28`} />
        </label>
        <div className="flex items-center gap-1.5 text-[12px] text-stone-400">
          <input value={globalPct} onChange={(e) => setGlobalPct(e.target.value)} inputMode="decimal" placeholder="%" className={`${selCls} w-16 text-right`} />
          <button onClick={applyGlobalPct} className="px-2.5 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-[13px]">Apply %</button>
          <button onClick={fillAllRemaining} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-[13px]"><Wand2 size={13} /> Fill remaining</button>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {hydrating && <span className="text-[12px] text-stone-500 inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> loading invoiced…</span>}
          <button onClick={createAll} disabled={running || staged.length === 0} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium disabled:opacity-40">
            {running ? <Loader2 size={15} className="animate-spin" /> : <FileInput size={15} />} Create {staged.length} invoice{staged.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>

      {!customTxn && !hydrating && ests.length > 0 && !startInvoiceNo && (
        <div className="mt-4 px-4 py-2.5 rounded-lg bg-stone-800/60 border border-stone-700 text-stone-400 text-[12px]">
          QuickBooks auto-numbers invoices for this company. Set a “Start invoice #” to control the sequence, or leave it blank to let QuickBooks number them.
        </div>
      )}

      {progress && (
        <div className="my-4 space-y-2 max-w-lg">
          {!result ? (
            <>
              <div className="text-sm text-stone-300 flex items-center gap-2"><Loader2 size={14} className="animate-spin text-amber-400" /> Creating invoices…</div>
              <div className="h-2 rounded-full bg-stone-800 overflow-hidden"><div className="h-full bg-amber-500 transition-all" style={{ width: `${progress.total ? Math.round((progress.processed / progress.total) * 100) : 0}%` }} /></div>
              <div className="text-[12px] text-stone-500 tabular-nums">{progress.processed}/{progress.total} · {progress.successCount} ok{progress.errorCount ? ` · ${progress.errorCount} failed` : ""}</div>
            </>
          ) : (
            <div className="flex gap-4">
              <span className="inline-flex items-center gap-1.5 text-emerald-400 text-sm"><CheckCircle2 size={15} /> {result.successCount} created</span>
              {result.errorCount > 0 && <span className="inline-flex items-center gap-1.5 text-rose-400 text-sm"><XCircle size={15} /> {result.errorCount} failed</span>}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-stone-500 py-12">Loading estimates…</div>
      ) : visible.length === 0 ? (
        <div className="text-sm text-stone-500 py-12 text-center">No estimates found. They sync from QuickBooks — try the “Any” status filter.</div>
      ) : (
        <div className="mt-4 space-y-3">
          {visible.map((e) => {
            const remTotal = e.lines.reduce((s, l) => s + Math.max(0, remainingOf(e.id, l)), 0);
            const res = resultByEst[e.number];
            return (
              <div key={e.id} className="rounded-lg border border-stone-800 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-stone-900/60 text-[13px]">
                  <div><span className="text-stone-100 font-medium">{e.number || "—"}</span><span className="text-stone-500"> · {e.customer} · {e.date}</span></div>
                  <div className="flex items-center gap-3">
                    {res && (res.ok
                      ? <span className="inline-flex items-center gap-1 text-[12px] text-emerald-400"><CheckCircle2 size={12} /> {res.docNumber || "created"}</span>
                      : <span className="text-[12px] text-rose-400" title={res.error}>failed</span>)}
                    <span className="text-[12px] text-sky-400">Remaining {money(remTotal, e.currency)}</span>
                  </div>
                </div>
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-stone-600 border-b border-stone-800/60">
                      <th className="text-left px-3 py-1 font-semibold">Line</th>
                      <th className="text-right px-3 py-1 font-semibold w-24">Estimated</th>
                      <th className="text-right px-3 py-1 font-semibold w-24">Already</th>
                      <th className="text-right px-3 py-1 font-semibold w-20">Progress</th>
                      <th className="text-right px-3 py-1 font-semibold w-24">Remaining</th>
                      <th className="text-right px-3 py-1 font-semibold w-20">Invoice %</th>
                      <th className="text-right px-3 py-1 font-semibold w-32">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.lines.map((l) => (
                      <tr key={l.index} className="border-t border-stone-800/50">
                        <td className="px-3 py-1.5 text-stone-300 truncate max-w-[240px]">{l.description || l.item || `Line ${l.index + 1}`}</td>
                        <td className="px-3 py-1.5 text-right text-stone-500 tabular-nums">{money(l.estAmount, e.currency)}</td>
                        <td className="px-3 py-1.5 text-right text-emerald-400/70 tabular-nums">{alreadyOf(e.id, l) ? money(alreadyOf(e.id, l), e.currency) : "—"}</td>
                        <td className="px-3 py-1.5 text-right text-stone-500 tabular-nums">{progressOf(e.id, l)}%</td>
                        <td className="px-3 py-1.5 text-right text-sky-400 tabular-nums">{money(remainingOf(e.id, l), e.currency)}</td>
                        <td className="px-3 py-1.5 text-right"><input inputMode="decimal" placeholder="—" onChange={(ev) => setPct(e, l, ev.target.value)} className={`${cell} w-16`} /></td>
                        <td className="px-3 py-1.5 text-right"><input value={amounts[e.id]?.[l.index] ?? ""} onChange={(ev) => setAmt(e.id, l.index, ev.target.value)} inputMode="decimal" placeholder="0.00" className={`${cell} w-28`} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
