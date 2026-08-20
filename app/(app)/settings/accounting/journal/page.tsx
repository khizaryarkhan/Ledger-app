"use client";

/**
 * General Ledger — manual journal entries + trial balance.
 * The first UI on the posting engine (lib/ledger). Entries are immutable:
 * mistakes are reversed, never edited.
 */

import Link from "next/link";
import { useState, useEffect, useMemo } from "react";
import { ChevronLeft, Plus, X, RefreshCw, ChevronDown, ChevronUp, Undo2, Scale, BookOpen } from "lucide-react";

type Line = {
  accountId: string; description: string; debit: string; credit: string;
  classId: string; locationId: string;
  nameType?: string; nameId?: string; nameLabel?: string;
};
type Entry = any;

const money = (n: number) => new Intl.NumberFormat("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const todayStr = () => new Date().toISOString().slice(0, 10);
const emptyLine = (): Line => ({ accountId: "", description: "", debit: "", credit: "", classId: "", locationId: "", nameType: "", nameId: "", nameLabel: "" });

// What "Name" a line needs, based on its account. A/R → Customer (required),
// A/P → Vendor (required), a payroll expense → Employee (optional).
function nameReq(acc: any): { kind: "Customer" | "Vendor" | "Employee"; required: boolean } | null {
  if (!acc) return null;
  if (acc.type === "Accounts Receivable") return { kind: "Customer", required: true };
  if (acc.type === "Accounts Payable") return { kind: "Vendor", required: true };
  const s = `${acc.subtype ?? ""} ${acc.name ?? ""}`.toLowerCase();
  if (/payroll|salaries|wages/.test(s)) return { kind: "Employee", required: false };
  return null;
}

const TYPE_GROUPS: [string, string[]][] = [
  ["Assets", ["Bank", "Accounts Receivable", "Other Current Asset", "Fixed Asset", "Other Asset"]],
  ["Liabilities", ["Accounts Payable", "Credit Card", "Other Current Liability", "Long Term Liability"]],
  ["Equity", ["Equity"]],
  ["Income", ["Income", "Other Income"]],
  ["Expenses", ["Cost of Goods Sold", "Expense", "Other Expense"]],
];

export default function JournalPage() {
  const [view, setView] = useState<"journal" | "tb">("journal");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [dims, setDims] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  // New entry modal
  const [showNew, setShowNew] = useState(false);
  const [entryDate, setEntryDate] = useState(todayStr());
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine()]);
  const [posting, setPosting] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  // Trial balance
  const [tbAsOf, setTbAsOf] = useState(todayStr());
  const [tb, setTb] = useState<any>(null);
  const [tbLoading, setTbLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [e, a, d, c, s] = await Promise.all([
        fetch("/api/ledger/journal").then(r => r.json()),
        fetch("/api/accounting/accounts").then(r => r.json()),
        fetch("/api/accounting/dimensions").then(r => r.json()),
        fetch("/api/customers").then(r => r.json()).catch(() => []),
        fetch("/api/payables/suppliers").then(r => r.json()).catch(() => []),
      ]);
      setEntries(Array.isArray(e) ? e : []);
      setAccounts(Array.isArray(a) ? a.filter((x: any) => x.status !== "Inactive") : []);
      setDims(Array.isArray(d) ? d.filter((x: any) => x.status !== "Inactive") : []);
      setCustomers(Array.isArray(c) ? c : (Array.isArray(c?.customers) ? c.customers : []));
      setSuppliers(Array.isArray(s) ? s : (Array.isArray(s?.suppliers) ? s.suppliers : []));
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  // Opened from the global "+ Create" launcher (…/journal?new=1).
  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1") setShowNew(true);
  }, []);

  async function loadTb() {
    setTbLoading(true);
    try {
      const r = await fetch(`/api/ledger/trial-balance?asOf=${tbAsOf}`);
      setTb(await r.json());
    } finally { setTbLoading(false); }
  }
  useEffect(() => { if (view === "tb") loadTb(); }, [view, tbAsOf]);

  const classes   = useMemo(() => dims.filter(d => d.dimensionType === "Class"), [dims]);
  const locations = useMemo(() => dims.filter(d => ["Location", "Department"].includes(d.dimensionType)), [dims]);
  const accById   = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);

  const totals = useMemo(() => {
    const dr = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const cr = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    return { dr: Math.round(dr * 100) / 100, cr: Math.round(cr * 100) / 100 };
  }, [lines]);
  const balanced = totals.dr > 0 && Math.abs(totals.dr - totals.cr) < 0.005;

  // Every A/R (Customer) and A/P (Vendor) line must name its party before posting.
  const namesOk = useMemo(() => lines.every(l => {
    if (!l.accountId) return true;
    const req = nameReq(accById.get(l.accountId));
    return !(req?.required) || !!(l.nameLabel && l.nameLabel.trim());
  }), [lines, accById]);
  const canPost = balanced && namesOk;

  function setLine(i: number, patch: Partial<Line>) {
    setLines(p => p.map((l, j) => j === i ? { ...l, ...patch } : l));
  }

  async function post() {
    setPosting(true); setErrMsg("");
    try {
      const payload = {
        entryDate, memo: memo.trim() || undefined,
        lines: lines
          .filter(l => l.accountId && (Number(l.debit) > 0 || Number(l.credit) > 0))
          .map(l => ({
            accountId: l.accountId,
            ...(Number(l.debit)  > 0 ? { debit:  Number(l.debit) }  : {}),
            ...(Number(l.credit) > 0 ? { credit: Number(l.credit) } : {}),
            description: l.description.trim() || null,
            classId: l.classId || null,
            locationId: l.locationId || null,
            nameType: l.nameType || null,
            nameId: l.nameId || null,
            nameLabel: (l.nameLabel || "").trim() || null,
          })),
      };
      const res = await fetch("/api/ledger/journal", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErrMsg(d.error || "Failed to post"); return; }
      setShowNew(false); setMemo(""); setLines([emptyLine(), emptyLine()]); setEntryDate(todayStr());
      await load();
    } finally { setPosting(false); }
  }

  async function reverse(entry: Entry) {
    if (!confirm(`Reverse JE-${entry.entryNumber}? A mirrored entry will be posted; the original stays on record.`)) return;
    const res = await fetch(`/api/ledger/journal/${entry.id}/reverse`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || "Failed to reverse"); return; }
    await load();
  }

  const thCls = "px-3 py-2 text-[11px] font-semibold text-stone-500 uppercase tracking-wider text-left whitespace-nowrap";
  const inputCls = "w-full text-[12px] border border-stone-700 rounded-lg px-2 py-1.5 bg-stone-900 text-stone-200 placeholder-stone-600 outline-none focus:ring-1 focus:ring-emerald-500";

  return (
    <div className="min-h-screen bg-stone-950 text-stone-200">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <Link href="/accounting" className="inline-flex items-center gap-1 text-[12px] text-stone-500 hover:text-stone-300 mb-2">
          <ChevronLeft size={13} /> Accounting
        </Link>
        <div className="flex items-end justify-between flex-wrap gap-3 mb-5">
          <div>
            <h1 className="text-xl font-bold text-white">General Ledger</h1>
            <p className="text-[13px] text-stone-500 mt-0.5">Manual journal entries and the trial balance. Entries are immutable — corrections are posted as reversals.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></button>
            <button onClick={() => { setErrMsg(""); setShowNew(true); }}
              className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-2 hover:bg-emerald-700 transition-colors">
              <Plus size={14} /> New journal entry
            </button>
          </div>
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-1 border-b border-stone-800 mb-4">
          <button onClick={() => setView("journal")}
            className={`flex items-center gap-1.5 text-[13px] font-medium px-3.5 py-2.5 border-b-2 -mb-px transition-colors ${view === "journal" ? "border-emerald-500 text-white" : "border-transparent text-stone-500 hover:text-stone-300"}`}>
            <BookOpen size={13} /> Journal <span className="text-[11px] text-stone-600">{entries.length}</span>
          </button>
          <button onClick={() => setView("tb")}
            className={`flex items-center gap-1.5 text-[13px] font-medium px-3.5 py-2.5 border-b-2 -mb-px transition-colors ${view === "tb" ? "border-emerald-500 text-white" : "border-transparent text-stone-500 hover:text-stone-300"}`}>
            <Scale size={13} /> Trial Balance
          </button>
        </div>

        {/* ══ Journal list ══ */}
        {view === "journal" && (
          loading ? (
            <div className="flex justify-center py-20"><div className="w-7 h-7 border-4 border-stone-700 border-t-emerald-500 rounded-full animate-spin" /></div>
          ) : entries.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-stone-800 rounded-xl">
              <p className="text-stone-500 text-sm">No journal entries yet — post your first with the button above.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-stone-800">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-stone-900">
                  <tr className="border-b border-stone-800">
                    <th className={thCls}>Entry</th><th className={thCls}>Date</th><th className={thCls}>Memo</th><th className={thCls}>Source</th><th className={`${thCls} text-right`}>Amount</th><th className={thCls}>Status</th><th className={`${thCls} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(e => {
                    const total = (e.lines ?? []).reduce((s: number, l: any) => s + Number(l.debit || 0), 0);
                    const expanded = openId === e.id;
                    return (
                      <FragmentRow key={e.id}>
                        <tr className={`border-b border-stone-800/60 hover:bg-stone-900/50 cursor-pointer ${e.status === "Reversed" ? "opacity-50" : ""}`}
                          onClick={() => setOpenId(expanded ? null : e.id)}>
                          <td className="px-3 py-2 font-mono text-[12px] text-stone-300">JE-{e.entryNumber}</td>
                          <td className="px-3 py-2 text-[12px] text-stone-400 whitespace-nowrap">{e.entryDate}</td>
                          <td className="px-3 py-2 text-[13px] text-stone-300 max-w-[280px] truncate">{e.memo ?? "—"}</td>
                          <td className="px-3 py-2">
                            <span className={`text-[10px] font-medium border rounded-full px-2 py-0.5 ${e.sourceType === "Manual" ? "bg-stone-800 text-stone-400 border-stone-700" : e.sourceType === "Reversal" ? "bg-amber-500/10 text-amber-400 border-amber-800" : "bg-sky-500/10 text-sky-400 border-sky-800"}`}>{e.sourceType}</span>
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-white tabular-nums">{money(total)}</td>
                          <td className="px-3 py-2 text-[12px]">
                            {e.status === "Reversed"
                              ? <span className="text-amber-500">Reversed</span>
                              : <span className="text-emerald-500">Posted</span>}
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap" onClick={ev => ev.stopPropagation()}>
                            {e.status === "Posted" && e.sourceType !== "Reversal" && (
                              <button onClick={() => reverse(e)} title="Reverse this entry"
                                className="inline-flex items-center gap-1 text-[11px] text-stone-500 hover:text-amber-400">
                                <Undo2 size={12} /> Reverse
                              </button>
                            )}
                            <button onClick={() => setOpenId(expanded ? null : e.id)} className="ml-2 text-stone-600 hover:text-stone-300">
                              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            </button>
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="bg-stone-900/40 border-b border-stone-800">
                            <td colSpan={7} className="px-6 py-3">
                              <table className="w-full text-[12px]">
                                <thead>
                                  <tr className="text-stone-600 text-[10px] uppercase tracking-wider">
                                    <th className="text-left py-1">Account</th><th className="text-left py-1">Description</th><th className="text-right py-1">Debit</th><th className="text-right py-1">Credit</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(e.lines ?? []).map((l: any) => (
                                    <tr key={l.id} className="border-t border-stone-800/50">
                                      <td className="py-1.5 text-stone-300">{(accById.get(l.accountId) as any)?.name ?? l.accountId}</td>
                                      <td className="py-1.5 text-stone-500">{l.description ?? "—"}</td>
                                      <td className="py-1.5 text-right tabular-nums text-stone-200">{Number(l.debit) > 0 ? money(Number(l.debit)) : ""}</td>
                                      <td className="py-1.5 text-right tabular-nums text-stone-200">{Number(l.credit) > 0 ? money(Number(l.credit)) : ""}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </FragmentRow>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* ══ Trial balance ══ */}
        {view === "tb" && (
          <>
            <div className="flex items-center gap-3 mb-3">
              <label className="text-[12px] text-stone-500">As of</label>
              <input type="date" value={tbAsOf} onChange={e => setTbAsOf(e.target.value)} className={`${inputCls} w-40`} />
              {tb && !tb.balanced && (
                <span className="text-[12px] font-semibold text-rose-400 bg-rose-950/40 border border-rose-900 rounded-lg px-3 py-1.5">
                  ⚠ TRIAL BALANCE DOES NOT BALANCE — posting engine integrity error
                </span>
              )}
            </div>
            {tbLoading ? (
              <div className="flex justify-center py-20"><div className="w-7 h-7 border-4 border-stone-700 border-t-emerald-500 rounded-full animate-spin" /></div>
            ) : !tb || tb.lines.length === 0 ? (
              <div className="text-center py-16 border border-dashed border-stone-800 rounded-xl">
                <p className="text-stone-500 text-sm">No postings up to this date.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-stone-800">
                <table className="w-full text-sm min-w-[560px]">
                  <thead className="bg-stone-900">
                    <tr className="border-b border-stone-800">
                      <th className={thCls}>Account</th><th className={thCls}>Type</th><th className={`${thCls} text-right`}>Debit</th><th className={`${thCls} text-right`}>Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tb.lines.map((l: any) => (
                      <tr key={l.accountId} className="border-b border-stone-800/60">
                        <td className="px-3 py-2 text-stone-200">{l.code ? <span className="font-mono text-[11px] text-stone-500 mr-2">{l.code}</span> : null}{l.name}</td>
                        <td className="px-3 py-2 text-[12px] text-stone-500">{l.type ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-stone-200">{l.debit > 0 ? money(l.debit) : ""}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-stone-200">{l.credit > 0 ? money(l.credit) : ""}</td>
                      </tr>
                    ))}
                    <tr className="bg-stone-900 font-bold">
                      <td className="px-3 py-2.5 text-white" colSpan={2}>TOTAL</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-white">{money(tb.totalDebit)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-white">{money(tb.totalCredit)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* ══ New entry modal ══ */}
      {showNew && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => !posting && setShowNew(false)}>
          <div className="bg-stone-900 border border-stone-700 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-stone-800">
              <h2 className="text-base font-semibold text-white">New journal entry</h2>
            </div>
            <div className="p-5 space-y-4">
              {errMsg && <div className="text-[12px] text-rose-400 bg-rose-950/40 border border-rose-900 rounded-lg px-3 py-2">{errMsg}</div>}
              <div className="flex gap-3">
                <div className="w-40">
                  <label className="block text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-1">Date *</label>
                  <input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)} className={inputCls} />
                </div>
                <div className="flex-1">
                  <label className="block text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-1">Memo</label>
                  <input value={memo} onChange={e => setMemo(e.target.value)} placeholder="What is this entry for?" className={inputCls} />
                </div>
              </div>

              {/* Lines */}
              <div className="rounded-xl border border-stone-800 overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead className="bg-stone-950/60">
                    <tr className="text-stone-600 text-[10px] uppercase tracking-wider">
                      <th className="text-left px-2 py-2.5 w-8">#</th>
                      <th className="text-left px-2 py-2.5 w-[22%]">Account *</th>
                      <th className="text-right px-2 py-2.5 w-28">Debit</th>
                      <th className="text-right px-2 py-2.5 w-28">Credit</th>
                      <th className="text-left px-2 py-2.5">Description</th>
                      <th className="text-left px-2 py-2.5 w-[20%]">Name</th>
                      <th className="text-left px-2 py-2.5 w-28">Class</th>
                      <th className="text-left px-2 py-2.5 w-28">Location</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const req = nameReq(accById.get(l.accountId));
                      const partyList = req?.kind === "Customer" ? customers : req?.kind === "Vendor" ? suppliers : [];
                      const dlId = `party-${req?.kind ?? ""}-${i}`;
                      return (
                      <tr key={i} className="border-t border-stone-800/60">
                        <td className="px-2 py-1.5 text-stone-600 tabular-nums text-center">{i + 1}</td>
                        <td className="px-1.5 py-1.5">
                          <select value={l.accountId}
                            onChange={e => setLine(i, { accountId: e.target.value, nameType: "", nameId: "", nameLabel: "" })}
                            className={inputCls}>
                            <option value="">Pick account…</option>
                            {TYPE_GROUPS.map(([group, types]) => {
                              const opts = accounts.filter(a => types.includes(a.type));
                              if (!opts.length) return null;
                              return (
                                <optgroup key={group} label={group}>
                                  {opts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                </optgroup>
                              );
                            })}
                          </select>
                        </td>
                        <td className="px-1.5 py-1.5"><input type="number" step="0.01" min="0" value={l.debit}
                          onChange={e => setLine(i, { debit: e.target.value, ...(e.target.value ? { credit: "" } : {}) })}
                          className={`${inputCls} text-right`} /></td>
                        <td className="px-1.5 py-1.5"><input type="number" step="0.01" min="0" value={l.credit}
                          onChange={e => setLine(i, { credit: e.target.value, ...(e.target.value ? { debit: "" } : {}) })}
                          className={`${inputCls} text-right`} /></td>
                        <td className="px-1.5 py-1.5"><input value={l.description} onChange={e => setLine(i, { description: e.target.value })} className={inputCls} /></td>
                        <td className="px-1.5 py-1.5">
                          {req ? (
                            <>
                              <input list={dlId} value={l.nameLabel ?? ""} placeholder={`${req.kind}${req.required ? " *" : ""}`}
                                onChange={e => {
                                  const val = e.target.value;
                                  const match = partyList.find((p: any) => (p.name ?? p.displayName ?? "").toLowerCase() === val.toLowerCase());
                                  setLine(i, { nameType: req.kind, nameLabel: val, nameId: match?.id ?? "" });
                                }}
                                className={`${inputCls} ${req.required && !(l.nameLabel && l.nameLabel.trim()) ? "border-amber-600" : ""}`} />
                              {partyList.length > 0 && (
                                <datalist id={dlId}>{partyList.map((p: any) => <option key={p.id} value={p.name ?? p.displayName} />)}</datalist>
                              )}
                            </>
                          ) : <span className="text-stone-700 pl-1">—</span>}
                        </td>
                        <td className="px-1.5 py-1.5">
                          <select value={l.classId} onChange={e => setLine(i, { classId: e.target.value })} className={inputCls}>
                            <option value="">—</option>
                            {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </td>
                        <td className="px-1.5 py-1.5">
                          <select value={l.locationId} onChange={e => setLine(i, { locationId: e.target.value })} className={inputCls}>
                            <option value="">—</option>
                            {locations.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </td>
                        <td className="px-1.5 py-1.5 text-center">
                          {lines.length > 2 && (
                            <button onClick={() => setLines(p => p.filter((_, j) => j !== i))} className="text-stone-600 hover:text-rose-400"><X size={13} /></button>
                          )}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="flex items-center justify-between px-3 py-2 bg-stone-950/60 border-t border-stone-800">
                  <button onClick={() => setLines(p => [...p, emptyLine()])} className="text-[12px] text-emerald-400 hover:text-emerald-300 font-medium">+ Add line</button>
                  <div className="flex items-center gap-4 text-[12px] tabular-nums">
                    <span className="text-stone-500">Debits <span className="text-stone-200 font-semibold ml-1">{money(totals.dr)}</span></span>
                    <span className="text-stone-500">Credits <span className="text-stone-200 font-semibold ml-1">{money(totals.cr)}</span></span>
                    <span className={`font-semibold px-2 py-0.5 rounded-full text-[11px] border ${balanced ? "text-emerald-400 bg-emerald-500/10 border-emerald-800" : "text-rose-400 bg-rose-500/10 border-rose-900"}`}>
                      {balanced ? "Balanced ✓" : `Off by ${money(Math.abs(totals.dr - totals.cr))}`}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="p-5 border-t border-stone-800 flex items-center justify-end gap-2">
              <button onClick={() => setShowNew(false)} disabled={posting} className="text-[13px] text-stone-400 hover:text-white px-3 py-2">Cancel</button>
              <button onClick={post} disabled={posting || !canPost}
                className="text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-4 py-2 disabled:opacity-40 hover:bg-emerald-700 transition-colors">
                {posting ? "Posting…" : "Post entry"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
