"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { CalendarRange, Check, Loader, Lock, Unlock, AlertTriangle } from "lucide-react";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

type Close = { id: string; periodStart: string; periodEnd: string; netProfit: number; status: string; closedAt: string | null };
type Status = { fiscalYearStartMonth: number; fiscalYearStartLabel: string; bookCloseDate: string | null; closes: Close[] };

function pad2(n: number) { return String(n).padStart(2, "0"); }

// End of the fiscal year currently in progress, given the FY start month.
function currentFyEnd(startMonth: number): string {
  const now = new Date();
  let y = now.getUTCFullYear();
  if (now.getUTCMonth() + 1 < startMonth) y -= 1;
  const end = new Date(Date.UTC(y + 1, startMonth - 1, 1));
  end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
}

function money(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function FinancialYearSettings() {
  const [st, setSt] = useState<Status | null>(null);
  const [savingMonth, setSavingMonth] = useState(false);
  const [savedMonth, setSavedMonth] = useState(false);
  const [periodEnd, setPeriodEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function load() {
    const d = await fetch("/api/period-close").then(r => r.json()).catch(() => null);
    if (d) { setSt(d); if (!periodEnd) setPeriodEnd(currentFyEnd(d.fiscalYearStartMonth)); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function saveMonth(m: number) {
    setSavingMonth(true); setSavedMonth(false);
    try {
      const res = await fetch("/api/org/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fiscalYearStartMonth: m }) });
      if (res.ok) { setSavedMonth(true); setTimeout(() => setSavedMonth(false), 1800); await load(); }
    } finally { setSavingMonth(false); }
  }

  async function closePeriod() {
    if (!periodEnd) return;
    if (!confirm(`Close the books through ${periodEnd}?\n\nA closing entry will move the period's net profit/loss to Retained Earnings, and entries on or before this date will be locked. You can reopen it later.`)) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/period-close", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "close", periodEnd }) });
      const d = await res.json();
      if (!res.ok) { setMsg({ kind: "err", text: d.error || "Failed to close" }); return; }
      setMsg({ kind: "ok", text: `Closed through ${periodEnd} — net ${d.netProfit >= 0 ? "profit" : "loss"} ${money(Math.abs(d.netProfit))} moved to Retained Earnings.` });
      await load();
    } finally { setBusy(false); }
  }

  async function reopen(c: Close) {
    if (!confirm(`Reopen ${c.periodStart} → ${c.periodEnd}?\n\nThe closing entry will be reversed and the period unlocked.`)) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/period-close", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reopen", id: c.id }) });
      const d = await res.json();
      if (!res.ok) { setMsg({ kind: "err", text: d.error || "Failed to reopen" }); return; }
      setMsg({ kind: "ok", text: `Reopened ${c.periodStart} → ${c.periodEnd}.` });
      await load();
    } finally { setBusy(false); }
  }

  const inputCls = "bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-100";

  return (
    <Card className="p-5 mb-4">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-stone-800 flex items-center justify-center shrink-0">
          <CalendarRange size={18} className="text-stone-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-white mb-0.5">Financial year &amp; period close</h3>
          <p className="text-[12px] text-stone-400 mb-4">Define your fiscal year, then close a period to move its net profit to Retained Earnings and lock the books.</p>

          {!st ? (
            <div className="text-[12px] text-stone-500 flex items-center gap-2"><Loader size={13} className="animate-spin" /> Loading…</div>
          ) : (
            <div className="space-y-5">
              {/* Fiscal year start */}
              <label className="block max-w-xs">
                <span className="block text-[12px] font-medium text-stone-300 mb-1 inline-flex items-center gap-2">
                  First month of fiscal year
                  {savingMonth && <Loader size={12} className="animate-spin text-stone-500" />}
                  {savedMonth && <span className="text-[11px] text-emerald-400 inline-flex items-center gap-1"><Check size={11} /> Saved</span>}
                </span>
                <select value={st.fiscalYearStartMonth} onChange={e => saveMonth(Number(e.target.value))} className={`${inputCls} w-full`}>
                  {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
                <span className="block text-[11px] text-stone-500 mt-1">e.g. July for a Pakistan (July–June) fiscal year.</span>
              </label>

              {/* Lock state */}
              <div className="text-[12px] inline-flex items-center gap-2">
                {st.bookCloseDate
                  ? <span className="inline-flex items-center gap-1.5 text-amber-500"><Lock size={13} /> Books locked through <b className="text-amber-400">{st.bookCloseDate}</b></span>
                  : <span className="inline-flex items-center gap-1.5 text-stone-500"><Unlock size={13} /> No period closed yet — books are open.</span>}
              </div>

              {/* Close a period */}
              <div className="p-3 rounded-lg bg-stone-950/60 border border-stone-800">
                <div className="text-[12px] font-medium text-stone-300 mb-2">Close a financial period</div>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-[11px] text-stone-400">Period end date
                    <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className={`${inputCls} mt-1 block`} />
                  </label>
                  <button onClick={closePeriod} disabled={busy || !periodEnd}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2">
                    {busy ? <Loader size={13} className="animate-spin" /> : <Lock size={13} />} Close period
                  </button>
                </div>
                {msg && (
                  <div className={`mt-3 text-[12px] inline-flex items-center gap-1.5 ${msg.kind === "ok" ? "text-emerald-400" : "text-rose-400"}`}>
                    {msg.kind === "ok" ? <Check size={13} /> : <AlertTriangle size={13} />} {msg.text}
                  </div>
                )}
              </div>

              {/* History */}
              {st.closes.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px] min-w-[480px]">
                    <thead>
                      <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                        <th className="text-left py-2 pr-3">Period</th>
                        <th className="text-right py-2 px-2">Net profit → RE</th>
                        <th className="text-left py-2 px-2">Status</th>
                        <th className="py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {st.closes.map(c => (
                        <tr key={c.id} className="border-b border-stone-800/60">
                          <td className="py-2 pr-3 text-stone-300 whitespace-nowrap">{c.periodStart} → {c.periodEnd}</td>
                          <td className={`py-2 px-2 text-right tabular-nums ${c.netProfit >= 0 ? "text-stone-200" : "text-rose-400"}`}>{money(c.netProfit)}</td>
                          <td className="py-2 px-2">
                            <span className={`text-[10px] font-medium border rounded-full px-2 py-0.5 ${c.status === "Closed" ? "bg-amber-500/10 text-amber-400 border-amber-800" : "bg-stone-800 text-stone-400 border-stone-700"}`}>{c.status}</span>
                          </td>
                          <td className="py-2 text-right">
                            {c.status === "Closed" && (
                              <button onClick={() => reopen(c)} disabled={busy} className="inline-flex items-center gap-1 text-[11px] text-stone-500 hover:text-amber-400 disabled:opacity-50">
                                <Unlock size={12} /> Reopen
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
