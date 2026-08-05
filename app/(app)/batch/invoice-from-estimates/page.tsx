"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { FileInput, Loader2, Search, ArrowLeft, CheckCircle2 } from "lucide-react";

interface Line { index: number; item: string; description: string; qty: number | null; rate: number | null; estAmount: number; alreadyInvoiced: number; remaining: number; }
interface Est { id: string; number: string; customer: string; date: string; status: string; currency: string; total: number; alreadyTotal: number; remainingTotal: number; lines: Line[]; }

const selCls = "h-9 px-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-200 focus:border-amber-500 focus:outline-none";
const money = (n: number, ccy: string) => `${ccy ? ccy + " " : ""}${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function InvoiceFromEstimatesPage() {
  const [status, setStatus] = useState("Accepted");
  const [ests, setEsts] = useState<Est[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  // amounts[estId][lineIndex] = string
  const [amounts, setAmounts] = useState<Record<string, Record<number, string>>>({});
  const [creating, setCreating] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({}); // estId → invoice no

  const load = useCallback(() => {
    setLoading(true); setError(null);
    fetch(`/api/batch/estimates/open?status=${encodeURIComponent(status)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setEsts(d.estimates || []);
        // default each line's amount to its remaining
        const init: Record<string, Record<number, string>> = {};
        for (const e of d.estimates || []) {
          init[e.id] = {};
          for (const l of e.lines) init[e.id][l.index] = l.remaining > 0 ? String(l.remaining) : "";
        }
        setAmounts(init);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const query = q.trim().toLowerCase();
    return query ? ests.filter((e) => `${e.number} ${e.customer}`.toLowerCase().includes(query)) : ests;
  }, [ests, q]);

  function setAmt(estId: string, idx: number, val: string) {
    setAmounts((a) => ({ ...a, [estId]: { ...(a[estId] || {}), [idx]: val } }));
  }

  async function create(est: Est) {
    const lines = (est.lines || [])
      .map((l) => ({ index: l.index, amount: parseFloat(amounts[est.id]?.[l.index] ?? "") }))
      .filter((l) => !isNaN(l.amount) && l.amount !== 0);
    if (lines.length === 0) { setError(`Enter at least one amount on estimate ${est.number}.`); return; }
    setCreating(est.id); setError(null);
    try {
      const res = await fetch(`/api/batch/estimates/${est.id}/invoice`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines, invoiceDate: invoiceDate || undefined, estimateNumber: est.number }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Invoice creation failed");
      setDone((x) => ({ ...x, [est.id]: d.invoiceNumber || "created" }));
      // Refresh this estimate's already/remaining in the background.
      setTimeout(load, 800);
    } catch (e: any) { setError(e.message); } finally { setCreating(null); }
  }

  return (
    <div className="p-6 max-w-5xl">
      <Link href="/batch/e/estimateinvoice" className="inline-flex items-center gap-1.5 text-[13px] text-stone-400 hover:text-stone-200 mb-4"><ArrowLeft size={14} /> Back</Link>
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center"><FileInput size={18} className="text-amber-400" /></div>
        <h1 className="text-xl font-semibold text-stone-100">Invoice from Estimates</h1>
      </div>
      <p className="text-sm text-stone-400 mb-5 ml-12">Enter what to bill against each line, then create one invoice per estimate — linked in QuickBooks.</p>

      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error}</div>}

      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by number or customer…" className={`${selCls} pl-8 w-64`} />
        </div>
        <label className="flex items-center gap-2 text-[13px] text-stone-400">Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={selCls}>
            <option value="Accepted">Accepted</option><option value="Pending">Pending</option><option value="Any">Any</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-[13px] text-stone-400">Invoice date
          <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className={selCls} />
        </label>
      </div>

      {loading ? (
        <div className="text-sm text-stone-500 py-12">Loading estimates…</div>
      ) : visible.length === 0 ? (
        <div className="text-sm text-stone-500 py-12 text-center">No estimates found.</div>
      ) : (
        <div className="space-y-4">
          {visible.map((est) => {
            const fullyBilled = est.remainingTotal <= 0.005;
            return (
              <div key={est.id} className="rounded-xl border border-stone-800 bg-stone-900 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-stone-800">
                  <div>
                    <span className="text-stone-100 font-medium">Estimate {est.number || "—"}</span>
                    <span className="text-stone-500"> · {est.customer} · {est.date}</span>
                  </div>
                  <div className="text-[12px] text-stone-400">
                    Total {money(est.total, est.currency)} · <span className="text-emerald-400">Invoiced {money(est.alreadyTotal, est.currency)}</span> · <span className="text-sky-400">Remaining {money(est.remainingTotal, est.currency)}</span>
                  </div>
                </div>

                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                      <th className="text-left px-4 py-2 font-semibold">Item</th>
                      <th className="text-left px-4 py-2 font-semibold">Description</th>
                      <th className="text-right px-4 py-2 font-semibold">Estimated</th>
                      <th className="text-right px-4 py-2 font-semibold">Already</th>
                      <th className="text-right px-4 py-2 font-semibold">Remaining</th>
                      <th className="text-right px-4 py-2 font-semibold w-40">Amount to invoice</th>
                    </tr>
                  </thead>
                  <tbody>
                    {est.lines.map((l) => (
                      <tr key={l.index} className="border-b border-stone-800/60">
                        <td className="px-4 py-1.5 text-stone-200">{l.item || "—"}</td>
                        <td className="px-4 py-1.5 text-stone-400 truncate max-w-[240px]">{l.description}</td>
                        <td className="px-4 py-1.5 text-right text-stone-400 tabular-nums">{money(l.estAmount, est.currency)}</td>
                        <td className="px-4 py-1.5 text-right text-emerald-400/80 tabular-nums">{l.alreadyInvoiced ? money(l.alreadyInvoiced, est.currency) : "—"}</td>
                        <td className="px-4 py-1.5 text-right text-sky-400 tabular-nums">{money(l.remaining, est.currency)}</td>
                        <td className="px-4 py-1.5 text-right">
                          <input
                            value={amounts[est.id]?.[l.index] ?? ""}
                            onChange={(e) => setAmt(est.id, l.index, e.target.value)}
                            inputMode="decimal"
                            placeholder="0.00"
                            className="h-8 w-32 px-2 text-right text-[13px] rounded border border-stone-700 bg-stone-800/60 text-stone-100 focus:border-amber-500 focus:outline-none"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="flex items-center justify-between px-4 py-3 border-t border-stone-800">
                  {done[est.id] ? (
                    <span className="inline-flex items-center gap-1.5 text-[13px] text-emerald-400"><CheckCircle2 size={14} /> Invoice {done[est.id]} created</span>
                  ) : fullyBilled ? (
                    <span className="text-[12px] text-stone-500">Fully invoiced</span>
                  ) : <span />}
                  <button
                    onClick={() => create(est)}
                    disabled={creating === est.id}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium disabled:opacity-50"
                  >
                    {creating === est.id ? <Loader2 size={15} className="animate-spin" /> : <FileInput size={15} />} Create invoice
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
