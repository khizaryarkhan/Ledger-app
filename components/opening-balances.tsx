"use client";

/**
 * Opening balances setup — enter each account's brought-forward balance as of a
 * date; the net is auto-posted to Opening Balance Equity so the entry balances.
 */

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Loader, Check, Scale } from "lucide-react";

const money = (n: any) => Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Accounts whose normal (positive opening) side is a debit.
const DEBIT_NORMAL = new Set(["Asset", "Expense"]);

export function OpeningBalances() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [date, setDate] = useState(`${new Date().getFullYear()}-01-01`);
  const [vals, setVals] = useState<Record<string, string>>({}); // accountId -> signed amount (normal side positive)
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false); const [msg, setMsg] = useState(""); const [err, setErr] = useState("");

  async function load() {
    setLoading(true);
    const [accs, ob] = await Promise.all([
      fetch(`/api/accounting/accounts`).then(r => r.json()).catch(() => []),
      fetch(`/api/accounting/opening-balances`).then(r => r.json()).catch(() => ({ lines: [], date: null })),
    ]);
    const list = (Array.isArray(accs) ? accs : []).filter((a: any) => a.subtype?.toLowerCase() !== "openingbalanceequity");
    setAccounts(list);
    if (ob?.date) setDate(ob.date);
    const v: Record<string, string> = {};
    for (const l of (ob?.lines ?? [])) {
      const acc = list.find((a: any) => a.id === l.accountId); if (!acc) continue;
      const signed = DEBIT_NORMAL.has(acc.classification) ? (l.debit - l.credit) : (l.credit - l.debit);
      if (signed) v[l.accountId] = String(signed);
    }
    setVals(v); setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const groups = useMemo(() => {
    const order = ["Asset", "Liability", "Equity", "Revenue", "Expense"];
    return order.map(cls => ({ cls, accts: accounts.filter(a => a.classification === cls) })).filter(g => g.accts.length);
  }, [accounts]);

  const { obe, balanced } = useMemo(() => {
    let dr = 0, cr = 0;
    for (const a of accounts) {
      const signed = Number(vals[a.id]) || 0; if (!signed) continue;
      if (DEBIT_NORMAL.has(a.classification)) { if (signed > 0) dr += signed; else cr += -signed; }
      else { if (signed > 0) cr += signed; else dr += -signed; }
    }
    return { obe: Math.round((dr - cr) * 100) / 100, balanced: Math.abs(dr - cr) < 0.005 };
  }, [accounts, vals]);

  async function save() {
    setSaving(true); setErr(""); setMsg("");
    const entries = accounts.map(a => {
      const signed = Number(vals[a.id]) || 0; if (!signed) return null;
      const dr = DEBIT_NORMAL.has(a.classification);
      const onDebit = dr ? signed > 0 : signed < 0;
      return { accountId: a.id, debit: onDebit ? Math.abs(signed) : 0, credit: onDebit ? 0 : Math.abs(signed) };
    }).filter(Boolean);
    const r = await fetch(`/api/accounting/opening-balances`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, entries }) });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not save."); return; }
    setMsg("Opening balances posted."); load();
  }

  const inputCls = "bg-stone-950 border border-stone-700 rounded px-2 py-1 text-[13px] text-stone-100 w-40 text-right focus:outline-none focus:border-emerald-600";

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/15 flex items-center justify-center"><Scale size={18} className="text-indigo-400" /></div>
          <h1 className="text-xl font-semibold text-stone-100">Opening Balances</h1>
        </div>
        <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></button>
      </div>
      <p className="text-sm text-stone-400 mb-5 ml-12">Bring balances over from your previous system. Enter each account's balance as of the start date; the difference posts to Opening Balance Equity automatically.</p>

      <div className="flex items-center gap-2 mb-4 text-[12px] text-stone-400">As of <input type="date" value={date} onChange={e => setDate(e.target.value)} className="bg-stone-950 border border-stone-700 rounded-lg px-2.5 py-1.5 text-stone-100" /></div>

      {loading ? <p className="text-sm text-stone-500">Loading…</p> : (
        <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden">
          {groups.map(g => (
            <div key={g.cls}>
              <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500 bg-stone-950/40 border-b border-stone-800">{g.cls}</div>
              {g.accts.map(a => (
                <div key={a.id} className="flex items-center justify-between px-4 py-1.5 border-b border-stone-800/40">
                  <span className="text-[13px] text-stone-200">{a.code ? <span className="text-stone-500 font-mono mr-2">{a.code}</span> : null}{a.name}</span>
                  <input type="number" step="0.01" value={vals[a.id] ?? ""} onChange={e => setVals(v => ({ ...v, [a.id]: e.target.value }))} placeholder="0.00" className={inputCls} />
                </div>
              ))}
            </div>
          ))}
          <div className="flex items-center justify-between px-4 py-2.5 bg-stone-950/60">
            <span className="text-[13px] font-semibold text-stone-100">Opening Balance Equity <span className="text-[11px] text-stone-500 font-normal">(auto-balancing)</span></span>
            <span className="text-[13px] font-semibold tabular-nums text-stone-100">{money(Math.abs(obe))} {obe > 0 ? "Cr" : obe < 0 ? "Dr" : ""}</span>
          </div>
        </div>
      )}

      {err && <p className="text-[12px] text-rose-400 mt-3">{err}</p>}
      {msg && <p className="text-[12px] text-emerald-400 mt-3">{msg}</p>}
      <div className="flex items-center justify-end gap-2 mt-4">
        <button onClick={save} disabled={saving || loading} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">
          {saving ? <Loader size={14} className="animate-spin" /> : <Check size={14} />} Post opening balances
        </button>
      </div>
    </div>
  );
}
