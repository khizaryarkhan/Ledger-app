"use client";

import { useEffect, useState, useCallback } from "react";
import { ListTree, Loader2, Sparkles, AlertTriangle, CheckCircle2 } from "lucide-react";

interface Line { id: string; name: string; code: string | null; lineKind?: string; formula?: { code: string; op: string }[] | null; }
interface Account { id: string; name: string; number?: string; type: string; section: string; mappedLineId: string | null; }

const input = "h-8 px-2 text-[13px] rounded-md border border-stone-700 bg-stone-800/60 text-stone-100 focus:border-blue-500 focus:outline-none";
const btn = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium";
const card = "border border-stone-800 rounded-xl bg-stone-900/40";

export default function PlStructurePage() {
  const [statement, setStatement] = useState<any>(null);
  const [structLines, setStructLines] = useState<Line[]>([]);
  const [mapLines, setMapLines] = useState<Line[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStructure = useCallback(async () => {
    const d = await fetch("/api/reporting/statement").then((r) => r.json());
    setStatement(d.statement); setStructLines(d.lines || []);
    return d.statement;
  }, []);
  const loadMapping = useCallback(async () => {
    const d = await fetch("/api/reporting/mapping").then((r) => r.json());
    if (d.needsSetup) { setAccounts([]); setMapLines([]); return; }
    if (d.error) throw new Error(d.error);
    setMapLines(d.lines || []); setAccounts(d.accounts || []);
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const s = await loadStructure(); if (s) await loadMapping(); }
    catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [loadStructure, loadMapping]);
  useEffect(() => { load(); }, [load]);

  async function seed() {
    setBusy(true); setError(null);
    try { await fetch("/api/reporting/statement", { method: "POST" }); await load(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function setMapping(accountId: string, lineId: string) {
    setAccounts((as) => as.map((a) => (a.id === accountId ? { ...a, mappedLineId: lineId || null } : a)));
    await fetch("/api/reporting/mapping", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, lineId: lineId || null }),
    });
  }

  const SECTION_ORDER = ["Income", "Other Income", "Cost of Sales", "Expenses", "Other Expense"];
  const bySection = accounts.reduce<Record<string, Account[]>>((m, a) => { (m[a.section] ??= []).push(a); return m; }, {});
  const orderedSections = [
    ...SECTION_ORDER.filter((s) => bySection[s]),
    ...Object.keys(bySection).filter((s) => !SECTION_ORDER.includes(s)),
  ];
  const unmapped = accounts.filter((a) => !a.mappedLineId).length;

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-blue-500/15 flex items-center justify-center"><ListTree size={18} className="text-blue-400" /></div>
        <h1 className="text-xl font-semibold text-stone-100">P&amp;L Structure &amp; Account Mapping</h1>
      </div>
      <p className="text-sm text-stone-400 mb-5 ml-12">
        Define your management P&amp;L layout, then map each QBO account into a line. Profit Centers are set separately (Classification Rules) and split these lines into columns — including at Class level.
      </p>

      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error}</div>}

      {loading ? (
        <div className="text-sm text-stone-500 py-12">Loading…</div>
      ) : !statement ? (
        <div className={`${card} p-10 text-center`}>
          <p className="text-stone-300 mb-1">No management P&amp;L structure yet.</p>
          <p className="text-sm text-stone-500 mb-4">Start from the standard layout (Revenue → Gross Profit → EBITDA → Net Profit), then tailor it.</p>
          <button onClick={seed} disabled={busy} className={`${btn} bg-blue-600 hover:bg-blue-700 text-white mx-auto disabled:opacity-40`}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Create standard Management P&amp;L
          </button>
        </div>
      ) : (
        <div className="grid md:grid-cols-[280px_1fr] gap-5">
          {/* Structure */}
          <div className={`${card} p-4 h-fit`}>
            <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-2">P&amp;L Structure</div>
            <ul className="space-y-1 text-[13px]">
              {structLines.map((l) => (
                <li key={l.id} className={l.lineKind === "computed" ? "text-blue-300 font-medium" : "text-stone-300"}>
                  {l.name}
                  {l.lineKind === "computed" && <span className="text-[10px] text-stone-600 ml-1">(computed)</span>}
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-stone-600 mt-3">Line editing (rename / reorder / custom subtotals) comes next; the standard layout works now.</p>
          </div>

          {/* Mapping */}
          <div>
            <div className="flex items-center gap-3 mb-3 text-[13px]">
              {unmapped === 0
                ? <span className="inline-flex items-center gap-1.5 text-emerald-400"><CheckCircle2 size={15} /> All {accounts.length} P&amp;L accounts mapped</span>
                : <span className="inline-flex items-center gap-1.5 text-amber-400"><AlertTriangle size={15} /> {unmapped} of {accounts.length} accounts unmapped</span>}
            </div>
            {orderedSections.map((section) => (
              <div key={section} className="mb-4">
                <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-1.5">{section} <span className="text-stone-600 normal-case">· {bySection[section].length}</span></div>
                <div className={`${card} divide-y divide-stone-800`}>
                  {bySection[section].map((a) => (
                    <div key={a.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                      <span className="text-stone-300 flex-1 truncate">{a.number ? `${a.number} · ` : ""}{a.name}</span>
                      <select value={a.mappedLineId ?? ""} onChange={(e) => setMapping(a.id, e.target.value)}
                        className={`${input} w-52 ${a.mappedLineId ? "" : "border-amber-500/40"}`}>
                        <option value="">— map to line —</option>
                        {mapLines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {accounts.length === 0 && <p className="text-sm text-stone-500">No QBO P&amp;L accounts found (or QuickBooks isn’t connected for this company).</p>}
          </div>
        </div>
      )}
    </div>
  );
}
