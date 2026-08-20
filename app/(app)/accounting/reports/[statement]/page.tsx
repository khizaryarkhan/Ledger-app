"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { FileText, Loader2, ScrollText, Scale } from "lucide-react";

const TITLES: Record<string, { title: string; sub: string; icon: any }> = {
  "trial-balance":  { title: "Trial Balance",   sub: "Every account's balance — total debits must equal total credits.", icon: ScrollText },
  "profit-loss":    { title: "Profit & Loss",   sub: "Statement of profit or loss for the period.", icon: FileText },
  "balance-sheet":  { title: "Balance Sheet",   sub: "Statement of financial position — assets = equity + liabilities.", icon: Scale },
};

const fmtMoney = (n: number) => {
  const v = Math.abs(Math.round(n)).toLocaleString();
  return n < 0 ? `(${v})` : v;
};

export default function FinancialStatementPage() {
  const statement = String(useParams().statement || "trial-balance");
  const meta = TITLES[statement] ?? TITLES["trial-balance"];
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<string>(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    setData(null); setError(null);
    const qs = statement === "profit-loss"
      ? `statement=profit-loss&to=${asOf}`
      : `statement=${statement}&asOf=${asOf}`;
    fetch(`/api/financials?${qs}`)
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d; })
      .then(setData).catch((e) => setError(e.message));
  }, [statement, asOf]);

  const Icon = meta.icon;

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-teal-500/15 flex items-center justify-center"><Icon size={18} className="text-teal-400" /></div>
        <h1 className="text-xl font-semibold text-stone-100">{meta.title}</h1>
      </div>
      <p className="text-sm text-stone-400 mb-4 ml-12">{meta.sub}</p>

      <div className="flex items-center gap-2 mb-5 ml-12">
        <label className="text-[12px] text-stone-400">{statement === "profit-loss" ? "Up to" : "As at"}
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)}
            className="ml-2 bg-stone-900 border border-stone-700 rounded-lg px-2 py-1 text-sm text-stone-100" />
        </label>
      </div>

      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error}</div>}
      {!data && !error && <div className="text-sm text-stone-500 flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Building statement…</div>}

      {data && statement === "trial-balance" && <TrialBalance data={data} />}
      {data && statement === "profit-loss" && <ProfitLoss data={data} />}
      {data && statement === "balance-sheet" && <BalanceSheet data={data} />}
    </div>
  );
}

function empty() { return <div className="text-sm text-stone-500 py-8 text-center border border-dashed border-stone-800 rounded-xl">No posted ledger entries yet. Post a manual journal or a transaction and it appears here.</div>; }

const rowCls = "flex items-center justify-between py-1.5 text-[13px]";
const money = "tabular-nums text-stone-200";

function TrialBalance({ data }: { data: any }) {
  if (!data.rows.length) return empty();
  return (
    <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-stone-800 text-[11px] uppercase tracking-wider text-stone-500">
        <span>Account</span><span className="flex gap-8"><span className="w-24 text-right">Debit</span><span className="w-24 text-right">Credit</span></span>
      </div>
      {data.rows.map((r: any, i: number) => (
        <div key={i} className="flex items-center justify-between px-4 py-1.5 text-[13px] border-b border-stone-800/50">
          <span className="text-stone-200">{r.code ? <span className="text-stone-600 font-mono mr-2">{r.code}</span> : null}{r.name}</span>
          <span className="flex gap-8"><span className={`w-24 text-right ${money}`}>{r.debit ? fmtMoney(r.debit) : ""}</span><span className={`w-24 text-right ${money}`}>{r.credit ? fmtMoney(r.credit) : ""}</span></span>
        </div>
      ))}
      <div className="flex items-center justify-between px-4 py-2.5 font-semibold text-stone-100 border-t border-stone-700">
        <span>Total</span><span className="flex gap-8"><span className="w-24 text-right tabular-nums">{fmtMoney(data.totalDebit)}</span><span className="w-24 text-right tabular-nums">{fmtMoney(data.totalCredit)}</span></span>
      </div>
      {!data.balanced && <div className="px-4 py-2 text-[12px] text-rose-400 border-t border-stone-800">⚠ Out of balance by {fmtMoney(data.totalDebit - data.totalCredit)} — a ledger integrity issue.</div>}
    </div>
  );
}

function Section({ title, lines, total, strong }: { title: string; lines: any[]; total: number; strong?: boolean }) {
  return (
    <div className="mb-1">
      <div className="text-[11px] uppercase tracking-wider text-stone-500 px-4 pt-3 pb-1">{title}</div>
      {lines.length === 0 ? <div className="px-4 py-1 text-[12px] text-stone-600">—</div> :
        lines.map((l: any, i: number) => (
          <div key={i} className={`${rowCls} px-4`}>
            <span className="text-stone-300">{l.name}</span><span className={money}>{fmtMoney(l.amount)}</span>
          </div>
        ))}
      <div className={`${rowCls} px-4 border-t border-stone-800/70 ${strong ? "font-semibold text-stone-100" : "text-stone-200"}`}>
        <span>Total {title}</span><span className="tabular-nums">{fmtMoney(total)}</span>
      </div>
    </div>
  );
}

function Subtotal({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between px-4 py-2 my-1 bg-stone-800/40 font-semibold text-stone-100 text-[13px]">
      <span>{label}</span><span className="tabular-nums">{fmtMoney(value)}</span>
    </div>
  );
}

function ProfitLoss({ data }: { data: any }) {
  const rev = data.sections[0], cos = data.sections[1];
  const hasAny = rev.lines.length || cos.lines.length || data.otherIncome.lines.length || data.operatingExpenses.lines.length;
  if (!hasAny) return empty();
  return (
    <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden pb-2">
      <Section title="Revenue" lines={rev.lines} total={rev.total} />
      <Section title="Cost of Sales" lines={cos.lines} total={cos.total} />
      <Subtotal label="Gross Profit" value={data.grossProfit} />
      <Section title="Other Income" lines={data.otherIncome.lines} total={data.otherIncome.total} />
      <Section title="Operating Expenses" lines={data.operatingExpenses.lines} total={data.operatingExpenses.total} />
      <Section title="Finance Costs" lines={data.financeCosts.lines} total={data.financeCosts.total} />
      <Subtotal label="Profit Before Tax" value={data.profitBeforeTax} />
      <Section title="Taxation" lines={data.taxation.lines} total={data.taxation.total} />
      <div className="flex items-center justify-between px-4 py-3 mt-1 border-t-2 border-teal-800 font-bold text-stone-100 text-[14px]">
        <span>Net Profit for the Period</span><span className="tabular-nums text-teal-300">{fmtMoney(data.netProfit)}</span>
      </div>
    </div>
  );
}

function BalanceSheet({ data }: { data: any }) {
  return (
    <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden pb-2">
      <div className="px-4 pt-3 pb-1 text-[12px] font-semibold text-teal-300 uppercase tracking-wider">Assets</div>
      <Section title="Non-current Assets" lines={data.assets.nonCurrent} total={data.assets.nonCurrent.reduce((s: number, l: any) => s + l.amount, 0)} />
      <Section title="Current Assets" lines={data.assets.current} total={data.assets.current.reduce((s: number, l: any) => s + l.amount, 0)} />
      <Subtotal label="Total Assets" value={data.assets.total} />

      <div className="px-4 pt-3 pb-1 text-[12px] font-semibold text-teal-300 uppercase tracking-wider">Equity &amp; Liabilities</div>
      <Section title="Equity" lines={data.equity.lines} total={data.equity.total} strong />
      <Section title="Non-current Liabilities" lines={data.liabilities.nonCurrent} total={data.liabilities.nonCurrent.reduce((s: number, l: any) => s + l.amount, 0)} />
      <Section title="Current Liabilities" lines={data.liabilities.current} total={data.liabilities.current.reduce((s: number, l: any) => s + l.amount, 0)} />
      <Subtotal label="Total Equity & Liabilities" value={data.totalEquityAndLiabilities} />

      {!data.balanced && <div className="px-4 py-2 text-[12px] text-rose-400 border-t border-stone-800">⚠ Does not balance — assets ≠ equity + liabilities.</div>}
    </div>
  );
}
