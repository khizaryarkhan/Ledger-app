"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { useSession } from "next-auth/react";
import { Card, Badge } from "@/components/ui";
import { fmt, daysOverdue, getAgingBucket, daysFromNow, today } from "@/lib/format";
import { ArrowUpRight, ChevronRight, ChevronDown, ChevronUp, Circle, AlertTriangle, Mail, X, Printer } from "lucide-react";
import { ResponsesDashboardWidget } from "@/components/responses-dashboard-widget";
import { CurrencyPills } from "@/components/currency-pills";
import { classifyComposition } from "@/lib/receivable-composition";

// ── Shared open-balance helper ───────────────────────────────────────────────
// Uses qboBalance as the authoritative figure (set directly by the AR snapshot
// engine) and falls back to total-paid for any rows that pre-date the snapshot.
// Both the Dashboard KPI cards and the AR Health widget call this so they can
// never diverge.
function openBal(inv: any): number {
  if (inv.qboBalance != null) return Number(inv.qboBalance);
  return Math.max(0, Number(inv.total || 0) - Number(inv.paid || 0));
}

// ── AR Health widget ────────────────────────────────────────────────────────
function ArHealthWidget({ invoices, customers, projects, reps, communications }: any) {
  const [showAllBalances, setShowAllBalances] = useState(false);
  const filteredInvoices = invoices;

  const metrics = useMemo(() => {
    const open = filteredInvoices.filter((i: any) =>
      i.paymentStatus !== "Paid" &&
      i.paymentStatus !== "Written Off" &&
      i.txnType !== "CreditMemo"
    );
    const activeCMs = filteredInvoices.filter((i: any) => i.txnType === "CreditMemo" && openBal(i) < 0);
    const b = (i: any) => openBal(i);
    const grossAR   = open.reduce((s: number, i: any) => s + b(i), 0);
    const creditBal = activeCMs.reduce((s: number, i: any) => s + b(i), 0);
    const totalAR   = grossAR + creditBal;

    // Build per-currency breakdown for totalAR display
    const byCcy: Record<string, number> = {};
    open.forEach((i: any) => { const c = i.currency || "EUR"; byCcy[c] = (byCcy[c] || 0) + b(i); });
    activeCMs.forEach((i: any) => { const c = i.currency || "EUR"; byCcy[c] = (byCcy[c] || 0) + b(i); });
    const dominantCurrency = Object.keys(byCcy)[0] ?? "EUR";

    // Age every row (invoices + credits) by its own date — matches QBO.
    const aging = [...open, ...activeCMs];
    const current = aging.filter((i: any) => daysOverdue(i.dueDate) <= 0).reduce((s: number, i: any) => s + b(i), 0);
    const b1_30   = aging.filter((i: any) => { const d = daysOverdue(i.dueDate); return d > 0 && d <= 30; }).reduce((s: number, i: any) => s + b(i), 0);
    const b31_60  = aging.filter((i: any) => { const d = daysOverdue(i.dueDate); return d > 30 && d <= 60; }).reduce((s: number, i: any) => s + b(i), 0);
    const b61_90  = aging.filter((i: any) => { const d = daysOverdue(i.dueDate); return d > 60 && d <= 90; }).reduce((s: number, i: any) => s + b(i), 0);
    const b90plus = aging.filter((i: any) => daysOverdue(i.dueDate) > 90).reduce((s: number, i: any) => s + b(i), 0);

    const currentPct  = totalAR > 0 ? (current  / totalAR) * 100 : 0;
    const over90Pct   = totalAR > 0 ? (b90plus  / totalAR) * 100 : 0;
    const overdueRate = totalAR > 0 ? ((totalAR - current) / totalAR) * 100 : 0;

    const disputedAR  = open.filter((i: any) => i.collectionStage === "Disputed").reduce((s: number, i: any) => s + b(i), 0);
    const disputeRate = totalAR > 0 ? (disputedAR / totalAR) * 100 : 0;
    const highRiskAR  = open.filter((i: any) => {
      const c = customers.find((c: any) => c.id === i.customerId);
      return c?.riskRating === "High";
    }).reduce((s: number, i: any) => s + b(i), 0);
    const highRiskPct = totalAR > 0 ? (highRiskAR / totalAR) * 100 : 0;

    const brokenPromises = open.filter((i: any) =>
      i.promiseDate && !i.hasOpenDispute && daysOverdue(i.promiseDate) > 0
    ).length;
    const neverContacted = open.filter((i: any) => daysOverdue(i.dueDate) > 0 && !i.lastFollowupDate).length;

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const emails30d  = communications.filter((c: any) => c.direction === "Outbound" && c.channel === "Email" && new Date(c.sentAt).getTime() > thirtyDaysAgo).length;
    const replies30d = communications.filter((c: any) => c.direction === "Inbound"  && new Date(c.sentAt).getTime() > thirtyDaysAgo).length;

    const custCurrency = (invs: any[], cid: string) => invs.find((i: any) => i.customerId === cid)?.currency ?? "—";

    const byCust: Record<string, number> = {};
    open.forEach((i: any) => { byCust[i.customerId] = (byCust[i.customerId] || 0) + openBal(i); });
    const concentrationRows = Object.entries(byCust)
      .map(([cid, amt]) => {
        const custInvs = open.filter((i: any) => i.customerId === cid);
        const ag = { current: 0, b1_30: 0, b31_60: 0, b61_90: 0, b90plus: 0 };
        custInvs.forEach((i: any) => {
          const d = daysOverdue(i.dueDate);
          const v = openBal(i);
          if (d <= 0)       ag.current += v;
          else if (d <= 30) ag.b1_30   += v;
          else if (d <= 60) ag.b31_60  += v;
          else if (d <= 90) ag.b61_90  += v;
          else              ag.b90plus += v;
        });
        const total = amt as number;
        return {
          customer: customers.find((c: any) => c.id === cid),
          amount: total,
          pct: totalAR > 0 ? (total / totalAR) * 100 : 0,
          currency: custCurrency(open, cid),
          aging: ag,
        };
      })
      .filter(x => x.customer)
      .sort((a, b) => b.amount - a.amount);

    const repPortfolio = (reps ?? []).map((rep: any) => {
      const repInvs = open.filter((i: any) => {
        const c = customers.find((c: any) => c.id === i.customerId);
        const p = projects.find((p: any) => p.id === i.projectId);
        return c?.repId === rep.id || p?.repId === rep.id;
      });
      const repOpen    = repInvs.reduce((s: number, i: any) => s + b(i), 0);
      const repOverdue = repInvs.filter((i: any) => daysOverdue(i.dueDate) > 0).reduce((s: number, i: any) => s + b(i), 0);
      const custIds    = new Set(repInvs.map((i: any) => i.customerId));
      // dominant currency for this rep's portfolio
      const repByCcy: Record<string, number> = {};
      repInvs.forEach((i: any) => { const c = i.currency || "EUR"; repByCcy[c] = (repByCcy[c] || 0) + b(i); });
      const repCcy = Object.keys(repByCcy)[0] ?? "EUR";
      return { rep, openAR: repOpen, overdueAR: repOverdue, custCount: custIds.size, currency: repCcy };
    }).filter((r: any) => r.openAR > 0 || r.overdueAR > 0);

    return {
      totalAR, byCcy, dominantCurrency,
      current, b1_30, b31_60, b61_90, b90plus,
      currentPct, over90Pct, overdueRate,
      disputeRate, highRiskPct,
      brokenPromises, neverContacted,
      concentrationRows, repPortfolio,
      openCount: open.length,
    };
  }, [filteredInvoices, customers, projects, reps, communications]);

  const {
    totalAR, byCcy, dominantCurrency,
    current, b1_30, b31_60, b61_90, b90plus,
    currentPct, over90Pct, overdueRate,
    disputeRate, highRiskPct,
    brokenPromises, neverContacted,
    concentrationRows, repPortfolio,
    openCount,
  } = metrics;

  const overdueCount = filteredInvoices.filter((i: any) =>
    i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off" &&
    i.txnType !== "CreditMemo" &&
    daysOverdue(i.dueDate) > 0
  ).length;

  const agingScore = totalAR > 0
    ? Math.round((current * 100 + b1_30 * 70 + b31_60 * 40 + b61_90 * 20 + b90plus * 5) / totalAR)
    : 100;

  const riskScore = Math.round(Math.max(10,
    100 - Math.min(disputeRate * 3, 50) - Math.min(highRiskPct * 1, 40)
  ));

  const brokenPromiseRate  = openCount    > 0 ? (brokenPromises / openCount)    * 100 : 0;
  const neverContactedRate = overdueCount > 0 ? (neverContacted / overdueCount) * 100 : 0;
  const collectionScore = Math.round(Math.max(10,
    100
    - Math.min(neverContactedRate * 0.5, 45)
    - Math.min(brokenPromiseRate  * 1.5, 35)
    - Math.min(over90Pct          * 0.4, 20)
  ));

  const scores = { aging: agingScore, risk: riskScore, collection: collectionScore };
  const overallScore = Math.round((scores.aging + scores.risk + scores.collection) / 3);
  const maxBucket = Math.max(current, b1_30, b31_60, b61_90, b90plus, 1);

  return (
    <div className="space-y-4">
      {/* Score banner */}
      <div className="bg-gradient-to-r from-stone-900 to-stone-800 rounded-xl p-5 text-white">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-stone-400 mb-1">AR Health Score</div>
            <div className="text-5xl font-bold tabular-nums">{overallScore}<span className="text-2xl text-stone-400">/100</span></div>
            <div className="text-sm text-stone-400 mt-2">
              {overallScore >= 80 ? "Excellent — AR management is best-in-class" :
               overallScore >= 60 ? "Good — room for improvement in a few areas" :
               overallScore >= 40 ? "Fair — significant collection issues present" :
               "Needs attention — multiple AR health risks identified"}
            </div>
          </div>
          <div className="flex gap-5">
            {([
              { label: "Aging",      score: scores.aging,      tip: "Weighted by bucket age" },
              { label: "Risk",       score: scores.risk,       tip: "Disputed AR + high-risk customers" },
              { label: "Collection", score: scores.collection, tip: "Broken commitments + uncontacted overdue" },
            ] as { label: string; score: number; tip: string }[]).map(({ label, score, tip }) => (
              <div key={label} className="text-center group relative">
                <div className="relative w-16 h-16 mx-auto mb-1">
                  <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--ring-track)" strokeWidth="3" />
                    <circle cx="18" cy="18" r="15.9" fill="none" strokeWidth="3"
                      stroke={score >= 70 ? "#34d399" : score >= 40 ? "#fbbf24" : "#f87171"}
                      strokeDasharray={`${score} 100`} strokeLinecap="round" />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center text-sm font-bold">{score}</div>
                </div>
                <div className="text-[11px] text-stone-400">{label}</div>
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 bg-stone-700 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap">{tip}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Aging overview + distribution + indicators */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-4">AR Overdue Overview</div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-stone-800/40 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-white tabular-nums">
                <CurrencyPills breakdown={byCcy} />
              </div>
              <div className="text-[10px] text-stone-500 mt-0.5">Total Open AR</div>
            </div>
            <div className={`rounded-lg p-3 text-center ${overdueRate > 50 ? "bg-rose-500/10" : overdueRate > 25 ? "bg-amber-500/10" : "bg-emerald-500/10"}`}>
              <div className={`text-xl font-bold tabular-nums ${overdueRate > 50 ? "text-rose-400" : overdueRate > 25 ? "text-amber-400" : "text-emerald-400"}`}>
                {overdueRate.toFixed(0)}%
              </div>
              <div className="text-[10px] text-stone-500 mt-0.5">Overdue Rate</div>
            </div>
          </div>
          <div className="space-y-2">
            {[
              { label: "Current (not due)", value: current, pct: currentPct, color: "bg-emerald-500" },
              { label: "Overdue 1–30d",     value: b1_30,   pct: totalAR > 0 ? (b1_30  / totalAR) * 100 : 0, color: "bg-amber-400" },
              { label: "Overdue 31–90d",    value: b31_60 + b61_90, pct: totalAR > 0 ? ((b31_60 + b61_90) / totalAR) * 100 : 0, color: "bg-orange-500" },
              { label: "Overdue 90+ days",  value: b90plus, pct: over90Pct, color: "bg-rose-600" },
            ].map(({ label, value, pct, color }) => (
              <div key={label} className="flex items-center gap-2 text-[11px]">
                <div className={`w-2 h-2 rounded-full shrink-0 ${color}`} />
                <div className="flex-1 text-stone-400">{label}</div>
                <div className="font-semibold text-stone-200 tabular-nums">{fmt.money(value, dominantCurrency)}</div>
                <div className="w-9 text-right text-stone-500">{pct.toFixed(0)}%</div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-3">Aging Distribution</div>
          <div className="space-y-2.5">
            {[
              { label: "Current",  value: current, color: "bg-emerald-500", pct: totalAR > 0 ? (current / totalAR) * 100 : 0 },
              { label: "1-30d",    value: b1_30,   color: "bg-amber-400",   pct: totalAR > 0 ? (b1_30  / totalAR) * 100 : 0 },
              { label: "31-60d",   value: b31_60,  color: "bg-orange-500",  pct: totalAR > 0 ? (b31_60 / totalAR) * 100 : 0 },
              { label: "61-90d",   value: b61_90,  color: "bg-rose-500",    pct: totalAR > 0 ? (b61_90 / totalAR) * 100 : 0 },
              { label: "90+ days", value: b90plus, color: "bg-rose-800",    pct: totalAR > 0 ? (b90plus / totalAR) * 100 : 0 },
            ].map(({ label, value, color, pct }) => (
              <div key={label} className="flex items-center gap-2">
                <div className="w-14 text-[11px] text-stone-400 font-medium">{label}</div>
                <div className="flex-1 h-5 bg-stone-800 rounded overflow-hidden">
                  <div className={`h-full ${color}`} style={{ width: `${(value / maxBucket) * 100}%` }} />
                </div>
                <div className="w-10 text-right text-[11px] font-semibold text-stone-300 tabular-nums">{pct.toFixed(0)}%</div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-3">Health Indicators</div>
          <div className="space-y-3">
            {[
              { label: "Current AR",             value: `${currentPct.toFixed(1)}%`,   sub: "% not yet due",                 good: currentPct > 60,        warn: currentPct < 40 },
              { label: "90+ days overdue",        value: `${over90Pct.toFixed(1)}%`,    sub: "% in oldest bucket",            good: over90Pct < 5,          warn: over90Pct > 15 },
              { label: "Dispute rate",            value: `${disputeRate.toFixed(1)}%`,  sub: "AR value in Disputed stage",    good: disputeRate < 2,         warn: disputeRate > 5 },
              { label: "High-risk customer AR",   value: `${highRiskPct.toFixed(1)}%`,  sub: "Held by High risk customers",   good: highRiskPct < 10,        warn: highRiskPct > 25 },
              { label: "No contact (overdue)",    value: String(neverContacted),        sub: "Overdue with zero follow-up",   good: neverContacted === 0,    warn: neverContacted > 5 },
              { label: "Broken commitments",       value: String(brokenPromises),        sub: "Commitment date passed, still open", good: brokenPromises === 0,  warn: brokenPromises > 2 },
            ].map(({ label, value, sub, good, warn }) => (
              <div key={label} className="flex items-center justify-between">
                <div>
                  <div className="text-[12px] font-medium text-stone-300">{label}</div>
                  <div className="text-[10px] text-stone-500">{sub}</div>
                </div>
                <div className={`text-sm font-bold tabular-nums px-2 py-0.5 rounded ${good ? "text-emerald-400 bg-emerald-500/15" : warn ? "text-rose-400 bg-rose-500/15" : "text-amber-400 bg-amber-500/15"}`}>
                  {value}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Largest debtors + Rep breakdown */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold">Largest Open Balances</div>
            <div className="flex items-center gap-2.5 text-[10px] text-stone-500">
              {[["bg-emerald-500","Current"],["bg-amber-400","1-30d"],["bg-orange-500","31-60d"],["bg-rose-500","61-90d"],["bg-rose-800","90+d"]].map(([color, label]) => (
                <span key={label} className="flex items-center gap-1">
                  <span className={`inline-block w-2 h-2 rounded-sm ${color}`} />
                  {label}
                </span>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            {concentrationRows.length === 0 ? (
              <div className="py-6 text-center text-sm text-stone-500">No open AR</div>
            ) : (showAllBalances ? concentrationRows : concentrationRows.slice(0, 10)).map(({ customer, amount, pct, currency, aging }: any, idx: number) => {
              const total = amount || 1;
              const segments = [
                { value: aging.current, color: "bg-emerald-500" },
                { value: aging.b1_30,   color: "bg-amber-400"   },
                { value: aging.b31_60,  color: "bg-orange-500"  },
                { value: aging.b61_90,  color: "bg-rose-500"    },
                { value: aging.b90plus, color: "bg-rose-800"    },
              ];
              return (
                <div key={customer.id} className="flex items-center gap-2">
                  <span className="w-5 text-[11px] text-stone-400 font-mono text-right shrink-0">{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[12px] font-medium text-stone-300 truncate">{customer.name}</span>
                      <div className="flex items-center gap-2 ml-2 shrink-0">
                        <span className="text-[11px] tabular-nums text-stone-200 font-semibold">{fmt.money(amount, currency)}</span>
                        <span className="text-[11px] text-stone-500 w-9 text-right">{pct.toFixed(0)}%</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-stone-800 rounded-full overflow-hidden flex">
                      {segments.map((seg, i) => seg.value > 0 && (
                        <div key={i} className={`h-full ${seg.color}`} style={{ width: `${(seg.value / total) * 100}%` }} />
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {concentrationRows.length > 10 && (
            <button
              onClick={() => setShowAllBalances(v => !v)}
              className="mt-3 w-full flex items-center justify-center gap-1 text-[11px] text-stone-500 hover:text-stone-300 transition-colors py-1"
            >
              <ChevronDown size={12} className={`transition-transform ${showAllBalances ? "rotate-180" : ""}`} />
              {showAllBalances ? "Show less" : `Show all ${concentrationRows.length} customers`}
            </button>
          )}
        </Card>

        {repPortfolio.length > 0 ? (
          <Card>
            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-4">AR by Rep</div>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-stone-800">
                  <th className="text-left py-1.5 font-semibold text-stone-500 pr-3">Rep</th>
                  <th className="text-right py-1.5 font-semibold text-stone-500 pr-3">Open AR</th>
                  <th className="text-right py-1.5 font-semibold text-stone-500 pr-3">Overdue</th>
                  <th className="text-right py-1.5 font-semibold text-stone-500">% Overdue</th>
                </tr>
              </thead>
              <tbody>
                {repPortfolio.map(({ rep, openAR, overdueAR, currency }: any) => {
                  const overdPct = openAR > 0 ? (overdueAR / openAR) * 100 : 0;
                  return (
                    <tr key={rep.id} className="border-b border-stone-800 last:border-0">
                      <td className="py-2 font-medium text-stone-200 pr-3">{rep.name}</td>
                      <td className="py-2 text-right tabular-nums text-stone-300 pr-3">{fmt.money(openAR, currency)}</td>
                      <td className={`py-2 text-right tabular-nums pr-3 font-semibold ${overdueAR > 0 ? "text-rose-400" : "text-emerald-400"}`}>{fmt.money(overdueAR, currency)}</td>
                      <td className={`py-2 text-right tabular-nums font-medium ${overdPct > 50 ? "text-rose-400" : overdPct > 25 ? "text-amber-400" : "text-stone-500"}`}>
                        {overdPct.toFixed(0)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        ) : (
          <Card>
            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">AR by Rep</div>
            <div className="py-6 text-center text-sm text-stone-400">No reps assigned</div>
          </Card>
        )}
      </div>
    </div>
  );
}

// ── Receivable Composition ──────────────────────────────────────────────────
// Answers management's first question: "what IS the 2.6M, actually?"
// Every open invoice is classified into exactly ONE category (priority order:
// escalation type → dispute → commitment → overdue → current), so the segments
// always sum to 100% of Total Receivable. Click any segment or legend row to
// see the exact invoices behind it.
// Classification itself lives in lib/receivable-composition.ts — shared with
// the Collections Board, which uses the same buckets to drive its filters.
function ReceivableComposition({ invoices, dominantCcy, onDrill }: {
  invoices: any[];
  dominantCcy: string;
  onDrill: (d: { title: string; subtitle: string; color: "rose" | "amber" | "sky" | "stone" | "white"; items: any[] }) => void;
}) {
  const comp = useMemo(() => {
    const open = invoices.filter((i: any) =>
      i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off" &&
      i.txnType !== "CreditMemo" && openBal(i) > 0
    );
    const items = open.map((inv: any) => ({
      escalationType:   inv.escalationType ?? null,
      collectionStage:  inv.collectionStage ?? null,
      hasOpenDispute:   inv.hasOpenDispute,
      promiseDate:      inv.promiseDate,
      overdueDays:      daysOverdue(inv.dueDate),
      amount:           openBal(inv),
      ref:              inv, // original invoice — used by drill-down
    }));
    const result = classifyComposition(items);
    // Unwrap `ref` back to the plain invoice objects the drill-down modal expects.
    const unwrap = (g: typeof result.groups[number]) => ({ ...g, items: g.items.map(it => it.ref) });
    return {
      ...result, open,
      groups:        result.groups.map(unwrap),
      blockedParts:  result.blockedParts.map(unwrap),
      workableParts: result.workableParts.map(unwrap),
    };
  }, [invoices]);

  if (comp.total <= 0) return null;

  const pct = (v: number) => (v / comp.total) * 100;

  return (
    <Card padding="md" className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold">Receivable Composition</div>
        <div className="text-[11px] text-stone-500">
          What the {fmt.money(comp.total, dominantCcy)} is made of — click a segment for the invoices
        </div>
      </div>

      {/* Management insight — each headline number shows its own derivation */}
      <div className="grid md:grid-cols-3 gap-3 mb-4 mt-2">
        {/* Workable */}
        <div className="rounded-lg bg-stone-800/40 ring-1 ring-stone-800 px-3 py-2.5">
          <div className="text-[13px]">
            <span className="font-semibold text-white">{fmt.money(comp.workable, dominantCcy)}</span>
            <span className="text-stone-500"> ({pct(comp.workable).toFixed(0)}%)</span>
          </div>
          <div className="text-[11px] text-stone-500 mb-1.5">collectable through normal chasing</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {comp.workableParts.map(g => (
              <button key={g.key} onClick={() => onDrill({ title: g.label, subtitle: g.description, color: g.drillColor, items: g.items })}
                className="flex items-center gap-1.5 text-[11px] text-stone-400 hover:text-white transition-colors">
                <span className={`w-1.5 h-1.5 rounded-full ${g.dot}`} />
                {g.label} <span className="font-semibold text-stone-300 tabular-nums">{fmt.money(g.amount, dominantCcy)}</span>
              </button>
            ))}
          </div>
        </div>
        {/* Blocked */}
        <div className="rounded-lg bg-amber-500/5 ring-1 ring-amber-500/20 px-3 py-2.5">
          <div className="text-[13px]">
            <span className="font-semibold text-amber-400">{fmt.money(comp.blocked, dominantCcy)}</span>
            <span className="text-stone-500"> ({pct(comp.blocked).toFixed(0)}%)</span>
          </div>
          <div className="text-[11px] text-stone-500 mb-1.5">needs a decision or agreement first</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {comp.blockedParts.map(g => (
              <button key={g.key} onClick={() => onDrill({ title: g.label, subtitle: g.description, color: g.drillColor, items: g.items })}
                className="flex items-center gap-1.5 text-[11px] text-stone-400 hover:text-white transition-colors">
                <span className={`w-1.5 h-1.5 rounded-full ${g.dot}`} />
                {g.label} <span className="font-semibold text-stone-300 tabular-nums">{fmt.money(g.amount, dominantCcy)}</span>
              </button>
            ))}
          </div>
        </div>
        {/* Not yet due */}
        <div className="rounded-lg bg-emerald-500/5 ring-1 ring-emerald-500/20 px-3 py-2.5">
          <div className="text-[13px]">
            <span className="font-semibold text-emerald-400">{fmt.money(comp.currentAmount, dominantCcy)}</span>
            <span className="text-stone-500"> ({pct(comp.currentAmount).toFixed(0)}%)</span>
          </div>
          <div className="text-[11px] text-stone-500">not yet due — within payment terms</div>
          <div className="text-[10px] text-stone-600 mt-1.5">The three panels always sum to 100% of total receivable.</div>
        </div>
      </div>

      {/* Stacked bar */}
      <div className="h-8 rounded-lg overflow-hidden flex ring-1 ring-stone-800 mb-4">
        {comp.groups.map((g, i) => (
          <button
            key={g.key}
            className={`h-full ${g.bar} hover:opacity-80 transition-opacity relative group`}
            style={{
              width: `${Math.max(pct(g.amount), 0.75)}%`,
              borderLeft: i > 0 ? "2px solid var(--seg-gap)" : undefined,
            }}
            title={`${g.label} — ${fmt.money(g.amount, dominantCcy)} (${pct(g.amount).toFixed(1)}%) · ${g.count} invoice${g.count !== 1 ? "s" : ""}\n${g.description}`}
            onClick={() => onDrill({
              title: g.label,
              subtitle: g.description,
              color: g.drillColor,
              items: g.items,
            })}
          />
        ))}
      </div>

      {/* Legend — amount, % and count per category */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2">
        {comp.groups.map(g => (
          <button
            key={g.key}
            onClick={() => onDrill({ title: g.label, subtitle: g.description, color: g.drillColor, items: g.items })}
            title={g.description}
            className="flex items-center gap-2 text-left group rounded px-1.5 py-1 -mx-1.5 hover:bg-stone-800/60 transition-colors"
          >
            <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${g.dot}`} />
            <span className="text-[12px] text-stone-300 flex-1 min-w-0 truncate group-hover:text-white">{g.label}</span>
            <span className="text-[12px] font-semibold text-stone-200 tabular-nums shrink-0">{fmt.money(g.amount, dominantCcy)}</span>
            <span className="text-[11px] text-stone-500 tabular-nums w-10 text-right shrink-0">{pct(g.amount).toFixed(1)}%</span>
            <span className="text-[10px] text-stone-600 tabular-nums w-8 text-right shrink-0">{g.count}×</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

// ── Drill-down side panel — Customer → Project, expandable ─────────────────
// A flat list stops being readable past a handful of rows (Total Receivable
// alone can span 70+ customers). Grouping mirrors the Board's Customer →
// Project bands: collapsed by default so opening a big bucket doesn't just
// swap one wall of text for another; expand only what you want to inspect.
function DrillDownPanel({ drillDown, onClose, customers, projects, dominantCcy }: {
  drillDown: { title: string; subtitle: string; color: "rose" | "amber" | "sky" | "stone" | "white"; items: any[] };
  onClose: () => void;
  customers: any[];
  projects: any[];
  dominantCcy: string;
}) {
  const [collapsedCust, setCollapsedCust] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    type ProjGroup = { key: string; name: string; total: number; ccy: string; items: any[] };
    type CustGroup = { key: string; name: string; total: number; ccy: string; projects: Map<string, ProjGroup> };
    const custMap = new Map<string, CustGroup>();

    for (const inv of drillDown.items) {
      const customer = customers.find((c: any) => c.id === inv.customerId);
      const project  = projects.find((p: any) => p.id === inv.projectId);
      const bal = openBal(inv);
      const ccy = inv.currency || dominantCcy;

      const cKey = customer?.id ?? "__unknown__";
      if (!custMap.has(cKey)) custMap.set(cKey, { key: cKey, name: customer?.name ?? "Unknown customer", total: 0, ccy, projects: new Map() });
      const cg = custMap.get(cKey)!;
      cg.total += bal;

      const pKey = project?.id ?? "__none__";
      if (!cg.projects.has(pKey)) cg.projects.set(pKey, { key: pKey, name: project?.name ?? "No project", total: 0, ccy, items: [] });
      const pg = cg.projects.get(pKey)!;
      pg.total += bal;
      pg.items.push(inv);
    }

    return [...custMap.values()]
      .sort((a, b) => b.total - a.total)
      .map(cg => ({ ...cg, projects: [...cg.projects.values()].sort((a, b) => b.total - a.total) }));
  }, [drillDown.items, customers, projects, dominantCcy]);

  // Bucket total across all customers — used to show each customer's % share.
  // Sums raw amounts across currencies (same simplification the rest of the
  // dashboard already uses, e.g. AR Health's combined AR total) rather than
  // doing FX conversion, which is fine for the single/dominant-currency case
  // this app is built around.
  const bucketTotal = useMemo(() => groups.reduce((s, g) => s + g.total, 0), [groups]);

  // Collapsed by default — opening a 74-customer bucket should land on 74
  // one-line bands, not 74 expanded groups. Re-collapse whenever a NEW
  // bucket is opened (title changes) so nothing carries over from the last
  // one; `groups` is already recomputed for the new bucket by the time this
  // effect runs (useMemo executes during render, before effects).
  useEffect(() => { setCollapsedCust(new Set(groups.map(g => g.key))); }, [drillDown.title]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCust = (key: string) => setCollapsedCust(p => {
    const n = new Set(p);
    n.has(key) ? n.delete(key) : n.add(key);
    return n;
  });
  const allExpanded = collapsedCust.size === 0;
  const toggleAll = () => setCollapsedCust(allExpanded ? new Set(groups.map(g => g.key)) : new Set());

  const colorClass =
    drillDown.color === "rose"  ? "text-rose-400"  :
    drillDown.color === "amber" ? "text-amber-400" :
    drillDown.color === "sky"   ? "text-sky-400"   : "text-white";
  // Written as literal strings (not derived via .replace on colorClass) —
  // Tailwind's content scanner only picks up class names that appear
  // verbatim in source; a runtime-constructed "bg-" + hue string would be
  // invisible to it, same failure mode fixed earlier for the composition bar.
  const barBgClass =
    drillDown.color === "rose"  ? "bg-rose-400"  :
    drillDown.color === "amber" ? "bg-amber-400" :
    drillDown.color === "sky"   ? "bg-sky-400"   : "bg-stone-300";

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div className="flex-1 bg-black/60" onClick={onClose} />
      {/* Panel */}
      <div className="w-[560px] bg-stone-950 border-l border-stone-800 flex flex-col h-full shadow-2xl">
        {/* Header */}
        <div className={`px-5 py-4 border-b border-stone-800 ${
          drillDown.color === "rose"  ? "bg-rose-500/5"  :
          drillDown.color === "amber" ? "bg-amber-500/5" :
          drillDown.color === "sky"   ? "bg-sky-500/5"   : ""
        }`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-white">{drillDown.title}</h2>
              <p className="text-[11px] text-stone-400 mt-0.5">{drillDown.subtitle}</p>
            </div>
            <button onClick={onClose} className="text-stone-500 hover:text-white mt-0.5 flex-shrink-0" aria-label="Close">
              <X size={16} />
            </button>
          </div>
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            {(() => {
              const byCcy: Record<string, number> = {};
              drillDown.items.forEach(i => { const c = i.currency || dominantCcy; byCcy[c] = (byCcy[c] || 0) + openBal(i); });
              return <CurrencyPills breakdown={byCcy} className={`text-lg font-semibold tabular-nums ${colorClass}`} />;
            })()}
            <span className="text-[11px] text-stone-500">
              across {drillDown.items.length} invoice{drillDown.items.length !== 1 ? "s" : ""} · {groups.length} customer{groups.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {/* Collapse/expand all */}
        {groups.length > 1 && (
          <div className="px-4 pt-3 pb-1 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-stone-600 font-semibold">By customer · largest first</span>
            <button onClick={toggleAll} className="flex items-center gap-1 text-[11px] text-stone-500 hover:text-stone-300 transition-colors">
              {allExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {allExpanded ? "Collapse all" : "Expand all"}
            </button>
          </div>
        )}

        {/* Grouped invoice list */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 pt-1 space-y-1.5">
          {groups.length === 0 ? (
            <div className="py-12 text-center text-sm text-stone-500">No invoices in this bucket</div>
          ) : (
            groups.map(cg => {
              const collapsed = collapsedCust.has(cg.key);
              const pct = bucketTotal > 0 ? (cg.total / bucketTotal) * 100 : 0;
              return (
                <div key={cg.key} className="rounded-lg border border-stone-800 overflow-hidden">
                  {/* Customer band */}
                  <button
                    onClick={() => toggleCust(cg.key)}
                    className="w-full flex flex-col gap-1 px-3 py-2 bg-stone-900 hover:bg-stone-800/80 transition-colors text-left"
                  >
                    <div className="w-full flex items-center gap-2">
                      <ChevronRight size={12} className={`text-stone-500 shrink-0 transition-transform ${collapsed ? "" : "rotate-90"}`} />
                      <span className="text-[13px] font-medium text-white flex-1 truncate">{cg.name}</span>
                      <span className="text-[10px] text-stone-500 shrink-0">
                        {cg.projects.reduce((s, p) => s + p.items.length, 0)} inv
                      </span>
                      <span className="text-[11px] text-stone-500 tabular-nums w-9 text-right shrink-0">{pct.toFixed(0)}%</span>
                      <span className="text-[13px] font-semibold text-stone-200 tabular-nums shrink-0">{fmt.money(cg.total, cg.ccy)}</span>
                    </div>
                    {/* Share of the bucket — same pattern as "Largest Open Balances" */}
                    <div className="h-1 bg-stone-800 rounded-full overflow-hidden ml-5">
                      <div className={`h-full ${barBgClass}`} style={{ width: `${Math.max(pct, 1)}%` }} />
                    </div>
                  </button>

                  {/* Projects + invoices */}
                  {!collapsed && cg.projects.map(pg => (
                    <div key={pg.key}>
                      {(pg.name !== "No project" || cg.projects.length > 1) && (
                        <div className="flex items-center gap-2 px-3 py-1.5 pl-7 bg-stone-900/40 border-t border-stone-800/60">
                          <span className="text-[11px] text-stone-400 flex-1 truncate">{pg.name}</span>
                          <span className="text-[11px] text-stone-500 tabular-nums">{fmt.money(pg.total, pg.ccy)}</span>
                        </div>
                      )}
                      {pg.items
                        .slice()
                        .sort((a, b) => openBal(b) - openBal(a))
                        .map(inv => {
                          const daysToPromise = inv.promiseDate ? -daysOverdue(inv.promiseDate) : null;
                          const isOverduePromise = daysToPromise !== null && daysToPromise < 0;
                          return (
                            <Link
                              key={inv.id}
                              href={`/invoices/${inv.id}`}
                              onClick={onClose}
                              className="flex items-start gap-3 px-3 py-2 pl-7 border-t border-stone-800/60 hover:bg-stone-800/50 group"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[11px] text-stone-400 font-mono">{inv.invoiceNumber}</span>
                                  {inv.promiseDate && (
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                                      isOverduePromise
                                        ? "bg-rose-500/15 text-rose-400"
                                        : daysToPromise === 0
                                        ? "bg-amber-500/15 text-amber-300"
                                        : "bg-emerald-500/10 text-emerald-400"
                                    }`}>
                                      {isOverduePromise
                                        ? `${Math.abs(daysToPromise!)}d overdue`
                                        : daysToPromise === 0
                                        ? "Due today"
                                        : `in ${daysToPromise}d`}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 mt-1 text-[10px] text-stone-600">
                                  {inv.promiseDate && <span>Committed {fmt.shortDate(inv.promiseDate)}</span>}
                                  <span>Invoice due {fmt.shortDate(inv.dueDate)}</span>
                                </div>
                              </div>
                              <div className="text-right flex-shrink-0">
                                <div className="text-[12px] font-semibold text-white tabular-nums">
                                  {fmt.money(openBal(inv), inv.currency ?? dominantCcy)}
                                </div>
                                <ChevronRight size={11} className="text-stone-700 group-hover:text-stone-400 mt-1 ml-auto" />
                              </div>
                            </Link>
                          );
                        })}
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-stone-800 flex items-center justify-between">
          <span className="text-[11px] text-stone-500">Sorted by open balance (largest first)</span>
          <button onClick={onClose} className="text-[11px] text-stone-500 hover:text-stone-300">Close</button>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { invoices, customers, contacts, projects, regions, communications, tasks, reps, orgSettings, refresh } = useData() as any;
  const { data: session } = useSession();
  const userId = (session?.user as any)?.id;

  // ── AR Snapshot — same source used by all Reports pages ─────────────────
  // Ensures every financial figure on the dashboard reconciles with AR Reports.
  const [snapshotInvoices, setSnapshotInvoices] = useState<any[] | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);

  // ── Drill-down panel — shows the exact invoices behind a Promised bucket ──
  const [drillDown, setDrillDown] = useState<{
    title: string;
    subtitle: string;
    color: "rose" | "amber" | "sky" | "stone" | "white";
    items: any[];
  } | null>(null);

  const fetchSnapshot = () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    setSnapshotLoading(true);
    fetch(`/api/reports/ar-snapshot?asOf=${todayStr}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        setSnapshotInvoices(Array.isArray(data) ? data : null);
        // Also refresh local invoice data so collectionStage / promiseDate stay in sync
        refresh();
      })
      .catch(() => setSnapshotInvoices(null))
      .finally(() => setSnapshotLoading(false));
  };

  useEffect(() => {
    fetchSnapshot();
    // Auto-refresh every 5 minutes so payments that come in while the page
    // is open are reflected without requiring a manual page reload.
    const interval = setInterval(fetchSnapshot, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Merge snapshot (authoritative open balances) with local invoice metadata
  // (collectionStage, promiseDate, lastFollowupDate, paymentStatus) so that
  // both financial totals AND collection-stage metrics are accurate.
  const effectiveInvoices = useMemo(() => {
    if (!snapshotInvoices) return invoices;
    const localMap = new Map((invoices as any[]).map((i: any) => [i.id, i]));
    return snapshotInvoices.map((snap: any) => {
      const local = localMap.get(snap.id);
      if (local) {
        return {
          ...snap,
          // Enrich with local metadata for collection-stage tracking.
          // Do NOT override paymentStatus — the snapshot is the authority
          // on which invoices are still open (avoids stale-local-DB mismatches).
          collectionStage:  local.collectionStage,
          promiseDate:      local.promiseDate,
          lastFollowupDate: local.lastFollowupDate,
          currency:         local.currency ?? snap.currency,
          // Escalation + dispute context — powers the Receivable Composition breakdown
          escalationType:   local.escalationType ?? null,
          escalatedToName:  local.escalatedToName ?? null,
          escalatedAt:      local.escalatedAt ?? null,
          hasOpenDispute:   local.hasOpenDispute ?? false,
          disputeReason:    local.disputeReason ?? null,
        };
      }
      return snap;
    });
  }, [snapshotInvoices, invoices]);

  // Setup checklist state
  const [emailConfigured, setEmailConfigured] = useState<boolean | null>(null);
  const [hasTemplates, setHasTemplates] = useState<boolean | null>(null);

  useEffect(() => {
    // Check all email methods — any one connected counts as configured
    Promise.all([
      fetch("/api/gmail?status=1").then(r => r.json()).catch(() => ({ connected: false })),
      fetch("/api/microsoft?status=1").then(r => r.json()).catch(() => ({ connected: false })),
      fetch("/api/email/status").then(r => r.json()).catch(() => ({ configured: false })),
    ]).then(([gmail, ms, smtp]) => {
      setEmailConfigured(!!(gmail.connected || ms.connected || smtp.configured));
    });
    fetch("/api/email-templates")
      .then(r => r.json())
      .then(d => setHasTemplates(Array.isArray(d) ? d.length > 0 : false))
      .catch(() => setHasTemplates(false));
  }, []);

  const setupLoading = emailConfigured === null || hasTemplates === null;

  const setupSteps = useMemo(() => {
    const integrationsConnected = invoices.length > 0;
    const hasAutoContacts = (contacts ?? []).filter((c: any) => c.receivesAuto).length > 0;
    return [
      { label: "Connect QuickBooks or Xero", done: integrationsConnected, href: "/settings/integrations" },
      { label: "Configure SMTP or connect Gmail / M365", done: !!emailConfigured, href: "/settings/email" },
      { label: "Create an email template", done: !!hasTemplates, href: "/automations" },
      { label: "Enable reminder programme", done: hasAutoContacts, href: "/automations" },
    ];
  }, [invoices, contacts, emailConfigured, hasTemplates]);

  const setupComplete = setupSteps.every(s => s.done);
  const setupDoneCount = setupSteps.filter(s => s.done).length;

  // Priority alerts
  const alerts = useMemo(() => {
    const list: Array<{ type: string; label: string; sub: string; color: string; href: string; icon: string }> = [];

    const brokenPromises = effectiveInvoices.filter((i: any) =>
      i.promiseDate && !i.hasOpenDispute &&
      new Date(i.promiseDate) < new Date() &&
      i.paymentStatus !== "Paid"
    );
    if (brokenPromises.length > 0) {
      list.push({
        type: "broken_promise",
        label: `${brokenPromises.length} broken commitment${brokenPromises.length > 1 ? "s" : ""}`,
        sub: "Commitment dates passed — follow up now",
        color: "rose",
        href: "/smart-views",
        icon: "AlertTriangle",
      });
    }

    const neglected90 = effectiveInvoices.filter((i: any) => {
      if (i.paymentStatus === "Paid" || i.paymentStatus === "Written Off") return false;
      if (i.txnType === "CreditMemo") return false;
      const days = Math.floor((Date.now() - new Date(i.dueDate + "T12:00:00Z").getTime()) / 86400000);
      return days > 90;
    });
    if (neglected90.length > 0) {
      const breakdown: Record<string, number> = {};
      neglected90.forEach((i: any) => { const c = i.currency || "EUR"; breakdown[c] = (breakdown[c] || 0) + openBal(i); });
      const parts = Object.entries(breakdown).sort((a, b) => b[1] - a[1]).map(([c, v]) => fmt.money(v, c)).join(" · ");
      list.push({
        type: "overdue_90",
        label: `90+ day debt: ${parts}`,
        sub: `${neglected90.length} invoice${neglected90.length > 1 ? "s" : ""} — escalate or write off`,
        color: "rose",
        href: "/smart-views",
        icon: "AlertTriangle",
      });
    }

    const noEmail = (contacts ?? []).filter((c: any) => c.receivesAuto && !c.email);
    if (noEmail.length > 0) {
      list.push({
        type: "no_email",
        label: `${noEmail.length} contact${noEmail.length > 1 ? "s" : ""} missing email`,
        sub: "Programme is ON but no email — reminders won't send",
        color: "amber",
        href: "/automations",
        icon: "Mail",
      });
    }

    return list;
  }, [effectiveInvoices, contacts]);

  const stats = useMemo(() => {
    const regionInvoices = effectiveInvoices;
    // Open invoices (exclude CMs for counting/stage/overdue logic)
    const open = regionInvoices.filter((i: any) => i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off" && i.txnType !== "CreditMemo");
    // Unapplied credits / credit memos — openBal() returns negative for these
    const activeCMs = regionInvoices.filter((i: any) => i.txnType === "CreditMemo" && openBal(i) < 0);

    // Per-currency breakdowns for KPI cards
    const totalByCurrency: Record<string, number> = {};
    const overdueByCurrency: Record<string, number> = {};
    open.forEach((i: any) => { const c = i.currency || "EUR"; totalByCurrency[c] = (totalByCurrency[c] || 0) + openBal(i); });
    activeCMs.forEach((i: any) => { const c = i.currency || "EUR"; totalByCurrency[c] = (totalByCurrency[c] || 0) + openBal(i); });

    // Net AR = gross invoices minus unapplied credits
    const grossReceivable = open.reduce((s: number, i: any) => s + openBal(i), 0);
    const creditBalance   = activeCMs.reduce((s: number, i: any) => s + openBal(i), 0); // ≤ 0
    const totalReceivable = grossReceivable + creditBalance;
    const overdue = open.filter((i: any) => daysOverdue(i.dueDate) > 0);
    overdue.forEach((i: any) => { const c = i.currency || "EUR"; overdueByCurrency[c] = (overdueByCurrency[c] || 0) + openBal(i); });
    const totalOverdue = overdue.reduce((s: number, i: any) => s + openBal(i), 0);

    // Aging buckets — every row ages by its OWN date, matching QBO's
    // AgedReceivableDetail. Invoices contribute a positive balance; credit
    // memos contribute a negative balance in whichever bucket their date falls
    // (NOT all forced into Current — that drove the bucket deeply negative).
    // Summing both reconciles the buckets to QBO's grand total.
    const buckets: Record<string, number> = { "Current": 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
    open.forEach((i: any) => { buckets[getAgingBucket(i)] += openBal(i); });
    activeCMs.forEach((i: any) => { buckets[getAgingBucket(i)] += openBal(i); });
    // Drive "Committed to Pay" and "Disputed" off the real flags (promiseDate /
    // hasOpenDispute) — the same source of truth the Receivable Composition
    // uses — not the collectionStage string, which drifts between the key
    // ("Promised") and the label ("Committed") and left this card empty.
    const disputed = open.filter((i: any) => i.hasOpenDispute).reduce((s: number, i: any) => s + openBal(i), 0);
    const promisedAll = open.filter((i: any) => !!i.promiseDate && !i.hasOpenDispute);
    const promised = promisedAll.reduce((s: number, i: any) => s + openBal(i), 0);

    // Broken promises — promise date has already passed
    const promisedBrokenItems = promisedAll.filter((i: any) => i.promiseDate && daysOverdue(i.promiseDate) > 0);
    const promisedBroken = promisedBrokenItems.reduce((s: number, i: any) => s + openBal(i), 0);

    // Promises due within the next 7 days
    const promisedWeekItems = promisedAll.filter((i: any) => {
      if (!i.promiseDate) return false;
      const d = daysOverdue(i.promiseDate);
      return d <= 0 && d >= -7;
    });
    const promisedWeek = promisedWeekItems.reduce((s: number, i: any) => s + openBal(i), 0);

    // Promises due in 8–30 days
    const promisedMonthItems = promisedAll.filter((i: any) => {
      if (!i.promiseDate) return false;
      const d = daysOverdue(i.promiseDate);
      return d < -7 && d >= -30;
    });
    const promisedMonth = promisedMonthItems.reduce((s: number, i: any) => s + openBal(i), 0);

    const dueThisWeek = open.filter((i: any) => { const d = daysOverdue(i.dueDate); return d <= 0 && d >= -7; });
    const sevenDaysAgo = new Date(daysFromNow(-7)).getTime();
    const emailsSent = communications.filter((c: any) => c.direction === "Outbound" && c.channel === "Email" && new Date(c.sentAt).getTime() > sevenDaysAgo).length;
    const replies = communications.filter((c: any) => c.direction === "Inbound" && new Date(c.sentAt).getTime() > sevenDaysAgo).length;

    // 90+ days overdue
    const over90Items = open.filter((i: any) => daysOverdue(i.dueDate) > 90);
    const over90 = over90Items.reduce((s: number, i: any) => s + openBal(i), 0);
    const disputedItems = open.filter((i: any) => i.hasOpenDispute);
    const openItems = [...open, ...activeCMs];

    // Proactive pipeline: due in 7-14 days, no lastFollowupDate
    const proactivePipeline = open.filter((i: any) => {
      const d = daysOverdue(i.dueDate);
      return d < -6 && d >= -14 && !i.lastFollowupDate;
    });

    // Dominant currency for bucket display
    const dominantCcy = Object.keys(totalByCurrency)[0] ?? "EUR";

    return {
      totalReceivable, totalOverdue, totalByCurrency, overdueByCurrency, dominantCcy,
      buckets, disputed,
      promised, promisedBroken, promisedBrokenCount: promisedBrokenItems.length,
      promisedWeek, promisedWeekCount: promisedWeekItems.length,
      promisedMonth, promisedMonthCount: promisedMonthItems.length,
      promisedTotalCount: promisedAll.length,
      // Item arrays — used by drill-down panel to list exact invoices per bucket
      promisedBrokenItems,
      promisedWeekItems,
      promisedMonthItems,
      promisedAllItems: promisedAll,
      dueThisWeek, overdue, emailsSent, replies, openCount: open.length, over90, proactivePipeline,
      openItems, over90Items, disputedItems,
    };
  }, [effectiveInvoices, invoices, customers, projects, communications]);

  const topOverdue = useMemo(() => {
    const byCust: Record<string, number> = {};
    effectiveInvoices.filter((i: any) => i.paymentStatus !== "Paid" && i.txnType !== "CreditMemo" && daysOverdue(i.dueDate) > 0).forEach((i: any) => {
      byCust[i.customerId] = (byCust[i.customerId] || 0) + openBal(i);
    });
    return Object.entries(byCust).map(([cid, amt]) => ({
      customer: customers.find((c: any) => c.id === cid),
      amount: amt,
      currency: effectiveInvoices.find((i: any) => i.customerId === cid)?.currency ?? "EUR",
    }))
      .filter(x => x.customer).sort((a, b) => b.amount - a.amount).slice(0, 5);
  }, [effectiveInvoices, customers]);

  // Concentration risk — top 5 customers by total open AR
  const concentrationRisk = useMemo(() => {
    const byCust: Record<string, number> = {};
    const open = effectiveInvoices.filter((i: any) => i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off" && i.txnType !== "CreditMemo");
    const totalAR = open.reduce((s: number, i: any) => s + openBal(i), 0);
    open.forEach((i: any) => { byCust[i.customerId] = (byCust[i.customerId] || 0) + openBal(i); });
    const sorted = Object.entries(byCust).map(([cid, amt]) => ({
      customer: customers.find((c: any) => c.id === cid),
      amount: amt,
      pct: totalAR > 0 ? (amt / totalAR) * 100 : 0,
      currency: effectiveInvoices.find((i: any) => i.customerId === cid)?.currency ?? "EUR",
    })).filter(x => x.customer).sort((a, b) => b.amount - a.amount).slice(0, 5);
    const top5Pct = totalAR > 0 ? sorted.reduce((s, x) => s + x.pct, 0) : 0;
    return { rows: sorted, top5Pct, totalAR };
  }, [effectiveInvoices, customers]);

  // AR by Region — net open AR grouped per region (matches Reports → Aging by Region).
  // Invoices contribute positive balances; CreditMemos contribute negative credits
  // (unapplied credits reduce the region total). This ensures the per-region totals
  // reconcile with both the KPI cards and the Reports page.
  const arByRegion = useMemo(() => {
    const openInvoices = effectiveInvoices.filter((i: any) =>
      i.paymentStatus !== "Paid" &&
      i.paymentStatus !== "Written Off" &&
      i.txnType !== "CreditMemo"
    );
    // Unapplied credits (CMs with a negative open balance)
    const activeCMs = effectiveInvoices.filter((i: any) =>
      i.txnType === "CreditMemo" && openBal(i) < 0
    );

    const regionMap: Record<string, { name: string; total: number; overdue: number; count: number; byCurrency: Record<string, number> }> = {};

    const addRow = (i: any, bal_: number, countIt: boolean, overdue: boolean) => {
      const c = customers.find((c: any) => c.id === i.customerId);
      const p = projects.find((p: any) => p.id === i.projectId);
      const regionId = c?.regionId || p?.regionId;
      const region   = (regions ?? []).find((r: any) => r.id === regionId);
      const key  = regionId || "__unassigned__";
      const name = region?.name ?? "Unassigned";
      if (!regionMap[key]) regionMap[key] = { name, total: 0, overdue: 0, count: 0, byCurrency: {} };
      regionMap[key].total += bal_;
      const ccy = i.currency || "EUR";
      regionMap[key].byCurrency[ccy] = (regionMap[key].byCurrency[ccy] || 0) + bal_;
      if (countIt) regionMap[key].count += 1;
      if (overdue) regionMap[key].overdue += bal_;
    };

    openInvoices.forEach((i: any) => {
      addRow(i, openBal(i), true, daysOverdue(i.dueDate) > 0);
    });

    // CMs land in the region total as negative credits (they don't age)
    activeCMs.forEach((i: any) => addRow(i, openBal(i), false, false));

    return Object.entries(regionMap)
      .map(([id, data]) => ({ id, ...data }))
      .filter(r => r.total !== 0)
      .sort((a, b) => b.total - a.total);
  }, [effectiveInvoices, customers, projects, regions]);

  const myTasks = tasks.filter(t => !t.completed && t.assigneeId === userId).sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()).slice(0, 5);
  const maxBucket = Math.max(...Object.values(stats.buckets), 1);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Dashboard</h1>
          <p className="text-sm text-stone-400 mt-1">Overview of receivables, aging and collection activity</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-stone-500 flex items-center gap-1.5">
            {snapshotLoading && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
            Last updated {fmt.date(new Date())}
          </div>
          <Link
            href="/ar-report"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-white text-xs font-medium transition-colors border border-stone-700"
          >
            <Printer size={12} />
            Print Report
          </Link>
        </div>
      </div>

      {/* Setup Checklist — hidden once all steps complete */}
      {!setupComplete && (
        <div className="bg-gradient-to-r from-stone-900 to-stone-800 text-white rounded-xl p-5 mb-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="text-sm font-semibold">Getting started</div>
              <div className="text-[12px] text-stone-400 mt-0.5">Complete these steps to go live</div>
            </div>
            <div className="text-[11px] text-stone-400 shrink-0 ml-4">{setupDoneCount} of 4 steps complete</div>
          </div>
          {/* Progress bar */}
          <div className="h-1.5 bg-stone-700 rounded-full overflow-hidden mb-4">
            <div className="h-full bg-emerald-400 rounded-full transition-all duration-500" style={{ width: `${(setupDoneCount / 4) * 100}%` }} />
          </div>
          {setupLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="h-7 bg-stone-700 rounded-md animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {setupSteps.map((step, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  {step.done ? (
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center text-white text-[11px] font-bold">✓</span>
                  ) : (
                    <span className="flex-shrink-0 w-5 h-5 rounded-full border border-stone-600 bg-stone-800" />
                  )}
                  {step.done ? (
                    <span className="text-[12px] text-stone-400 line-through">{step.label}</span>
                  ) : (
                    <Link href={step.href} className="text-[12px] text-white hover:text-emerald-300 underline underline-offset-2">{step.label}</Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* KPI skeleton helper — shown while AR snapshot is loading */}
      {(() => {
        const S = ({ w = "w-28" }: { w?: string }) => (
          <div className={`h-7 ${w} bg-stone-800 animate-pulse rounded mt-1`} />
        );
        const Sub = () => <div className="h-3 w-20 bg-stone-800 animate-pulse rounded mt-2" />;

        return (
          <>
            <div className="grid grid-cols-4 gap-3 mb-3">
              <Card padding="md" className="cursor-pointer hover:ring-1 hover:ring-stone-600 transition-all"
                onClick={() => !snapshotLoading && setDrillDown({ title: "Total Receivable", subtitle: "All open invoices as at today", color: "white", items: stats.openItems })}>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold">Total Receivable</div>
                  <div className="text-[10px] text-stone-400">As at {new Date().toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" })}</div>
                </div>
                {snapshotLoading ? <><S /><Sub /></> : <>
                  <div className="text-3xl font-semibold text-white tracking-tight">
                    <CurrencyPills breakdown={stats.totalByCurrency} stacked />
                  </div>
                  <div className="mt-2 text-[11px] text-stone-500">{stats.openCount} open invoices</div>
                </>}
              </Card>
              <Card padding="md" className="cursor-pointer hover:ring-1 hover:ring-stone-600 transition-all"
                onClick={() => !snapshotLoading && stats.overdue.length > 0 && setDrillDown({ title: "Overdue Invoices", subtitle: "Past due date — action required", color: "rose", items: stats.overdue })}>
                <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Overdue</div>
                {snapshotLoading ? <><S /><Sub /></> : <>
                  <div className="text-3xl font-semibold text-rose-600 tracking-tight">
                    <CurrencyPills breakdown={stats.overdueByCurrency} />
                  </div>
                  <div className="mt-2 text-[11px] text-stone-500">{stats.overdue.length} overdue invoices</div>
                </>}
              </Card>
              <Card padding="md" className="cursor-pointer hover:ring-1 hover:ring-stone-600 transition-all"
                onClick={() => !snapshotLoading && stats.over90Items.length > 0 && setDrillDown({ title: "90+ Days Overdue", subtitle: "Escalation candidates — oldest outstanding invoices", color: "rose", items: stats.over90Items })}>
                <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">90+ Days</div>
                {snapshotLoading ? <><S /><Sub /></> : <>
                  <div className="text-3xl font-semibold text-rose-700 tracking-tight">{fmt.money(stats.over90, stats.dominantCcy)}</div>
                  <div className="mt-2 text-[11px] text-stone-500">Escalation candidates</div>
                </>}
              </Card>
              <Card padding="md" className="cursor-pointer hover:ring-1 hover:ring-stone-600 transition-all"
                onClick={() => !snapshotLoading && stats.disputedItems.length > 0 && setDrillDown({ title: "Disputed Invoices", subtitle: "In dispute — pending resolution", color: "amber", items: stats.disputedItems })}>
                <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Disputed</div>
                {snapshotLoading ? <><S /><Sub /></> : <>
                  <div className="text-3xl font-semibold text-white tracking-tight">{fmt.money(stats.disputed, stats.dominantCcy)}</div>
                  <div className="mt-2 text-[11px] text-stone-500">Pending resolution</div>
                </>}
              </Card>
            </div>
            {/* Receivable Composition — the management breakdown of Total Receivable */}
            {!snapshotLoading && (
              <ReceivableComposition
                invoices={effectiveInvoices}
                dominantCcy={stats.dominantCcy}
                onDrill={setDrillDown}
              />
            )}
            {/* Promised — breakdown row */}
            <Card padding="md" className="mb-3">
              <div className="flex items-center justify-between mb-4">
                <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold">Committed to Pay</div>
                {!snapshotLoading && stats.promisedBroken > 0 && (
                  <div className="flex items-center gap-1 text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded-full">
                    <AlertTriangle size={10} /> {stats.promisedBrokenCount} broken commitment{stats.promisedBrokenCount !== 1 ? "s" : ""}
                  </div>
                )}
              </div>
              {snapshotLoading ? (
                <div className="grid grid-cols-4 gap-4">
                  {[0,1,2,3].map(i => <div key={i}><S /><Sub /></div>)}
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-4 divide-x divide-stone-800">
                  {/* Broken */}
                  <button
                    onClick={() => stats.promisedBrokenCount > 0 && setDrillDown({ title: "Broken Commitments", subtitle: "Commitment date passed — follow up now", color: "rose", items: stats.promisedBrokenItems })}
                    className={`pr-4 text-left group ${stats.promisedBrokenCount > 0 ? "cursor-pointer" : "cursor-default"}`}
                  >
                    <div className="text-[10px] uppercase tracking-wider text-rose-500/80 font-semibold mb-1">Broken Commitments</div>
                    <div className={`text-2xl font-semibold tabular-nums tracking-tight ${stats.promisedBroken > 0 ? "text-rose-400" : "text-stone-600"}`}>
                      {fmt.money(stats.promisedBroken, stats.dominantCcy)}
                    </div>
                    <div className="mt-1.5 text-[11px] text-stone-500">
                      {stats.promisedBrokenCount === 0 ? "None — all on track" : `${stats.promisedBrokenCount} commitment${stats.promisedBrokenCount !== 1 ? "s" : ""} passed`}
                    </div>
                    {stats.promisedBroken > 0 && (
                      <span className="mt-2 text-[10px] text-rose-500 bg-rose-500/10 rounded px-1.5 py-0.5 inline-block group-hover:bg-rose-500/20">View invoices →</span>
                    )}
                  </button>
                  {/* This Week */}
                  <button
                    onClick={() => stats.promisedWeekCount > 0 && setDrillDown({ title: "Commitments Due This Week", subtitle: "Commitment date within the next 7 days", color: "amber", items: stats.promisedWeekItems })}
                    className={`px-4 text-left group ${stats.promisedWeekCount > 0 ? "cursor-pointer" : "cursor-default"}`}
                  >
                    <div className="text-[10px] uppercase tracking-wider text-amber-500/80 font-semibold mb-1">This Week</div>
                    <div className={`text-2xl font-semibold tabular-nums tracking-tight ${stats.promisedWeek > 0 ? "text-amber-400" : "text-stone-600"}`}>
                      {fmt.money(stats.promisedWeek, stats.dominantCcy)}
                    </div>
                    <div className="mt-1.5 text-[11px] text-stone-500">
                      {stats.promisedWeekCount === 0 ? "Nothing due" : `${stats.promisedWeekCount} invoice${stats.promisedWeekCount !== 1 ? "s" : ""} · due ≤7 days`}
                    </div>
                    {stats.promisedWeek > 0 && (
                      <span className="mt-2 text-[10px] text-amber-500 bg-amber-500/10 rounded px-1.5 py-0.5 inline-block group-hover:bg-amber-500/20">View invoices →</span>
                    )}
                  </button>
                  {/* This Month */}
                  <button
                    onClick={() => stats.promisedMonthCount > 0 && setDrillDown({ title: "Commitments Due This Month", subtitle: "Commitment date 8–30 days from today", color: "sky", items: stats.promisedMonthItems })}
                    className={`px-4 text-left group ${stats.promisedMonthCount > 0 ? "cursor-pointer" : "cursor-default"}`}
                  >
                    <div className="text-[10px] uppercase tracking-wider text-sky-500/80 font-semibold mb-1">This Month</div>
                    <div className={`text-2xl font-semibold tabular-nums tracking-tight ${stats.promisedMonth > 0 ? "text-sky-400" : "text-stone-600"}`}>
                      {fmt.money(stats.promisedMonth, stats.dominantCcy)}
                    </div>
                    <div className="mt-1.5 text-[11px] text-stone-500">
                      {stats.promisedMonthCount === 0 ? "Nothing due" : `${stats.promisedMonthCount} invoice${stats.promisedMonthCount !== 1 ? "s" : ""} · due 8–30 days`}
                    </div>
                    {stats.promisedMonth > 0 && (
                      <span className="mt-2 text-[10px] text-sky-500 bg-sky-500/10 rounded px-1.5 py-0.5 inline-block group-hover:bg-sky-500/20">View invoices →</span>
                    )}
                  </button>
                  {/* Total */}
                  <button
                    onClick={() => stats.promisedTotalCount > 0 && setDrillDown({ title: "All Active Commitments", subtitle: "All invoices with a payment commitment", color: "stone", items: stats.promisedAllItems })}
                    className={`pl-4 text-left group ${stats.promisedTotalCount > 0 ? "cursor-pointer" : "cursor-default"}`}
                  >
                    <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold mb-1">Total Pipeline</div>
                    <div className="text-2xl font-semibold text-white tabular-nums tracking-tight">
                      {fmt.money(stats.promised, stats.dominantCcy)}
                    </div>
                    <div className="mt-1.5 text-[11px] text-stone-500">
                      {stats.promisedTotalCount} active commitment{stats.promisedTotalCount !== 1 ? "s" : ""}
                    </div>
                    {/* Mini progress bar: broken vs healthy */}
                    {stats.promisedTotalCount > 0 && (
                      <div className="mt-2 h-1 bg-stone-800 rounded-full overflow-hidden w-full">
                        <div
                          className="h-full bg-rose-500"
                          style={{ width: `${stats.promised > 0 ? (stats.promisedBroken / stats.promised) * 100 : 0}%` }}
                        />
                      </div>
                    )}
                    {stats.promisedTotalCount > 0 && (
                      <div className="mt-1 text-[10px] text-stone-600 group-hover:text-stone-500">
                        {stats.promised > 0 ? ((stats.promisedBroken / stats.promised) * 100).toFixed(0) : 0}% broken commitments · view all →
                      </div>
                    )}
                  </button>
                </div>
              )}
            </Card>
          </>
        );
      })()}

      {/* ── Needs attention — the act-today zone ─────────────────── */}
      <div className="mt-6 mb-3">
        <h2 className="text-base font-semibold text-white">Needs attention</h2>
        <p className="text-[11px] text-stone-500 mt-0.5">Act on these today — chase, respond, follow up</p>
      </div>
      {alerts.length > 0 && (
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0" />
              <h3 className="text-sm font-semibold text-white">Needs attention</h3>
            </div>
            <div className="space-y-2">
              {alerts.map((alert, i) => (
                <Link
                  key={i}
                  href={alert.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-r-lg border-l-2 ${alert.color === "rose" ? "border-rose-500 bg-rose-500/10 hover:bg-rose-500/15" : "border-amber-400 bg-amber-500/10 hover:bg-amber-500/15"}`}
                >
                  <div className={`flex-shrink-0 ${alert.color === "rose" ? "text-rose-400" : "text-amber-400"}`}>
                    {alert.icon === "AlertTriangle" ? <AlertTriangle size={16} /> : <Mail size={16} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`text-[13px] font-semibold ${alert.color === "rose" ? "text-rose-200" : "text-amber-200"}`}>{alert.label}</div>
                    <div className={`text-[11px] mt-0.5 ${alert.color === "rose" ? "text-rose-400" : "text-amber-400"}`}>{alert.sub}</div>
                  </div>
                  <ChevronRight size={14} className={`flex-shrink-0 ${alert.color === "rose" ? "text-rose-500" : "text-amber-500"}`} />
                </Link>
              ))}
            </div>
          </Card>
        )}

      <div className="mb-3">
      <ResponsesDashboardWidget />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white">Top overdue customers</h3>
            <Link href="/customers" className="text-xs text-stone-500 hover:text-stone-300 flex items-center gap-1">View all <ArrowUpRight size={12} /></Link>
          </div>
          {topOverdue.length === 0 ? <div className="py-8 text-center text-sm text-stone-500">No overdue customers</div> : (
            <div className="space-y-1">
              {topOverdue.map(({ customer, amount, currency }, i) => (
                <Link key={customer.id} href={`/customers/${customer.id}`} className="w-full flex items-center gap-3 px-2 py-2.5 rounded-md hover:bg-stone-800/60 group">
                  <div className="w-6 text-xs text-stone-500 font-mono">{i + 1}</div>
                  <div className="w-9 h-9 rounded-md bg-gradient-to-br from-stone-700 to-stone-800 flex items-center justify-center text-stone-300 text-xs font-semibold flex-shrink-0">
                    {customer.name.split(" ").slice(0, 2).map((w: string) => w[0]).join("")}
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <div className="text-sm font-medium text-white truncate">{customer.name}</div>
                    <div className="text-[11px] text-stone-500">
                      {customer.code && !customer.code.startsWith("QBO-") ? `${customer.code} · ` : ""}{customer.country}
                    </div>
                  </div>
                  {customer.riskRating === "High" && <Badge variant="red" size="sm">High risk</Badge>}
                  <div className="text-sm font-semibold text-white tabular-nums">{fmt.money(amount, currency)}</div>
                  <ChevronRight size={14} className="text-stone-600 group-hover:text-stone-400" />
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Proactive pipeline</h3>
              <p className="text-[11px] text-stone-500 mt-0.5">Due in 7–14 days, not yet contacted</p>
            </div>
            <Link href="/smart-views" className="text-xs text-stone-500 hover:text-stone-900 flex items-center gap-1">Smart Views <ArrowUpRight size={12} /></Link>
          </div>
          {stats.proactivePipeline.length === 0 ? (
            <div className="py-6 text-center">
              <div className="text-2xl font-semibold text-emerald-400 mb-1">✓</div>
              <div className="text-sm text-stone-500">All upcoming invoices contacted</div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2 mb-3">
                <strong>{stats.proactivePipeline.length}</strong> invoice{stats.proactivePipeline.length !== 1 ? "s" : ""} due soon with no contact logged — reach out now
              </div>
              {stats.proactivePipeline.slice(0, 4).map(inv => {
                const customer = customers.find(c => c.id === inv.customerId);
                const d = Math.abs(daysOverdue(inv.dueDate));
                return (
                  <Link key={inv.id} href={`/invoices/${inv.id}`} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-stone-800/60">
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium text-stone-200 truncate">{customer?.name}</div>
                      <div className="text-[11px] text-stone-500 font-mono">{inv.invoiceNumber}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[12px] font-semibold tabular-nums text-white">{fmt.money(inv.total - (inv.paid || 0), inv.currency)}</div>
                      <div className="text-[10px] text-amber-400">in {d}d</div>
                    </div>
                  </Link>
                );
              })}
              {stats.proactivePipeline.length > 4 && (
                <div className="text-center text-[11px] text-stone-500 pt-1">+{stats.proactivePipeline.length - 4} more</div>
              )}
            </div>
          )}
        </Card>

        <Card className="col-span-3">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white">Invoices due this week</h3>
            <span className="text-xs text-stone-500">{stats.dueThisWeek.length} invoices</span>
          </div>
          {stats.dueThisWeek.length === 0 ? <div className="py-8 text-center text-sm text-stone-500">No invoices due this week</div> : (
            <div className="grid grid-cols-2 gap-2">
              {stats.dueThisWeek.slice(0, 6).map(inv => {
                const customer = customers.find(c => c.id === inv.customerId);
                return (
                  <Link key={inv.id} href={`/invoices/${inv.id}`} className="flex items-center gap-3 p-3 rounded-md border border-stone-800 hover:border-stone-700 hover:bg-stone-800/50">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white truncate">{customer?.name}</div>
                      <div className="text-[11px] text-stone-500 mt-0.5 font-mono">{inv.invoiceNumber}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-white tabular-nums">{fmt.money(openBal(inv), inv.currency)}</div>
                      <div className="text-[11px] text-stone-500 mt-0.5">Due {fmt.shortDate(inv.dueDate)}</div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* ── Aging & risk — portfolio structure ───────────────────── */}
      <div className="mt-6 mb-3">
        <h2 className="text-base font-semibold text-white">Aging & risk</h2>
        <p className="text-[11px] text-stone-500 mt-0.5">Portfolio structure and exposure</p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Card className="col-span-2">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-sm font-semibold text-white">Aging buckets</h3>
            <Link href="/reports" className="text-xs text-stone-500 hover:text-stone-300 flex items-center gap-1">Aging report <ArrowUpRight size={12} /></Link>
          </div>
          <div className="space-y-3">
            {["Current", "1-30", "31-60", "61-90", "90+"].map((bucket, i) => {
              const colors = ["bg-emerald-500", "bg-amber-400", "bg-orange-500", "bg-rose-500", "bg-rose-700"];
              const labels = ["Current (not due)", "1-30 days", "31-60 days", "61-90 days", "90+ days"];
              const pct = (stats.buckets[bucket] / maxBucket) * 100;
              return (
                <div key={bucket} className="flex items-center gap-3">
                  <div className="w-32 text-xs text-stone-400 font-medium">{labels[i]}</div>
                  <div className="flex-1 h-7 bg-stone-800 rounded relative overflow-hidden">
                    <div className={`h-full ${colors[i]}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="w-28 text-right text-sm font-semibold text-white tabular-nums">{fmt.money(stats.buckets[bucket], stats.dominantCcy)}</div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="col-span-1">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Concentration risk</h3>
              <p className="text-[11px] text-stone-500 mt-0.5">Top 5 customers as % of total AR</p>
            </div>
            {concentrationRisk.top5Pct > 50 && (
              <div className="flex items-center gap-1 text-[11px] text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2 py-1 rounded-md">
                <AlertTriangle size={11} /> High concentration
              </div>
            )}
          </div>
          {concentrationRisk.rows.length === 0 ? (
            <div className="py-6 text-center text-sm text-stone-500">No open AR</div>
          ) : (
            <div className="space-y-2.5">
              {concentrationRisk.rows.map(({ customer, amount, pct, currency }) => (
                <Link key={customer.id} href={`/customers/${customer.id}`} className="block group">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[12px] font-medium text-stone-300 truncate group-hover:text-white">{customer.name}</span>
                    <div className="flex items-center gap-2 ml-2 shrink-0">
                      <span className="text-[11px] font-semibold text-stone-200 tabular-nums">{fmt.money(amount, currency)}</span>
                      <span className={`text-[11px] font-bold tabular-nums w-10 text-right ${pct > 20 ? "text-amber-400" : "text-stone-500"}`}>{pct.toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-stone-800 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${pct > 20 ? "bg-amber-400" : "bg-stone-500"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                </Link>
              ))}
              <div className="pt-2 border-t border-stone-800 flex items-center justify-between">
                <span className="text-[11px] text-stone-500">Top 5 total concentration</span>
                <span className={`text-[12px] font-bold tabular-nums ${concentrationRisk.top5Pct > 50 ? "text-amber-400" : "text-emerald-400"}`}>
                  {concentrationRisk.top5Pct.toFixed(1)}%
                </span>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* ── AR by Region ──────────────────────────────────────────────── */}
      {arByRegion.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-semibold text-white">AR by Region</h2>
              <p className="text-[11px] text-stone-500 mt-0.5">Open receivables broken down by region</p>
            </div>
          </div>
          <div className={`grid gap-3 ${arByRegion.length === 1 ? "grid-cols-1" : arByRegion.length === 2 ? "grid-cols-2" : arByRegion.length === 3 ? "grid-cols-3" : "grid-cols-4"}`}>
            {arByRegion.map(({ id, name, total, overdue, count, byCurrency }) => {
              const overduePct = total > 0 ? (overdue / total) * 100 : 0;
              const currentAmt = total - overdue;
              const regionDominantCcy = Object.keys(byCurrency)[0] ?? "EUR";
              return (
                <Card key={id} padding="md">
                  <div className="flex items-start justify-between mb-3">
                    <div className="text-[12px] font-semibold text-stone-400 uppercase tracking-wide">{name}</div>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${overduePct > 50 ? "bg-rose-500/15 text-rose-400" : overduePct > 25 ? "bg-amber-500/15 text-amber-400" : "bg-emerald-500/15 text-emerald-400"}`}>
                      {overduePct.toFixed(0)}% overdue
                    </span>
                  </div>
                  <div className="text-2xl font-semibold text-white tracking-tight tabular-nums mb-1">
                    <CurrencyPills breakdown={byCurrency} />
                  </div>
                  <div className="text-[11px] text-stone-500 mb-3">{count} open invoice{count !== 1 ? "s" : ""}</div>
                  {/* Stacked bar: current vs overdue */}
                  <div className="h-2 rounded-full overflow-hidden bg-stone-800 mb-2">
                    <div className="h-full flex">
                      {currentAmt > 0 && (
                        <div
                          className="h-full bg-emerald-500"
                          style={{ width: `${total > 0 ? (currentAmt / total) * 100 : 0}%` }}
                        />
                      )}
                      {overdue > 0 && (
                        <div
                          className={`h-full ${overduePct > 50 ? "bg-rose-500" : "bg-amber-400"}`}
                          style={{ width: `${overduePct}%` }}
                        />
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-stone-400">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> {fmt.money(currentAmt, regionDominantCcy)} current</span>
                    {overdue > 0 && (
                      <span className={`flex items-center gap-1 font-medium ${overduePct > 50 ? "text-rose-500" : "text-amber-500"}`}>
                        <span className={`w-2 h-2 rounded-full inline-block ${overduePct > 50 ? "bg-rose-500" : "bg-amber-400"}`} />
                        {fmt.money(overdue, regionDominantCcy)} overdue
                      </span>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}


      {/* ── AR Health ─────────────────────────────────────────────────── */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-white">AR Health</h2>
            <p className="text-[11px] text-stone-500 mt-0.5">5-dimension quality score — reconciled with AR Reports</p>
          </div>
          {snapshotLoading && (
            <div className="flex items-center gap-1.5 text-[11px] text-stone-400">
              <span className="w-2 h-2 rounded-full bg-stone-300 animate-pulse" />
              Syncing with QBO…
            </div>
          )}
        </div>
        <ArHealthWidget
          invoices={effectiveInvoices}
          customers={customers}
          projects={projects}
          reps={reps ?? []}
          communications={communications}
        />
      </div>

      {/* ── Team activity — collections output & personal tasks ──── */}
      <div className="mt-6 mb-3">
        <h2 className="text-base font-semibold text-white">Team activity</h2>
        <p className="text-[11px] text-stone-500 mt-0.5">Collections output this week and your open tasks</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <h3 className="text-sm font-semibold text-white mb-4">Activity (7 days)</h3>
          <div className="space-y-4">
            <div>
              <div className="flex items-baseline justify-between mb-1"><span className="text-xs text-stone-400">Emails sent</span><span className="text-lg font-semibold text-white">{stats.emailsSent}</span></div>
              <div className="h-1.5 bg-stone-800 rounded"><div className="h-full bg-emerald-600 rounded" style={{ width: `${Math.min(stats.emailsSent * 10, 100)}%` }} /></div>
            </div>
            <div>
              <div className="flex items-baseline justify-between mb-1"><span className="text-xs text-stone-400">Replies received</span><span className="text-lg font-semibold text-white">{stats.replies}</span></div>
              <div className="h-1.5 bg-stone-800 rounded"><div className="h-full bg-emerald-500 rounded" style={{ width: `${Math.min(stats.replies * 20, 100)}%` }} /></div>
            </div>
            <div className="pt-3 border-t border-stone-800">
              <div className="text-xs text-stone-400 mb-1">Reply rate</div>
              <div className="text-lg font-semibold text-white">{stats.emailsSent ? Math.round(stats.replies / stats.emailsSent * 100) : 0}%</div>
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white">My tasks today</h3>
            <Link href="/tasks" className="text-xs text-stone-500 hover:text-stone-300 flex items-center gap-1">All tasks <ArrowUpRight size={12} /></Link>
          </div>
          {myTasks.length === 0 ? <div className="py-8 text-center text-sm text-stone-500">All caught up</div> : (
            <div className="space-y-2">
              {myTasks.map(t => {
                const overdue = new Date(t.dueDate) < new Date(today());
                const href = t.invoiceId ? `/invoices/${t.invoiceId}` : "/tasks";
                return (
                  <Link key={t.id} href={href} className="w-full flex items-start gap-2.5 px-2 py-2 rounded-md hover:bg-stone-800/60">
                    <Circle size={14} className="text-stone-600 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">{t.title}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-[11px] ${overdue ? "text-rose-600 font-medium" : "text-stone-500"}`}>{fmt.relative(t.dueDate)}</span>
                        {t.priority === "Urgent" && <Badge variant="red" size="sm">Urgent</Badge>}
                        {t.priority === "High" && <Badge variant="orange" size="sm">High</Badge>}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* ── Promised-bucket drill-down slide-over ──────────────────────── */}
      {drillDown && (
        <DrillDownPanel
          drillDown={drillDown}
          onClose={() => setDrillDown(null)}
          customers={customers}
          projects={projects}
          dominantCcy={stats.dominantCcy}
        />
      )}
    </div>
  );
}
