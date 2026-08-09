"use client";

import { useEffect, useState, useCallback } from "react";
import { ListTree, Loader2, Sparkles, AlertTriangle, CheckCircle2, X } from "lucide-react";

interface Line { id: string; name: string; code?: string | null; lineKind?: string; }
interface Opt { id: string; name: string; }
interface Account { id: string; name: string; number?: string; type: string; section: string; mappedLineId: string | null; mappedPcId: string | null; }

const input = "h-8 px-2 text-[13px] rounded-md border border-stone-700 bg-stone-800/60 text-stone-100 focus:border-blue-500 focus:outline-none";
const btn = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium";
const card = "border border-stone-800 rounded-xl bg-stone-900/40";
const SECTION_ORDER = ["Income", "Other Income", "Cost of Sales", "Expenses", "Other Expense"];

export default function PlStructurePage() {
  const [statement, setStatement] = useState<any>(null);
  const [structLines, setStructLines] = useState<Line[]>([]);
  const [lines, setLines] = useState<Opt[]>([]);
  const [pcs, setPcs] = useState<Opt[]>([]);
  const [pcDim, setPcDim] = useState<Opt | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchLine, setBatchLine] = useState("");
  const [batchPc, setBatchPc] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const s = await fetch("/api/reporting/statement").then((r) => r.json());
      setStatement(s.statement); setStructLines(s.lines || []);
      if (s.statement) {
        const m = await fetch("/api/reporting/mapping").then((r) => r.json());
        if (m.error) throw new Error(m.error);
        if (!m.needsSetup) { setLines(m.lines || []); setPcs(m.profitCentres || []); setPcDim(m.profitCentre || null); setAccounts(m.accounts || []); }
      }
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function seed() {
    setBusy(true); setError(null);
    try { await fetch("/api/reporting/statement", { method: "POST" }); await load(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function apply(accountIds: string[], patch: { lineId?: string | null; pcId?: string | null }) {
    setAccounts((as) => as.map((a) => accountIds.includes(a.id)
      ? { ...a, ...(patch.lineId !== undefined ? { mappedLineId: patch.lineId || null } : {}), ...(patch.pcId !== undefined ? { mappedPcId: patch.pcId || null } : {}) }
      : a));
    await fetch("/api/reporting/mapping", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountIds, ...patch }) });
  }

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const bySection = accounts.reduce<Record<string, Account[]>>((m, a) => { (m[a.section] ??= []).push(a); return m; }, {});
  const orderedSections = [...SECTION_ORDER.filter((s) => bySection[s]), ...Object.keys(bySection).filter((s) => !SECTION_ORDER.includes(s))];
  const unmapped = accounts.filter((a) => !a.mappedLineId).length;
  const selIds = [...selected];

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-blue-500/15 flex items-center justify-center"><ListTree size={18} className="text-blue-400" /></div>
        <h1 className="text-xl font-semibold text-stone-100">P&amp;L Structure &amp; Account Mapping</h1>
      </div>
      <p className="text-sm text-stone-400 mb-5 ml-12">Map each QBO account to a management P&amp;L line and a profit centre. Select several accounts to classify them in bulk. (Class-level sub-mapping and line editing land next.)</p>

      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error}</div>}

      {loading ? (
        <div className="text-sm text-stone-500 py-12">Loading…</div>
      ) : !statement ? (
        <div className={`${card} p-10 text-center`}>
          <p className="text-stone-300 mb-1">No management P&amp;L structure yet.</p>
          <p className="text-sm text-stone-500 mb-4">Start from the standard layout, then tailor it.</p>
          <button onClick={seed} disabled={busy} className={`${btn} bg-blue-600 hover:bg-blue-700 text-white mx-auto disabled:opacity-40`}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Create standard Management P&amp;L
          </button>
        </div>
      ) : (
        <div className="grid md:grid-cols-[240px_1fr] gap-5">
          <div className={`${card} p-4 h-fit`}>
            <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-2">P&amp;L Structure</div>
            <ul className="space-y-1 text-[13px]">
              {structLines.map((l) => (
                <li key={l.id} className={l.lineKind === "computed" ? "text-blue-300 font-medium" : "text-stone-300"}>{l.name}{l.lineKind === "computed" && <span className="text-[10px] text-stone-600 ml-1">(computed)</span>}</li>
              ))}
            </ul>
          </div>

          <div>
            <div className="flex items-center gap-3 mb-3 text-[13px]">
              {unmapped === 0
                ? <span className="inline-flex items-center gap-1.5 text-emerald-400"><CheckCircle2 size={15} /> All {accounts.length} accounts mapped</span>
                : <span className="inline-flex items-center gap-1.5 text-amber-400"><AlertTriangle size={15} /> {unmapped} of {accounts.length} accounts unmapped</span>}
              {!pcDim && <span className="text-stone-500">· Define profit centres to enable that column</span>}
            </div>

            {/* Batch bar */}
            {selIds.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mb-3 px-3 py-2 rounded-lg border border-blue-500/40 bg-blue-500/10 text-[13px]">
                <span className="text-blue-200 font-medium">{selIds.length} selected</span>
                <span className="text-stone-400">→ line</span>
                <select value={batchLine} onChange={(e) => setBatchLine(e.target.value)} className={input}>
                  <option value="">—</option>{lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <button onClick={() => batchLine && apply(selIds, { lineId: batchLine })} className={`${btn} bg-blue-600 hover:bg-blue-700 text-white py-1`}>Apply</button>
                {pcDim && <>
                  <span className="text-stone-400 ml-2">→ {pcDim.name}</span>
                  <select value={batchPc} onChange={(e) => setBatchPc(e.target.value)} className={input}>
                    <option value="">—</option>{pcs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <button onClick={() => batchPc && apply(selIds, { pcId: batchPc })} className={`${btn} bg-stone-700 hover:bg-stone-600 text-white py-1`}>Apply</button>
                </>}
                <button onClick={() => setSelected(new Set())} className="ml-auto text-stone-400 hover:text-stone-200 inline-flex items-center gap-1"><X size={14} /> clear</button>
              </div>
            )}

            {orderedSections.map((section) => (
              <div key={section} className="mb-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <input type="checkbox" className="accent-blue-500"
                    checked={bySection[section].every((a) => selected.has(a.id))}
                    onChange={(e) => setSelected((s) => { const n = new Set(s); bySection[section].forEach((a) => e.target.checked ? n.add(a.id) : n.delete(a.id)); return n; })} />
                  <span className="text-[11px] uppercase tracking-wider text-stone-500">{section} <span className="text-stone-600 normal-case">· {bySection[section].length}</span></span>
                </div>
                <div className={`${card} divide-y divide-stone-800`}>
                  {bySection[section].map((a) => (
                    <div key={a.id} className={`flex items-center gap-2 px-3 py-1.5 text-[13px] ${selected.has(a.id) ? "bg-blue-500/5" : ""}`}>
                      <input type="checkbox" className="accent-blue-500" checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
                      <span className="text-stone-300 flex-1 truncate">{a.number ? `${a.number} · ` : ""}{a.name}</span>
                      <select value={a.mappedLineId ?? ""} onChange={(e) => apply([a.id], { lineId: e.target.value })} className={`${input} w-48 ${a.mappedLineId ? "" : "border-amber-500/40"}`}>
                        <option value="">— line —</option>{lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                      {pcDim && (
                        <select value={a.mappedPcId ?? ""} onChange={(e) => apply([a.id], { pcId: e.target.value })} className={`${input} w-40`}>
                          <option value="">— {pcDim.name} —</option>{pcs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      )}
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
