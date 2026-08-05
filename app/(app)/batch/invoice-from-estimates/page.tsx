"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { FileInput, Loader2, Search, ArrowLeft, CheckCircle2, XCircle, Wand2 } from "lucide-react";

interface Line { index: number; item: string; description: string; qty: number | null; rate: number | null; estAmount: number; }
interface Est { id: string; number: string; customer: string; date: string; currency: string; total: number; lines: Line[]; }

const selCls = "h-9 px-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-200 focus:border-amber-500 focus:outline-none";
const money = (n: number, ccy: string) => `${ccy ? ccy + " " : ""}${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function InvoiceWorksheetPage() {
  const [status, setStatus] = useState("Accepted");
  const [ests, setEsts] = useState<Est[]>([]);
  const [loading, setLoading] = useState(true);
  const [hydrating, setHydrating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [customTxn, setCustomTxn] = useState(false);

  const [invoiced, setInvoiced] = useState<Record<string, number[]>>({});   // estId → already[] per line
  const [amounts, setAmounts] = useState<Record<string, Record<number, string>>>({});
  const [invoiceNos, setInvoiceNos] = useState<Record<string, string>>({});

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
        setInvoiced({}); setAmounts({}); setInvoiceNos({});
        // Hydrate already-invoiced from QBO in the background.
        if (list.length) hydrate(list.map((e) => e.id), list);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [status]);
  useEffect(() => { load(); }, [load]);

  async function hydrate(ids: string[], list: Est[]) {
    setHydrating(true);
    try {
      const r = await fetch("/api/batch/estimates/invoiced", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }),
      });
      const d = await r.json();
      if (r.ok) {
        setInvoiced(d.invoiced || {});
        setCustomTxn(!!d.customTxnNumbers);
        // Pre-fill each line's amount with its remaining.
        const init: Record<string, Record<number, string>> = {};
        for (const e of list) {
          init[e.id] = {};
          const already = d.invoiced?.[e.id] || [];
          for (const l of e.lines) {
            const rem = Math.round((l.estAmount - (already[l.index] || 0)) * 100) / 100;
            init[e.id][l.index] = rem > 0 ? String(rem) : "";
          }
        }
        setAmounts(init);
      }
    } catch { /* leave amounts blank; grid still usable */ } finally { setHydrating(false); }
  }

  const visible = useMemo(() => {
    const query = q.trim().toLowerCase();
    return query ? ests.filter((e) => `${e.number} ${e.customer}`.toLowerCase().includes(query)) : ests;
  }, [ests, q]);

  const remainingOf = (estId: string, l: Line) => Math.round((l.estAmount - (invoiced[estId]?.[l.index] || 0)) * 100) / 100;
  const setAmt = (estId: string, idx: number, v: string) => setAmounts((a) => ({ ...a, [estId]: { ...(a[estId] || {}), [idx]: v } }));

  function fillAllRemaining() {
    const next: Record<string, Record<number, string>> = {};
    for (const e of visible) {
      next[e.id] = { ...(amounts[e.id] || {}) };
      for (const l of e.lines) { const rem = remainingOf(e.id, l); next[e.id][l.index] = rem > 0 ? String(rem) : ""; }
    }
    setAmounts((a) => ({ ...a, ...next }));
  }

  // Estimates that have at least one non-zero amount entered.
  const staged = useMemo(() => {
    const items: any[] = [];
    for (const e of ests) {
      const lines = e.lines
        .map((l) => ({ index: l.index, amount: parseFloat(amounts[e.id]?.[l.index] ?? "") }))
        .filter((l) => !isNaN(l.amount) && l.amount !== 0);
      if (lines.length) items.push({ estimateId: e.id, estimateNumber: e.number, invoiceNo: customTxn ? (invoiceNos[e.id] || undefined) : undefined, lines });
    }
    return items;
  }, [ests, amounts, invoiceNos, customTxn]);

  async function createAll() {
    if (staged.length === 0) { setError("Enter an amount on at least one estimate."); return; }
    setError(null); setResult(null);
    try {
      const res = await fetch("/api/batch/estimates/invoice-batch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: staged, invoiceDate: invoiceDate || undefined }),
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
          if (j.status === "done" || j.status === "failed") { setResult(j); setTimeout(load, 600); return; }
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
      <p className="text-sm text-stone-400 mb-5 ml-12">Fill in what to bill against each line across all estimates, then create every invoice in one go.</p>

      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error}</div>}
      {!customTxn && !hydrating && ests.length > 0 && (
        <div className="mb-4 px-4 py-2.5 rounded-lg bg-stone-800/60 border border-stone-700 text-stone-400 text-[12px]">
          QuickBooks is set to auto-number invoices (custom transaction numbers are off), so invoice numbers are assigned by QuickBooks. Turn on “Custom transaction numbers” in QuickBooks settings to set your own.
        </div>
      )}

      {/* Toolbar */}
      <div className="sticky top-0 z-10 -mx-6 px-6 py-3 bg-stone-950/80 backdrop-blur border-b border-stone-800 flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className={`${selCls} pl-8 w-56`} />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={selCls}>
          <option value="Accepted">Accepted</option><option value="Pending">Pending</option><option value="Any">Any</option>
        </select>
        <label className="flex items-center gap-2 text-[12px] text-stone-400">Invoice date
          <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className={selCls} />
        </label>
        <button onClick={fillAllRemaining} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-[13px] font-medium">
          <Wand2 size={14} /> Fill all remaining
        </button>
        <div className="ml-auto flex items-center gap-3">
          {hydrating && <span className="text-[12px] text-stone-500 inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> loading invoiced totals…</span>}
          <button onClick={createAll} disabled={running || staged.length === 0} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium disabled:opacity-40">
            {running ? <Loader2 size={15} className="animate-spin" /> : <FileInput size={15} />} Create {staged.length} invoice{staged.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>

      {/* Progress / result */}
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

      {/* Worksheet */}
      {loading ? (
        <div className="text-sm text-stone-500 py-12">Loading estimates…</div>
      ) : visible.length === 0 ? (
        <div className="text-sm text-stone-500 py-12 text-center">No estimates found. (They sync from QuickBooks.)</div>
      ) : (
        <div className="mt-4 space-y-3">
          {visible.map((e) => {
            const remTotal = e.lines.reduce((s, l) => s + Math.max(0, remainingOf(e.id, l)), 0);
            return (
              <div key={e.id} className="rounded-lg border border-stone-800 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-stone-900/60 text-[13px]">
                  <div><span className="text-stone-100 font-medium">{e.number || "—"}</span><span className="text-stone-500"> · {e.customer} · {e.date}</span></div>
                  <div className="flex items-center gap-3">
                    <span className="text-[12px] text-sky-400">Remaining {money(remTotal, e.currency)}</span>
                    {customTxn && <input value={invoiceNos[e.id] || ""} onChange={(ev) => setInvoiceNos((x) => ({ ...x, [e.id]: ev.target.value }))} placeholder="Invoice #" className="h-7 w-28 px-2 text-[12px] rounded border border-stone-700 bg-stone-800/60 text-stone-200 focus:border-amber-500 focus:outline-none" />}
                  </div>
                </div>
                <table className="w-full text-[13px]">
                  <tbody>
                    {e.lines.map((l) => {
                      const rem = remainingOf(e.id, l);
                      return (
                        <tr key={l.index} className="border-t border-stone-800/60">
                          <td className="px-3 py-1.5 text-stone-300 truncate max-w-[280px]">{l.description || l.item || `Line ${l.index + 1}`}</td>
                          <td className="px-3 py-1.5 text-right text-stone-500 tabular-nums w-28">{money(l.estAmount, e.currency)}</td>
                          <td className="px-3 py-1.5 text-right text-emerald-400/70 tabular-nums w-28">{invoiced[e.id]?.[l.index] ? money(invoiced[e.id][l.index], e.currency) : "—"}</td>
                          <td className="px-3 py-1.5 text-right text-sky-400 tabular-nums w-28">{money(rem, e.currency)}</td>
                          <td className="px-3 py-1.5 text-right w-40">
                            <input value={amounts[e.id]?.[l.index] ?? ""} onChange={(ev) => setAmt(e.id, l.index, ev.target.value)} inputMode="decimal" placeholder="0.00"
                              className="h-7 w-32 px-2 text-right text-[13px] rounded border border-stone-700 bg-stone-800/60 text-stone-100 focus:border-amber-500 focus:outline-none" />
                          </td>
                        </tr>
                      );
                    })}
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
