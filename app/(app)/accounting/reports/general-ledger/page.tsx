"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BookOpen, Loader } from "lucide-react";
import { txnTypeLabel } from "@/lib/accounting/doc-format";

const today = () => new Date().toISOString().slice(0, 10);
function fyStart() { const n = new Date(); const y = n.getMonth() >= 6 ? n.getFullYear() : n.getFullYear() - 1; return `${y}-07-01`; }
const money = (n: number) => (n < 0 ? `(${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export default function GeneralLedgerPage() {
  return <Suspense fallback={<div className="p-6 text-sm text-stone-500">Loading…</div>}><GeneralLedgerInner /></Suspense>;
}

function GeneralLedgerInner() {
  // Drilled into from a report number: ?accountId=&from=&to=
  const sp = useSearchParams();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [accountId, setAccountId] = useState(sp.get("accountId") || "");
  const [from, setFrom] = useState(sp.get("from") || fyStart());
  const [to, setTo] = useState(sp.get("to") || today());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [showFx, setShowFx] = useState(false);

  useEffect(() => { fetch("/api/accounting/accounts").then(r => r.json()).then(a => setAccounts(Array.isArray(a) ? a : [])).catch(() => {}); }, []);

  async function run() {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ statement: "general-ledger", from, to });
      if (accountId) qs.set("accountId", accountId);
      const d = await fetch(`/api/financials?${qs}`).then(r => r.json());
      setData(d);
    } finally { setLoading(false); }
  }
  useEffect(() => { run(); /* eslint-disable-next-line */ }, [accountId, from, to]);

  const curr = data?.meta?.currency || "";
  const input = "bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-100";
  const anyFx = useMemo(() => (data?.accounts ?? []).some((a: any) => a.rows.some((r: any) => r.currency)), [data]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-teal-500/15 flex items-center justify-center"><BookOpen size={17} className="text-teal-400" /></div>
        <h1 className="text-xl font-semibold text-stone-100">General Ledger</h1>
      </div>
      <p className="text-sm text-stone-400 mb-5 ml-12">{data?.meta?.entity} — every posting with its type, document and running balance.</p>

      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div><label className="block text-[11px] uppercase tracking-wider text-stone-500 mb-1">Account</label>
          <select value={accountId} onChange={e => setAccountId(e.target.value)} className={`${input} min-w-[240px]`}>
            <option value="">All accounts</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.code ? `${a.code} · ` : ""}{a.name}</option>)}
          </select>
        </div>
        <div><label className="block text-[11px] uppercase tracking-wider text-stone-500 mb-1">From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} className={input} /></div>
        <div><label className="block text-[11px] uppercase tracking-wider text-stone-500 mb-1">To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} className={input} /></div>
        {anyFx && (
          <label className="flex items-center gap-1.5 text-[12px] text-stone-400 mb-2 cursor-pointer">
            <input type="checkbox" checked={showFx} onChange={e => setShowFx(e.target.checked)} /> Show foreign currency
          </label>
        )}
        {loading && <Loader size={16} className="animate-spin text-stone-500 mb-2" />}
      </div>

      {!data ? null : (data.accounts ?? []).length === 0 ? (
        <div className="rounded-xl bg-stone-900 border border-stone-800 p-8 text-center text-stone-500 text-sm">No postings in this period.</div>
      ) : (
        <div className="space-y-6">
          {data.accounts.map((a: any) => (
            <div key={a.account.id} className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-800 bg-stone-950/40">
                <div className="font-semibold text-stone-100 text-[14px]">{a.account.code ? `${a.account.code} · ` : ""}{a.account.name}</div>
                <div className="text-[12px] text-stone-500">Opening <span className="tabular-nums text-stone-300">{money(a.opening)}</span></div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px] min-w-[720px]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                      <th className="text-left px-4 py-2">Date</th>
                      <th className="text-left px-4 py-2">Type</th>
                      <th className="text-left px-4 py-2">No.</th>
                      <th className="text-left px-4 py-2">Name / Memo</th>
                      <th className="text-right px-4 py-2">Debit</th>
                      <th className="text-right px-4 py-2">Credit</th>
                      <th className="text-right px-4 py-2">Balance</th>
                      {showFx && anyFx && (
                        <>
                          <th className="text-right px-4 py-2">Foreign amount</th>
                          <th className="text-left px-4 py-2">Ccy</th>
                          <th className="text-right px-4 py-2">Rate</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {a.rows.map((r: any, i: number) => (
                      <tr key={i} className="border-b border-stone-800/50">
                        <td className="px-4 py-1.5 text-stone-400 whitespace-nowrap">{r.date}</td>
                        <td className="px-4 py-1.5">
                          <span className="text-[11px] font-medium text-teal-300 bg-teal-500/10 border border-teal-800/40 rounded px-1.5 py-0.5">{txnTypeLabel(r.sourceType)}</span>
                        </td>
                        <td className="px-4 py-1.5 font-mono text-[12px]">
                          {r.entryId ? <Link href={`/accounting/transactions/${r.entryId}`} className="text-teal-400 hover:underline">{r.docNumber}</Link> : <span className="text-stone-400">{r.docNumber}</span>}
                        </td>
                        <td className="px-4 py-1.5 text-stone-300 max-w-[280px] truncate">{r.name ? <span className="text-stone-200">{r.name}</span> : null}{r.name && r.memo ? " · " : ""}{r.memo ? <span className="text-stone-500">{r.memo}</span> : (!r.name ? <span className="text-stone-600">—</span> : null)}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums text-stone-300">{r.debit ? money(r.debit) : ""}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums text-stone-300">{r.credit ? money(r.credit) : ""}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums text-stone-200">{money(r.balance)}</td>
                        {showFx && anyFx && (
                          <>
                            <td className="px-4 py-1.5 text-right tabular-nums text-stone-400">{r.currency ? money(r.fxDebit || r.fxCredit || 0) : ""}</td>
                            <td className="px-4 py-1.5 text-stone-500">{r.currency ?? ""}</td>
                            <td className="px-4 py-1.5 text-right tabular-nums text-stone-500">{r.currency ? r.exchangeRate : ""}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-stone-800 font-semibold text-white">
                      <td className="px-4 py-2" colSpan={6}>Closing balance</td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(a.closing)} {curr}</td>
                      {showFx && anyFx && <td colSpan={3} />}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
