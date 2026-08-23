"use client";

/**
 * Bank reconciliation — pick a bank/credit-card account, enter the statement's
 * ending balance & date, tick the lines that appear on the statement, and
 * finalize once the cleared balance matches the statement.
 */

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Landmark, Loader, Check, X } from "lucide-react";

const money = (n: any) => Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ReconcileConsole() {
  const [accts, setAccts] = useState<any[] | null>(null);
  const [accountId, setAccountId] = useState("");
  const [view, setView] = useState<any>(null);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [stmtDate, setStmtDate] = useState(new Date().toISOString().slice(0, 10));
  const [stmtBal, setStmtBal] = useState("");
  const [saving, setSaving] = useState(false); const [err, setErr] = useState(""); const [msg, setMsg] = useState("");

  async function loadAccts() { setAccts(await fetch(`/api/accounting/reconcile`).then(r => r.json()).catch(() => [])); }
  async function loadView(id: string) {
    setView(null); setTicked({});
    setView(await fetch(`/api/accounting/reconcile?accountId=${id}`).then(r => r.json()).catch(() => null));
  }
  useEffect(() => { loadAccts(); }, []);
  useEffect(() => { if (accountId) loadView(accountId); }, [accountId]);

  const beginning = Number(view?.beginningBalance ?? 0);
  const clearedSel = useMemo(() => (view?.lines ?? []).filter((l: any) => ticked[l.lineId]).reduce((s: number, l: any) => s + Number(l.amount), 0), [view, ticked]);
  const clearedBalance = Math.round((beginning + clearedSel) * 100) / 100;
  const difference = Math.round((clearedBalance - (Number(stmtBal) || 0)) * 100) / 100;
  const balanced = stmtBal !== "" && Math.abs(difference) < 0.005;

  async function finalize() {
    setSaving(true); setErr(""); setMsg("");
    const lineIds = Object.keys(ticked).filter(k => ticked[k]);
    const r = await fetch(`/api/accounting/reconcile`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, statementDate: stmtDate, statementBalance: Number(stmtBal) || 0, lineIds }) });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not reconcile."); return; }
    setMsg("Reconciled ✓"); setStmtBal(""); loadView(accountId); loadAccts();
  }
  async function undo(id: string) {
    if (!confirm("Undo this reconciliation? Its lines become un-cleared.")) return;
    await fetch(`/api/accounting/reconcile?id=${id}`, { method: "DELETE" });
    loadView(accountId); loadAccts();
  }

  const inputCls = "bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-100 focus:outline-none focus:border-emerald-600";

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-sky-500/15 flex items-center justify-center"><Landmark size={18} className="text-sky-400" /></div>
          <h1 className="text-xl font-semibold text-stone-100">Bank Reconciliation</h1>
        </div>
        <button onClick={() => { loadAccts(); if (accountId) loadView(accountId); }} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} /></button>
      </div>
      <p className="text-sm text-stone-400 mb-5 ml-12">Tick the transactions that appear on your bank/card statement until the cleared balance matches the statement's ending balance, then finalize.</p>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select value={accountId} onChange={e => setAccountId(e.target.value)} className={`${inputCls} min-w-[240px]`}>
          <option value="">Select an account to reconcile…</option>
          {(accts ?? []).map(a => <option key={a.id} value={a.id}>{a.name} — GL {money(a.balance)}</option>)}
        </select>
        {accts !== null && accts.length === 0 && <span className="text-[12px] text-amber-400">No bank or credit-card accounts in the chart of accounts yet.</span>}
      </div>

      {accountId && view && (
        <>
          <div className="grid grid-cols-4 gap-2 mb-4">
            <div className="rounded-xl border border-stone-800 bg-stone-900 p-3"><div className="text-[10px] uppercase tracking-wide text-stone-500">Beginning (cleared)</div><div className="text-[15px] font-semibold text-stone-100 tabular-nums">{money(beginning)}</div></div>
            <div className="rounded-xl border border-stone-800 bg-stone-900 p-3"><div className="text-[10px] uppercase tracking-wide text-stone-500">Statement ending</div><input type="number" value={stmtBal} onChange={e => setStmtBal(e.target.value)} placeholder="0.00" className="bg-transparent text-[15px] font-semibold text-stone-100 tabular-nums w-full focus:outline-none" /></div>
            <div className="rounded-xl border border-stone-800 bg-stone-900 p-3"><div className="text-[10px] uppercase tracking-wide text-stone-500">Cleared balance</div><div className="text-[15px] font-semibold text-stone-100 tabular-nums">{money(clearedBalance)}</div></div>
            <div className={`rounded-xl border p-3 ${balanced ? "border-emerald-800/50 bg-emerald-500/5" : "border-amber-800/50 bg-amber-500/5"}`}><div className="text-[10px] uppercase tracking-wide text-stone-500">Difference</div><div className={`text-[15px] font-semibold tabular-nums ${balanced ? "text-emerald-400" : "text-amber-400"}`}>{money(difference)}</div></div>
          </div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-[12px] text-stone-400">Statement date <input type="date" value={stmtDate} onChange={e => setStmtDate(e.target.value)} className="bg-stone-950 border border-stone-700 rounded-lg px-2.5 py-1.5 text-stone-100" /></div>
            <button onClick={finalize} disabled={!balanced || saving} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-4 py-2 hover:bg-emerald-700 disabled:opacity-40" title={balanced ? "" : "Difference must be zero"}>
              {saving ? <Loader size={14} className="animate-spin" /> : <Check size={14} />} Finish reconciliation
            </button>
          </div>
          {err && <p className="text-[12px] text-rose-400 mb-2">{err}</p>}
          {msg && <p className="text-[12px] text-emerald-400 mb-2">{msg}</p>}

          <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden"><div className="overflow-x-auto">
            <table className="w-full text-[13px] min-w-[560px]">
              <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                <th className="w-10 text-center px-2 py-2.5">Clr</th><th className="text-left px-4 py-2.5">Date</th><th className="text-left px-4 py-2.5">Doc</th><th className="text-left px-4 py-2.5">Description</th><th className="text-right px-4 py-2.5">Amount</th>
              </tr></thead>
              <tbody>
                {view.lines.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-stone-500">Nothing left to reconcile on this account.</td></tr>}
                {view.lines.map((l: any) => (
                  <tr key={l.lineId} className={`border-b border-stone-800/60 cursor-pointer hover:bg-stone-800/20 ${ticked[l.lineId] ? "bg-emerald-500/5" : ""}`} onClick={() => setTicked(t => ({ ...t, [l.lineId]: !t[l.lineId] }))}>
                    <td className="text-center"><input type="checkbox" checked={!!ticked[l.lineId]} onChange={() => {}} className="accent-emerald-600" /></td>
                    <td className="px-4 py-2 text-stone-400">{l.date}</td>
                    <td className="px-4 py-2 font-mono text-[12px] text-stone-300">{l.docNumber || "—"}</td>
                    <td className="px-4 py-2 text-stone-200">{l.description}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${l.amount < 0 ? "text-rose-300" : "text-stone-200"}`}>{money(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>

          {view.history?.length > 0 && (
            <div className="mt-6">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-500 mb-2">Past reconciliations</div>
              <div className="rounded-xl bg-stone-900 border border-stone-800 divide-y divide-stone-800/60">
                {view.history.map((h: any) => (
                  <div key={h.id} className="flex items-center justify-between px-4 py-2 text-[12.5px]">
                    <span className="text-stone-300">{h.statementDate} · statement {money(h.statementBalance)}</span>
                    <button onClick={() => undo(h.id)} className="text-[11px] text-stone-500 hover:text-rose-400 inline-flex items-center gap-1"><X size={12} /> Undo</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
