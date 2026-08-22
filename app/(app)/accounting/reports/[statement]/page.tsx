"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { FileText, Loader2, ScrollText, Scale } from "lucide-react";

const TITLES: Record<string, { title: string; formal: string; sub: string; icon: any }> = {
  "trial-balance":  { title: "Trial Balance",   formal: "Trial Balance",                    sub: "Every account's balance — total debits must equal total credits.", icon: ScrollText },
  "profit-loss":    { title: "Profit & Loss",   formal: "Statement of Profit or Loss",      sub: "Income and expenses for a chosen period.", icon: FileText },
  "balance-sheet":  { title: "Balance Sheet",   formal: "Statement of Financial Position",  sub: "Assets, equity and liabilities at a point in time.", icon: Scale },
};

const fmtMoney = (n: number) => {
  const v = Math.abs(Math.round(n)).toLocaleString();
  return n < 0 ? `(${v})` : v;
};

// "20 August 2026"
const fmtDate = (s?: string | null) => {
  if (!s) return "";
  const d = new Date(s + "T00:00:00");
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
};

// Pakistan fiscal year starts 1 July.
function fyStart(): string {
  const now = new Date();
  const y = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-07-01`;
}
const today = () => new Date().toISOString().slice(0, 10);

export default function FinancialStatementPage() {
  const statement = String(useParams().statement || "trial-balance");
  const meta = TITLES[statement] ?? TITLES["trial-balance"];
  const isPL = statement === "profit-loss";
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<string>(today);       // BS / TB "as at"
  const [from, setFrom] = useState<string>(fyStart);     // P&L period start
  const [to, setTo] = useState<string>(today);           // P&L period end

  useEffect(() => {
    setData(null); setError(null);
    const qs = isPL
      ? `statement=profit-loss&from=${from}&to=${to}`
      : `statement=${statement}&asOf=${asOf}`;
    fetch(`/api/financials?${qs}`)
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d; })
      .then(setData).catch((e) => setError(e.message));
  }, [statement, asOf, from, to, isPL]);

  const Icon = meta.icon;
  const periodLine = isPL
    ? `For the period ${fmtDate(from)} to ${fmtDate(to)}`
    : `As at ${fmtDate(asOf)}`;

  // Every account line drills into the General Ledger for that account over the
  // report's window — "click the number to see the transactions inside it".
  const drill = (accountId: string | null): string | null => {
    if (!accountId) return null;
    const p = new URLSearchParams({ accountId });
    if (isPL) { p.set("from", from); p.set("to", to); } else { p.set("to", asOf); }
    return `/accounting/reports/general-ledger?${p.toString()}`;
  };

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-teal-500/15 flex items-center justify-center"><Icon size={18} className="text-teal-400" /></div>
        <h1 className="text-xl font-semibold text-stone-100">{meta.title}</h1>
      </div>
      <p className="text-sm text-stone-400 mb-4 ml-12">{meta.sub}</p>

      <div className="flex items-center gap-3 mb-5 ml-12 flex-wrap">
        {isPL ? (
          <>
            <label className="text-[12px] text-stone-400">From
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)}
                className="ml-2 bg-stone-900 border border-stone-700 rounded-lg px-2 py-1 text-sm text-stone-100" />
            </label>
            <label className="text-[12px] text-stone-400">To
              <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)}
                className="ml-2 bg-stone-900 border border-stone-700 rounded-lg px-2 py-1 text-sm text-stone-100" />
            </label>
            <button onClick={() => { setFrom(fyStart()); setTo(today()); }}
              className="text-[12px] text-teal-400 hover:text-teal-300 border border-stone-700 rounded-lg px-2.5 py-1">This financial year</button>
          </>
        ) : (
          <label className="text-[12px] text-stone-400">As at
            <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)}
              className="ml-2 bg-stone-900 border border-stone-700 rounded-lg px-2 py-1 text-sm text-stone-100" />
          </label>
        )}
      </div>

      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error}</div>}
      {!data && !error && <div className="text-sm text-stone-500 flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Building statement…</div>}

      {data && (
        <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden">
          {/* Statement header — the way a CA presents it */}
          <div className="text-center px-4 py-4 border-b border-stone-800">
            <div className="text-[15px] font-bold text-stone-100">{data.meta?.entity ?? ""}</div>
            <div className="text-[13px] font-semibold text-stone-300 mt-0.5">{meta.formal}</div>
            <div className="text-[12px] text-stone-400 mt-0.5">{periodLine}</div>
            <div className="text-[11px] text-stone-500 mt-0.5">All amounts in {data.meta?.currency ?? ""}{data.meta?.consolidated ? " · consolidated across all branches" : ""}</div>
          </div>
          {statement === "trial-balance" && <TrialBalance data={data} drill={drill} />}
          {isPL && <ProfitLoss data={data} drill={drill} />}
          {statement === "balance-sheet" && <BalanceSheet data={data} drill={drill} />}
        </div>
      )}
    </div>
  );
}

function empty() { return <div className="text-sm text-stone-500 py-10 text-center">No posted ledger entries in this period yet. Post a manual journal or a transaction and it appears here.</div>; }

const rowCls = "flex items-center justify-between py-1.5 text-[13px]";
const money = "tabular-nums text-stone-200";

function TrialBalance({ data, drill }: { data: any; drill: (id: string | null) => string | null }) {
  if (!data.rows.length) return empty();
  return (
    <div>
      <div className="flex items-center justify-between px-4 py-2 border-b border-stone-800 text-[11px] uppercase tracking-wider text-stone-500">
        <span>Account</span><span className="flex gap-8"><span className="w-24 text-right">Debit</span><span className="w-24 text-right">Credit</span></span>
      </div>
      {data.rows.map((r: any, i: number) => {
        const href = drill(r.accountId);
        const inner = (
          <>
            <span className="text-stone-200 group-hover:text-white">{r.code ? <span className="text-stone-600 font-mono mr-2">{r.code}</span> : null}{r.name}</span>
            <span className="flex gap-8"><span className={`w-24 text-right ${money} ${href ? "text-teal-400 group-hover:underline" : ""}`}>{r.debit ? fmtMoney(r.debit) : ""}</span><span className={`w-24 text-right ${money} ${href ? "text-teal-400 group-hover:underline" : ""}`}>{r.credit ? fmtMoney(r.credit) : ""}</span></span>
          </>
        );
        return href
          ? <Link key={i} href={href} className="group flex items-center justify-between px-4 py-1.5 text-[13px] border-b border-stone-800/50 hover:bg-stone-800/40">{inner}</Link>
          : <div key={i} className="flex items-center justify-between px-4 py-1.5 text-[13px] border-b border-stone-800/50">{inner}</div>;
      })}
      <div className="flex items-center justify-between px-4 py-2.5 font-semibold text-stone-100 border-t border-stone-700">
        <span>Total</span><span className="flex gap-8"><span className="w-24 text-right tabular-nums">{fmtMoney(data.totalDebit)}</span><span className="w-24 text-right tabular-nums">{fmtMoney(data.totalCredit)}</span></span>
      </div>
      {!data.balanced && <div className="px-4 py-2 text-[12px] text-rose-400 border-t border-stone-800">⚠ Out of balance by {fmtMoney(data.totalDebit - data.totalCredit)} — a ledger integrity issue.</div>}
    </div>
  );
}

function Section({ title, lines, total, strong, drill }: { title: string; lines: any[]; total: number; strong?: boolean; drill?: (id: string | null) => string | null }) {
  return (
    <div className="mb-1">
      <div className="text-[11px] uppercase tracking-wider text-stone-500 px-4 pt-3 pb-1">{title}</div>
      {lines.length === 0 ? <div className="px-4 py-1 text-[12px] text-stone-600">—</div> :
        lines.map((l: any, i: number) => {
          const href = drill?.(l.accountId);
          return (
            <div key={i} className={`${rowCls} px-4 ${href ? "hover:bg-stone-800/40" : ""}`}>
              <span className="text-stone-300">{l.name}</span>
              {href
                ? <Link href={href} className="tabular-nums text-teal-400 hover:underline">{fmtMoney(l.amount)}</Link>
                : <span className={money}>{fmtMoney(l.amount)}</span>}
            </div>
          );
        })}
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

function ProfitLoss({ data, drill }: { data: any; drill: (id: string | null) => string | null }) {
  const rev = data.sections[0], cos = data.sections[1];
  const hasAny = rev.lines.length || cos.lines.length || data.otherIncome.lines.length || data.operatingExpenses.lines.length;
  if (!hasAny) return empty();
  return (
    <div className="pb-2">
      <Section title="Revenue" lines={rev.lines} total={rev.total} drill={drill} />
      <Section title="Cost of Sales" lines={cos.lines} total={cos.total} drill={drill} />
      <Subtotal label="Gross Profit" value={data.grossProfit} />
      <Section title="Other Income" lines={data.otherIncome.lines} total={data.otherIncome.total} drill={drill} />
      <Section title="Operating Expenses" lines={data.operatingExpenses.lines} total={data.operatingExpenses.total} drill={drill} />
      <Section title="Finance Costs" lines={data.financeCosts.lines} total={data.financeCosts.total} drill={drill} />
      <Subtotal label="Profit Before Tax" value={data.profitBeforeTax} />
      <Section title="Taxation" lines={data.taxation.lines} total={data.taxation.total} drill={drill} />
      <div className="flex items-center justify-between px-4 py-3 mt-1 border-t-2 border-teal-800 font-bold text-stone-100 text-[14px]">
        <span>Net Profit for the Period</span><span className="tabular-nums text-teal-300">{fmtMoney(data.netProfit)}</span>
      </div>
    </div>
  );
}

function BalanceSheet({ data, drill }: { data: any; drill: (id: string | null) => string | null }) {
  return (
    <div className="pb-2">
      <div className="px-4 pt-3 pb-1 text-[12px] font-semibold text-teal-300 uppercase tracking-wider">Assets</div>
      <Section title="Non-current Assets" lines={data.assets.nonCurrent} total={data.assets.nonCurrent.reduce((s: number, l: any) => s + l.amount, 0)} drill={drill} />
      <Section title="Current Assets" lines={data.assets.current} total={data.assets.current.reduce((s: number, l: any) => s + l.amount, 0)} drill={drill} />
      <Subtotal label="Total Assets" value={data.assets.total} />

      <div className="px-4 pt-3 pb-1 text-[12px] font-semibold text-teal-300 uppercase tracking-wider">Equity &amp; Liabilities</div>
      <Section title="Equity" lines={data.equity.lines} total={data.equity.total} strong drill={drill} />
      <Section title="Non-current Liabilities" lines={data.liabilities.nonCurrent} total={data.liabilities.nonCurrent.reduce((s: number, l: any) => s + l.amount, 0)} drill={drill} />
      <Section title="Current Liabilities" lines={data.liabilities.current} total={data.liabilities.current.reduce((s: number, l: any) => s + l.amount, 0)} drill={drill} />
      <Subtotal label="Total Equity & Liabilities" value={data.totalEquityAndLiabilities} />

      {!data.balanced && <div className="px-4 py-2 text-[12px] text-rose-400 border-t border-stone-800">⚠ Does not balance — assets ≠ equity + liabilities.</div>}
    </div>
  );
}
