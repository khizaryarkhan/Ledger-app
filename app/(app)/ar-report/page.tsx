"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/components/data-provider";
import { useSession } from "next-auth/react";
import { daysOverdue } from "@/lib/format";
import { COMPOSITION_CATEGORIES } from "@/lib/receivable-composition";
import { Printer, ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";

// ── helpers ───────────────────────────────────────────────────────────────────
function openBal(inv: any): number {
  if (inv.qboBalance != null) return Number(inv.qboBalance);
  return Math.max(0, Number(inv.total || 0) - Number(inv.paid || 0));
}
const money = (n: number, ccy?: string | null) => {
  const sym = ccy === "GBP" ? "£" : ccy === "EUR" ? "€" : ccy === "USD" ? "$" : ccy ? ccy + " " : "";
  return sym + Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};
const pct = (n: number) => n.toFixed(1) + "%";
const todayStr = () => new Date().toISOString().split("T")[0];
const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

// ── mini components ───────────────────────────────────────────────────────────
function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ background: "#1A2744", borderRadius: 6, padding: "14px 24px", marginBottom: 20, marginTop: 0 }}>
      <div style={{ borderBottom: "2px solid #B38C38", paddingBottom: 10, marginBottom: 8 }}>
        <div style={{ color: "#fff", fontSize: 15, fontWeight: 700, letterSpacing: "0.04em" }}>{title}</div>
      </div>
      {subtitle && <div style={{ color: "#94a3b8", fontSize: 11 }}>{subtitle}</div>}
    </div>
  );
}

function HBar({ val, max, color = "#1A2744" }: { val: number; max: number; color?: string }) {
  const w = max > 0 ? Math.max(Math.min((val / max) * 100, 100), 0) : 0;
  return (
    <div style={{ background: "#f3f4f6", borderRadius: 3, height: 7, width: "100%", overflow: "hidden" }}>
      <div style={{ background: color, height: "100%", width: `${w}%` }} />
    </div>
  );
}

function KpiBox({
  label, amount, ccy, count, accent = "#1A2744",
}: { label: string; amount: number; ccy?: string | null; count?: number; accent?: string }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderTop: `4px solid ${accent}`, borderRadius: 8, padding: "16px 18px", background: "#fff" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: "#1A2744", lineHeight: 1 }}>{money(amount, ccy)}</div>
      {count != null && (
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 5 }}>{count} {count === 1 ? "invoice" : "invoices"}</div>
      )}
    </div>
  );
}

function TH({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th style={{ padding: "9px 14px", background: "#1A2744", color: "#fff", fontSize: 11, fontWeight: 700, textAlign: right ? "right" : "left", whiteSpace: "nowrap" }}>
      {children}
    </th>
  );
}
function TD({ children, right, bold, color }: { children: React.ReactNode; right?: boolean; bold?: boolean; color?: string }) {
  return (
    <td style={{ padding: "9px 14px", textAlign: right ? "right" : "left", fontWeight: bold ? 700 : 400, color: color ?? "#374151", fontSize: 12, borderBottom: "1px solid #f3f4f6" }}>
      {children}
    </td>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────
export default function ArReportPage() {
  const { invoices, customers, reps, communications, orgSettings, loaded } = useData();
  const { data: session } = useSession();
  const [snapshot, setSnapshot]       = useState<any[]>([]);
  const [snapshotReady, setSnapReady] = useState(false);

  useEffect(() => {
    fetch(`/api/reports/ar-snapshot?asOf=${todayStr()}`)
      .then(r => r.ok ? r.json() : { data: [] })
      .then(d => { setSnapshot(d.data ?? d ?? []); setSnapReady(true); })
      .catch(() => setSnapReady(true));
  }, []);

  // Merge snapshot balances
  const effective = useMemo(() => {
    if (!snapshot.length) return invoices;
    const map = new Map(snapshot.map((s: any) => [s.invoiceId ?? s.id, s]));
    return invoices.map((inv: any) => {
      const snap = map.get(inv.id) ?? map.get(inv.qboId) ?? map.get(inv.xeroId);
      return snap ? { ...inv, qboBalance: snap.balance ?? snap.qboBalance ?? inv.qboBalance } : inv;
    });
  }, [invoices, snapshot]);

  const m = useMemo(() => {
    const open = effective.filter((i: any) =>
      i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off" && i.txnType !== "CreditMemo"
    );
    const credits = effective.filter((i: any) => i.txnType === "CreditMemo" && openBal(i) < 0);

    // per-currency totals
    const byCcy: Record<string, { total: number; overdueAmt: number; count: number }> = {};
    [...open, ...credits].forEach((i: any) => {
      const c = i.currency || "EUR";
      if (!byCcy[c]) byCcy[c] = { total: 0, overdueAmt: 0, count: 0 };
      const b = openBal(i);
      byCcy[c].total += b;
      if (i.txnType !== "CreditMemo") byCcy[c].count += 1;
      if (daysOverdue(i.dueDate) > 0 && i.txnType !== "CreditMemo") byCcy[c].overdueAmt += b;
    });

    const currencies = Object.keys(byCcy);
    const dom = currencies[0] ?? "EUR";

    const domRows = [...open.filter((i: any) => (i.currency || "EUR") === dom),
                     ...credits.filter((i: any) => (i.currency || "EUR") === dom)];
    const domOpen = open.filter((i: any) => (i.currency || "EUR") === dom);

    const domTotal = domRows.reduce((s: number, i: any) => s + openBal(i), 0);

    // aging
    const agingDef = [
      { label: "Current (Not Due)",  lo: -Infinity, hi: 0,  color: "#059669", days: "≤ 0d" },
      { label: "1–30 Days",          lo: 0,          hi: 30, color: "#d97706", days: "1–30d" },
      { label: "31–60 Days",         lo: 30,         hi: 60, color: "#f59e0b", days: "31–60d" },
      { label: "61–90 Days",         lo: 60,         hi: 90, color: "#ef4444", days: "61–90d" },
      { label: "90+ Days",           lo: 90,         hi: Infinity, color: "#b91c1c", days: ">90d" },
    ];
    const agingBuckets = agingDef.map(def => {
      const rows = domRows.filter((i: any) => {
        const d = daysOverdue(i.dueDate);
        return d > def.lo && d <= def.hi;
      });
      return { ...def, amount: rows.reduce((s: number, i: any) => s + openBal(i), 0), count: rows.filter((i: any) => i.txnType !== "CreditMemo").length };
    });

    // composition groups
    type Group = "blocked" | "workable" | "current";
    const groups: Record<Group, { total: number; count: number }> = {
      blocked:  { total: 0, count: 0 },
      workable: { total: 0, count: 0 },
      current:  { total: 0, count: 0 },
    };
    domOpen.forEach((inv: any) => {
      const overdueDays = daysOverdue(inv.dueDate);
      const item = { ...inv, overdueDays };
      const cat = COMPOSITION_CATEGORIES.find(c => c.match(item));
      const group: Group = (cat?.group ?? (overdueDays > 0 ? "workable" : "current")) as Group;
      groups[group].total += openBal(inv);
      groups[group].count += 1;
    });

    // concentration — top 15 by open AR (dom ccy)
    const byCust: Record<string, { bal: number; overdue: number; lastContact: string | null; count: number }> = {};
    domOpen.forEach((i: any) => {
      if (!byCust[i.customerId]) byCust[i.customerId] = { bal: 0, overdue: 0, lastContact: null, count: 0 };
      const b = openBal(i);
      byCust[i.customerId].bal += b;
      byCust[i.customerId].count += 1;
      if (daysOverdue(i.dueDate) > 0) byCust[i.customerId].overdue += b;
      if (i.lastFollowupDate) {
        const prev = byCust[i.customerId].lastContact;
        if (!prev || i.lastFollowupDate > prev) byCust[i.customerId].lastContact = i.lastFollowupDate;
      }
    });
    const concentration = Object.entries(byCust)
      .sort(([, a], [, b]) => b.bal - a.bal)
      .slice(0, 15)
      .map(([custId, v]) => {
        const c = customers.find((x: any) => x.id === custId);
        return { name: c?.name ?? c?.displayName ?? "—", ...v, pctOfTotal: domTotal > 0 ? (v.bal / domTotal) * 100 : 0 };
      });

    // pipeline
    const now = Date.now();
    const week  = now + 7  * 86400000;
    const month = now + 30 * 86400000;
    const promised = domOpen.filter((i: any) => i.promiseDate);
    const broken   = promised.filter((i: any) => daysOverdue(i.promiseDate) > 0);
    const wk       = promised.filter((i: any) => { const t = new Date(i.promiseDate).getTime(); return t >= now && t <= week; });
    const mo       = promised.filter((i: any) => { const t = new Date(i.promiseDate).getTime(); return t > week && t <= month; });
    const sum      = (arr: any[]) => arr.reduce((s: number, i: any) => s + openBal(i), 0);

    // health score
    const overdueAmt = byCcy[dom]?.overdueAmt ?? 0;
    const disputedAmt = domOpen.filter((i: any) => i.hasOpenDispute || i.collectionStage === "Disputed").reduce((s: number, i: any) => s + openBal(i), 0);
    const over90Amt   = agingBuckets[4].amount;
    const agingScore  = domTotal > 0
      ? (agingBuckets[0].amount * 100 + agingBuckets[1].amount * 70 + agingBuckets[2].amount * 40 + agingBuckets[3].amount * 20 + agingBuckets[4].amount * 5) / domTotal
      : 100;
    const disputeRate = domTotal > 0 ? (disputedAmt / domTotal) * 100 : 0;
    const highRiskAR  = domOpen.filter((i: any) => customers.find((c: any) => c.id === i.customerId)?.riskRating === "High").reduce((s: number, i: any) => s + openBal(i), 0);
    const highRiskPct = domTotal > 0 ? (highRiskAR / domTotal) * 100 : 0;
    const riskScore   = Math.max(0, 100 - Math.min(disputeRate * 3, 50) - Math.min(highRiskPct, 40));
    const neverContactedRate = domOpen.length > 0 ? domOpen.filter((i: any) => daysOverdue(i.dueDate) > 0 && !i.lastFollowupDate).length / domOpen.length * 100 : 0;
    const brokenRate  = promised.length > 0 ? broken.length / promised.length * 100 : 0;
    const over90Pct   = domTotal > 0 ? over90Amt / domTotal * 100 : 0;
    const collectionScore = Math.max(0, 100 - Math.min(neverContactedRate * 0.5, 45) - Math.min(brokenRate * 1.5, 35) - Math.min(over90Pct * 0.4, 20));
    const healthScore = Math.round((agingScore + riskScore + collectionScore) / 3);

    // 30-day comms
    const cutoff = Date.now() - 30 * 86400000;
    const emails30d  = communications.filter((c: any) => c.direction === "Outbound" && c.channel === "Email" && new Date(c.sentAt).getTime() > cutoff).length;
    const replies30d = communications.filter((c: any) => c.direction === "Inbound"  && new Date(c.sentAt).getTime() > cutoff).length;

    return {
      dom, currencies, byCcy, domTotal, openCount: open.length,
      agingBuckets, groups,
      overdueAmt, over90Amt, disputedAmt,
      overdueCount: domOpen.filter((i: any) => daysOverdue(i.dueDate) > 0).length,
      over90Count:  domOpen.filter((i: any) => daysOverdue(i.dueDate) > 90).length,
      disputedCount: domOpen.filter((i: any) => i.hasOpenDispute || i.collectionStage === "Disputed").length,
      concentration,
      broken, wk, mo, promised,
      brokenAmt: sum(broken), wkAmt: sum(wk), moAmt: sum(mo), pipelineAmt: sum(promised),
      healthScore, agingScore: Math.round(agingScore), riskScore: Math.round(riskScore), collectionScore: Math.round(collectionScore),
      emails30d, replies30d,
    };
  }, [effective, customers, communications]);

  if (!loaded || !snapshotReady) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
        <Loader2 size={24} className="animate-spin" style={{ color: "#1A2744" }} />
        <span style={{ marginLeft: 12, color: "#6b7280", fontSize: 14 }}>Preparing report…</span>
      </div>
    );
  }

  const orgName   = orgSettings.displayName || orgSettings.name || "Organisation";
  const logoUrl   = orgSettings.logoUrl;
  const userName  = (session?.user as any)?.name ?? "System";
  const reportDate = fmtDate(new Date());
  const hc = m.healthScore >= 75 ? "#059669" : m.healthScore >= 50 ? "#d97706" : "#dc2626";

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .pg { page-break-before: always; break-before: page; }
          @page { size: A4; margin: 10mm 14mm 12mm; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
        }
        body { background: #f8fafc; }
      `}</style>

      {/* Screen-only toolbar */}
      <div className="no-print" style={{ background: "#1A2744", padding: "10px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50, boxShadow: "0 1px 4px rgba(0,0,0,0.3)" }}>
        <Link href="/dashboard" style={{ color: "#B38C38", display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 500, textDecoration: "none" }}>
          <ArrowLeft size={14} />
          Back to Dashboard
        </Link>
        <div style={{ color: "#94a3b8", fontSize: 12 }}>AR Management Report · {orgName}</div>
        <button
          onClick={() => window.print()}
          style={{ background: "#B38C38", color: "#fff", border: "none", borderRadius: 6, padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
        >
          <Printer size={14} />
          Print / Save as PDF
        </button>
      </div>

      {/* ── Report body ───────────────────────────────────────────────── */}
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "28px 24px 64px", fontFamily: "Arial, Helvetica, sans-serif" }}>

        {/* ── PAGE 1 — EXECUTIVE SUMMARY ─────────────────────────────── */}

        {/* Letterhead */}
        <div style={{ background: "#1A2744", borderRadius: 8, overflow: "hidden", marginBottom: 22 }}>
          <div style={{ borderBottom: "3px solid #B38C38", padding: "22px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              {logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="" style={{ height: 38, maxWidth: 130, objectFit: "contain" }} />
              )}
              <div>
                <div style={{ color: "#fff", fontSize: 17, fontWeight: 700, lineHeight: 1.2 }}>{orgName}</div>
                <div style={{ color: "#B38C38", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 3 }}>
                  Accounts Receivable Management Report
                </div>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "#94a3b8", fontSize: 10, marginBottom: 2 }}>Report Date</div>
              <div style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>{reportDate}</div>
            </div>
          </div>
          <div style={{ padding: "7px 28px", background: "rgba(0,0,0,0.18)", display: "flex", gap: 28, flexWrap: "wrap" }}>
            {[
              ["Prepared by", userName],
              ["Currency", m.dom + (m.currencies.length > 1 ? " (primary)" : "")],
              ["Open Invoices", String(m.openCount)],
              ["Report Period", "As of " + reportDate],
              ["Classification", "CONFIDENTIAL"],
            ].map(([k, v]) => (
              <div key={k} style={{ fontSize: 10, color: "#94a3b8" }}>{k}: <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{v}</span></div>
            ))}
          </div>
        </div>

        {/* KPI row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 18 }}>
          <KpiBox label="Total Receivable"   amount={m.byCcy[m.dom]?.total ?? 0} ccy={m.dom} count={m.openCount}        accent="#1A2744" />
          <KpiBox label="Overdue"            amount={m.overdueAmt}                ccy={m.dom} count={m.overdueCount}     accent="#dc2626" />
          <KpiBox label="90+ Days Overdue"   amount={m.over90Amt}                 ccy={m.dom} count={m.over90Count}      accent="#b91c1c" />
          <KpiBox label="Disputed"           amount={m.disputedAmt}               ccy={m.dom} count={m.disputedCount}    accent="#d97706" />
        </div>

        {/* Multi-currency note */}
        {m.currencies.length > 1 && (
          <div style={{ background: "#f0f3f8", border: "1px solid #dde3ee", borderRadius: 6, padding: "9px 14px", marginBottom: 18, fontSize: 11, color: "#555" }}>
            <strong style={{ color: "#1A2744" }}>Multi-currency portfolio. </strong>
            Additional currencies:{" "}
            {m.currencies.filter(c => c !== m.dom).map(c => `${c} ${money(m.byCcy[c].total, c)}`).join("  ·  ")}.
            Aging analysis and pipeline figures show {m.dom} only.
          </div>
        )}

        {/* Health + Composition */}
        <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 14, marginBottom: 18 }}>

          {/* Health score */}
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "18px", background: "#fff" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 10 }}>AR Health</div>
            <div style={{ textAlign: "center", padding: "6px 0 14px" }}>
              <div style={{ fontSize: 50, fontWeight: 900, color: hc, lineHeight: 1 }}>{m.healthScore}</div>
              <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 3 }}>out of 100</div>
            </div>
            {[
              { label: "Aging",      score: m.agingScore },
              { label: "Risk",       score: m.riskScore },
              { label: "Collection", score: m.collectionScore },
            ].map(({ label, score }) => {
              const c = score >= 75 ? "#059669" : score >= 50 ? "#d97706" : "#dc2626";
              return (
                <div key={label} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 10, color: "#6b7280" }}>{label}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: c }}>{score}</span>
                  </div>
                  <HBar val={score} max={100} color={c} />
                </div>
              );
            })}
          </div>

          {/* Composition */}
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "18px", background: "#fff" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 12 }}>Receivable Composition</div>

            {/* Stacked bar */}
            {m.domTotal > 0 && (
              <div style={{ height: 10, borderRadius: 5, overflow: "hidden", display: "flex", marginBottom: 16 }}>
                {([
                  { key: "blocked", color: "#ef4444" },
                  { key: "workable", color: "#0ea5e9" },
                  { key: "current", color: "#059669" },
                ] as const).map(({ key, color }) => {
                  const w = m.domTotal > 0 ? Math.max((m.groups[key].total / m.domTotal) * 100, 0) : 0;
                  return <div key={key} style={{ background: color, width: `${w}%`, height: "100%" }} />;
                })}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { key: "blocked",  label: "Blocked",                color: "#ef4444", bg: "#fef2f2" },
                { key: "workable", label: "In Collection (Workable)", color: "#0ea5e9", bg: "#f0f9ff" },
                { key: "current",  label: "Not Yet Due",             color: "#059669", bg: "#f0fdf4" },
              ].map(({ key, label, color, bg }) => {
                const g = m.groups[key as keyof typeof m.groups];
                const p = m.domTotal > 0 ? (g.total / m.domTotal) * 100 : 0;
                return (
                  <div key={key} style={{ background: bg, borderRadius: 6, padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 9, height: 9, borderRadius: "50%", background: color, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>{label}</span>
                      <span style={{ fontSize: 11, color: "#9ca3af" }}>({g.count})</span>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#1A2744" }}>{money(g.total, m.dom)}</div>
                      <div style={{ fontSize: 10, color: "#9ca3af" }}>{pct(p)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Committed to Pay Pipeline */}
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "18px", background: "#fff", marginBottom: 18 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 12 }}>Committed to Pay Pipeline</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
            {[
              { label: "Broken Commitments",  amount: m.brokenAmt,   count: m.broken.length,   color: "#dc2626", bg: "#fef2f2" },
              { label: "Due This Week",        amount: m.wkAmt,       count: m.wk.length,       color: "#d97706", bg: "#fffbeb" },
              { label: "Due This Month",       amount: m.moAmt,       count: m.mo.length,       color: "#1A2744", bg: "#f0f3f8" },
              { label: "Total Pipeline",       amount: m.pipelineAmt, count: m.promised.length, color: "#059669", bg: "#f0fdf4" },
            ].map(({ label, amount, count, color, bg }) => (
              <div key={label} style={{ background: bg, borderRadius: 6, padding: "12px 14px", borderTop: `3px solid ${color}` }}>
                <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color }}>{money(amount, m.dom)}</div>
                <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 3 }}>{count} {count === 1 ? "invoice" : "invoices"}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 30-day activity strip */}
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "14px 18px", background: "#fff", display: "flex", gap: 28 }}>
          <div>
            <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Emails Sent (30d)</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#1A2744" }}>{m.emails30d}</div>
          </div>
          <div style={{ width: 1, background: "#e5e7eb" }} />
          <div>
            <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Replies Received (30d)</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#1A2744" }}>{m.replies30d}</div>
          </div>
          <div style={{ width: 1, background: "#e5e7eb" }} />
          <div>
            <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Reply Rate</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#059669" }}>{m.emails30d > 0 ? pct((m.replies30d / m.emails30d) * 100) : "—"}</div>
          </div>
        </div>

        {/* ── PAGE 2 — AGING ANALYSIS ────────────────────────────────── */}
        <div className="pg" style={{ paddingTop: 4 }}>
          <SectionHeader title="AGING ANALYSIS" subtitle={`As of ${reportDate}  ·  ${m.dom} portfolio  ·  ${m.openCount} open invoices`} />
        </div>

        <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden", marginBottom: 22, background: "#fff" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <TH>Aging Bucket</TH>
                <TH right>Invoices</TH>
                <TH right>Amount</TH>
                <TH right>% of Total</TH>
                <TH>Distribution</TH>
              </tr>
            </thead>
            <tbody>
              {m.agingBuckets.map((b, i) => (
                <tr key={b.label} style={{ background: i % 2 === 0 ? "#f8fafc" : "#fff" }}>
                  <TD bold color={b.color}>{b.label}</TD>
                  <TD right>{b.count}</TD>
                  <TD right bold color="#1A2744">{money(b.amount, m.dom)}</TD>
                  <TD right>{m.domTotal > 0 ? pct((b.amount / m.domTotal) * 100) : "—"}</TD>
                  <td style={{ padding: "9px 14px 9px 0", width: 140 }}>
                    <div style={{ background: "#f3f4f6", borderRadius: 3, height: 7 }}>
                      <div style={{ background: b.color, height: "100%", width: `${m.domTotal > 0 ? Math.min((b.amount / m.domTotal) * 100, 100) : 0}%`, borderRadius: 3 }} />
                    </div>
                  </td>
                </tr>
              ))}
              <tr style={{ background: "#f0f3f8", borderTop: "2px solid #1A2744" }}>
                <TD bold color="#1A2744">Total</TD>
                <TD right bold color="#1A2744">{m.openCount}</TD>
                <TD right bold color="#1A2744">{money(m.domTotal, m.dom)}</TD>
                <TD right bold color="#1A2744">100.0%</TD>
                <td />
              </tr>
            </tbody>
          </table>
        </div>

        {/* Overdue rate callout */}
        <div style={{ background: m.overdueAmt / (m.domTotal || 1) > 0.5 ? "#fef2f2" : "#f0fdf4", border: `1px solid ${m.overdueAmt / (m.domTotal || 1) > 0.5 ? "#fecaca" : "#bbf7d0"}`, borderRadius: 6, padding: "10px 16px", marginBottom: 22, fontSize: 12, color: "#374151" }}>
          <strong style={{ color: "#1A2744" }}>Overdue rate: </strong>
          {m.domTotal > 0 ? pct((m.overdueAmt / m.domTotal) * 100) : "—"} of total AR is overdue.
          {" "}
          <strong style={{ color: "#1A2744" }}>90+ days rate: </strong>
          {m.domTotal > 0 ? pct((m.over90Amt / m.domTotal) * 100) : "—"}.
          {m.disputedAmt > 0 && <>{" "}<strong style={{ color: "#1A2744" }}>Disputed: </strong>{money(m.disputedAmt, m.dom)} ({m.disputedCount} invoices).</>}
        </div>

        {/* ── PAGE 3 — TOP DEBTORS ───────────────────────────────────── */}
        <div className="pg" style={{ paddingTop: 4 }}>
          <SectionHeader title="TOP DEBTORS & CONCENTRATION RISK" subtitle={`${m.dom} portfolio  ·  Top ${m.concentration.length} customers by open balance`} />
        </div>

        <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden", marginBottom: 22, background: "#fff" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <TH>#</TH>
                <TH>Customer</TH>
                <TH right>Open Balance</TH>
                <TH right>Overdue</TH>
                <TH right>% of AR</TH>
                <TH>Concentration</TH>
                <TH right>Last Contact</TH>
              </tr>
            </thead>
            <tbody>
              {m.concentration.map((c, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "#f8fafc" : "#fff" }}>
                  <TD color="#9ca3af">{i + 1}</TD>
                  <TD bold color="#1A2744">{c.name}</TD>
                  <TD right bold color="#1A2744">{money(c.bal, m.dom)}</TD>
                  <TD right color={c.overdue > 0 ? "#dc2626" : "#059669"}>{c.overdue > 0 ? money(c.overdue, m.dom) : "—"}</TD>
                  <TD right>{pct(c.pctOfTotal)}</TD>
                  <td style={{ padding: "9px 14px 9px 0", width: 120 }}>
                    <div style={{ background: "#f3f4f6", borderRadius: 3, height: 7 }}>
                      <div style={{ background: c.pctOfTotal > 20 ? "#ef4444" : "#1A2744", height: "100%", width: `${Math.min(c.pctOfTotal * 2, 100)}%`, borderRadius: 3 }} />
                    </div>
                  </td>
                  <TD right color="#6b7280">{c.lastContact ? new Date(c.lastContact).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}</TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Concentration risk note */}
        {(() => {
          const top5pct = m.concentration.slice(0, 5).reduce((s, c) => s + c.pctOfTotal, 0);
          return top5pct > 50 ? (
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "10px 16px", marginBottom: 22, fontSize: 12, color: "#374151" }}>
              <strong style={{ color: "#d97706" }}>Concentration Risk: </strong>
              Top 5 customers represent {pct(top5pct)} of total {m.dom} receivables.
              Concentrated debtor books increase credit risk exposure. Review credit terms for high-balance clients.
            </div>
          ) : null;
        })()}

        {/* ── PAGE 4 — COLLECTION PIPELINE (full promised list) ─────── */}
        {m.promised.length > 0 && (
          <>
            <div className="pg" style={{ paddingTop: 4 }}>
              <SectionHeader title="COLLECTION PIPELINE — PAYMENT COMMITMENTS" subtitle={`${m.promised.length} invoices with a confirmed payment date  ·  ${m.dom}`} />
            </div>

            <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden", marginBottom: 22, background: "#fff" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <TH>Invoice #</TH>
                    <TH>Customer</TH>
                    <TH right>Amount</TH>
                    <TH right>Due Date</TH>
                    <TH right>Promise Date</TH>
                    <TH>Status</TH>
                  </tr>
                </thead>
                <tbody>
                  {m.promised
                    .slice()
                    .sort((a: any, b: any) => (a.promiseDate > b.promiseDate ? 1 : -1))
                    .map((inv: any, i: number) => {
                      const isBroken = daysOverdue(inv.promiseDate) > 0;
                      const c = customers.find((x: any) => x.id === inv.customerId);
                      return (
                        <tr key={inv.id} style={{ background: i % 2 === 0 ? "#f8fafc" : "#fff" }}>
                          <TD bold color="#1A2744">{inv.invoiceNumber ?? inv.docNumber ?? "—"}</TD>
                          <TD>{c?.name ?? c?.displayName ?? "—"}</TD>
                          <TD right bold color="#1A2744">{money(openBal(inv), inv.currency)}</TD>
                          <TD right color={daysOverdue(inv.dueDate) > 0 ? "#dc2626" : "#374151"}>{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}</TD>
                          <TD right color={isBroken ? "#dc2626" : "#059669"}>{new Date(inv.promiseDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</TD>
                          <td style={{ padding: "9px 14px", borderBottom: "1px solid #f3f4f6" }}>
                            <span style={{ background: isBroken ? "#fef2f2" : "#f0fdf4", color: isBroken ? "#dc2626" : "#059669", borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>
                              {isBroken ? "Broken" : "Active"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── FOOTER strip ─────────────────────────────────────────────── */}
        <div style={{ borderTop: "2px solid #1A2744", paddingTop: 12, marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 10, color: "#9ca3af" }}>{orgName}</div>
          <div style={{ fontSize: 10, color: "#9ca3af" }}>Generated {reportDate} · CONFIDENTIAL — for internal use only</div>
          <div style={{ fontSize: 10, color: "#9ca3af" }}>Accounts Receivable Management Report</div>
        </div>
      </div>
    </>
  );
}
