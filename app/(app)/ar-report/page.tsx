"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/components/data-provider";
import { useSession } from "next-auth/react";
import { daysOverdue } from "@/lib/format";
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
const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const fmtShort = (d: string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// ── table primitives ──────────────────────────────────────────────────────────
const TH = ({ children, right, w }: { children?: React.ReactNode; right?: boolean; w?: string | number }) => (
  <th style={{ padding: "10px 16px", background: "#1A2744", color: "#fff", fontSize: 11, fontWeight: 700, textAlign: right ? "right" : "left", whiteSpace: "nowrap", width: w }}>
    {children}
  </th>
);
const TD = ({ children, right, bold, color, light, w }: { children?: React.ReactNode; right?: boolean; bold?: boolean; color?: string; light?: boolean; w?: string | number }) => (
  <td style={{ padding: "10px 16px", textAlign: right ? "right" : "left", fontWeight: bold ? 700 : 400, color: color ?? (light ? "#6b7280" : "#1f2937"), fontSize: 12, borderBottom: "1px solid #f3f4f6", width: w }}>
    {children}
  </td>
);

// ── page ──────────────────────────────────────────────────────────────────────
export default function ArReportPage() {
  const { invoices, customers, communications, orgSettings, loaded } = useData();
  const { data: session } = useSession();
  const [snapshot, setSnapshot]   = useState<any[]>([]);
  const [snapReady, setSnapReady] = useState(false);

  useEffect(() => {
    const asOf = new Date().toISOString().split("T")[0];
    fetch(`/api/reports/ar-snapshot?asOf=${asOf}`)
      .then(r => r.ok ? r.json() : { data: [] })
      .then(d => { setSnapshot(d.data ?? d ?? []); setSnapReady(true); })
      .catch(() => setSnapReady(true));
  }, []);

  const effective = useMemo(() => {
    if (!snapshot.length) return invoices;
    const map = new Map(snapshot.map((s: any) => [s.invoiceId ?? s.id, s]));
    return invoices.map((inv: any) => {
      const s = map.get(inv.id) ?? map.get(inv.qboId) ?? map.get(inv.xeroId);
      return s ? { ...inv, qboBalance: s.balance ?? s.qboBalance ?? inv.qboBalance } : inv;
    });
  }, [invoices, snapshot]);

  const m = useMemo(() => {
    const open = effective.filter((i: any) =>
      i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off" && i.txnType !== "CreditMemo"
    );
    const credits = effective.filter((i: any) => i.txnType === "CreditMemo" && openBal(i) < 0);

    // dominant currency
    const ccyCount: Record<string, number> = {};
    open.forEach((i: any) => { const c = i.currency || "EUR"; ccyCount[c] = (ccyCount[c] || 0) + openBal(i); });
    const dom = Object.keys(ccyCount).sort((a, b) => ccyCount[b] - ccyCount[a])[0] ?? "EUR";

    const domOpen    = open.filter((i: any) => (i.currency || "EUR") === dom);
    const domCredits = credits.filter((i: any) => (i.currency || "EUR") === dom);
    const domAll     = [...domOpen, ...domCredits];
    const domTotal   = domAll.reduce((s: number, i: any) => s + openBal(i), 0);

    // aging buckets
    const buckets = [
      { label: "Current",    hi: 0,        lo: -Infinity, color: "#16a34a" },
      { label: "1–30 days",  hi: 30,       lo: 0,         color: "#ca8a04" },
      { label: "31–60 days", hi: 60,       lo: 30,        color: "#ea580c" },
      { label: "61–90 days", hi: 90,       lo: 60,        color: "#dc2626" },
      { label: "90+ days",   hi: Infinity, lo: 90,        color: "#991b1b" },
    ].map(b => {
      const rows = domAll.filter((i: any) => { const d = daysOverdue(i.dueDate); return d > b.lo && d <= b.hi; });
      return { ...b, amount: rows.reduce((s: number, i: any) => s + openBal(i), 0), count: rows.filter((i: any) => i.txnType !== "CreditMemo").length };
    });

    // totals
    const overdueAmt  = domAll.filter((i: any) => daysOverdue(i.dueDate) > 0).reduce((s: number, i: any) => s + openBal(i), 0);
    const over90Amt   = buckets[4].amount;
    const disputedAmt = domOpen.filter((i: any) => i.hasOpenDispute || i.collectionStage === "Disputed").reduce((s: number, i: any) => s + openBal(i), 0);

    // top debtors
    const custBal: Record<string, { bal: number; overdue: number; last: string | null; count: number }> = {};
    domOpen.forEach((i: any) => {
      if (!custBal[i.customerId]) custBal[i.customerId] = { bal: 0, overdue: 0, last: null, count: 0 };
      custBal[i.customerId].bal   += openBal(i);
      custBal[i.customerId].count += 1;
      if (daysOverdue(i.dueDate) > 0) custBal[i.customerId].overdue += openBal(i);
      if (i.lastFollowupDate) {
        if (!custBal[i.customerId].last || i.lastFollowupDate > custBal[i.customerId].last!)
          custBal[i.customerId].last = i.lastFollowupDate;
      }
    });
    const debtors = Object.entries(custBal)
      .sort(([, a], [, b]) => b.bal - a.bal)
      .slice(0, 20)
      .map(([id, v]) => {
        const c = customers.find((x: any) => x.id === id);
        return { name: c?.name ?? c?.displayName ?? "—", ...v, share: domTotal > 0 ? (v.bal / domTotal) * 100 : 0 };
      });

    // pipeline
    const now = Date.now();
    const promised = domOpen.filter((i: any) => i.promiseDate);
    const broken   = promised.filter((i: any) => daysOverdue(i.promiseDate) > 0);
    const thisWk   = promised.filter((i: any) => { const t = +new Date(i.promiseDate); return t >= now && t <= now + 7 * 86400000; });
    const thisMo   = promised.filter((i: any) => { const t = +new Date(i.promiseDate); return t > now + 7 * 86400000 && t <= now + 30 * 86400000; });
    const sum      = (arr: any[]) => arr.reduce((s: number, i: any) => s + openBal(i), 0);

    // 30d comms
    const cut = Date.now() - 30 * 86400000;
    const emails30  = communications.filter((c: any) => c.direction === "Outbound" && c.channel === "Email" && +new Date(c.sentAt) > cut).length;
    const replies30 = communications.filter((c: any) => c.direction === "Inbound"  && +new Date(c.sentAt) > cut).length;

    return {
      dom, domTotal,
      openCount: open.length, domOpenCount: domOpen.length,
      overdueAmt, over90Amt, disputedAmt,
      overdueCount:  domAll.filter((i: any) => daysOverdue(i.dueDate) > 0 && i.txnType !== "CreditMemo").length,
      over90Count:   buckets[4].count,
      disputedCount: domOpen.filter((i: any) => i.hasOpenDispute || i.collectionStage === "Disputed").length,
      buckets, debtors, promised, broken, thisWk, thisMo,
      brokenAmt: sum(broken), wkAmt: sum(thisWk), moAmt: sum(thisMo), pipelineAmt: sum(promised),
      emails30, replies30,
    };
  }, [effective, customers, communications]);

  if (!loaded || !snapReady) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
        <Loader2 size={20} className="animate-spin" style={{ color: "#1A2744" }} />
        <span style={{ marginLeft: 10, color: "#6b7280", fontSize: 13 }}>Preparing report…</span>
      </div>
    );
  }

  const orgName  = orgSettings.displayName || orgSettings.name || "Organisation";
  const logoUrl  = orgSettings.logoUrl;
  const userName = (session?.user as any)?.name ?? "";
  const today    = fmtDate(new Date());
  const maxBucket = Math.max(...m.buckets.map(b => b.amount), 1);

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .pg { page-break-before: always; break-before: page; }
          @page { size: A4; margin: 14mm 16mm; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
        body { background: #f1f5f9; margin: 0; }
      `}</style>

      {/* Toolbar — screen only */}
      <div className="no-print" style={{ background: "#1A2744", padding: "11px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50 }}>
        <Link href="/dashboard" style={{ color: "#B38C38", display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 500, textDecoration: "none" }}>
          <ArrowLeft size={14} /> Back to Dashboard
        </Link>
        <span style={{ color: "#64748b", fontSize: 12 }}>AR Management Report · {orgName}</span>
        <button onClick={() => window.print()} style={{ background: "#B38C38", color: "#fff", border: "none", borderRadius: 6, padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
          <Printer size={14} /> Print / Save as PDF
        </button>
      </div>

      {/* ── Report pages ─────────────────────────────────────────────────── */}
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 20px 64px", fontFamily: "Arial, Helvetica, sans-serif" }}>

        {/* ════════════════════════════════════════════════════════════════
            PAGE 1 — EXECUTIVE SUMMARY
        ════════════════════════════════════════════════════════════════ */}

        {/* Letterhead */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ background: "#1A2744", borderRadius: "6px 6px 0 0", padding: "22px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              {logoUrl && <img src={logoUrl} alt="" style={{ height: 36, maxWidth: 120, objectFit: "contain" }} />}
              <div>
                <div style={{ color: "#fff", fontSize: 16, fontWeight: 700 }}>{orgName}</div>
                <div style={{ color: "#B38C38", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 2 }}>Accounts Receivable Report</div>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "#94a3b8", fontSize: 10 }}>Report Date</div>
              <div style={{ color: "#fff", fontSize: 13, fontWeight: 700, marginTop: 2 }}>{today}</div>
              {userName && <div style={{ color: "#64748b", fontSize: 10, marginTop: 2 }}>Prepared by {userName}</div>}
            </div>
          </div>
          <div style={{ background: "#B38C38", height: 3, borderRadius: "0 0 6px 6px" }} />
        </div>

        {/* KPI row — 4 boxes */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 28 }}>
          {[
            { label: "Total Receivable", value: m.domTotal,   count: m.domOpenCount, accent: "#1A2744" },
            { label: "Overdue",          value: m.overdueAmt, count: m.overdueCount, accent: "#dc2626" },
            { label: "90+ Days",         value: m.over90Amt,  count: m.over90Count,  accent: "#991b1b" },
            { label: "Disputed",         value: m.disputedAmt,count: m.disputedCount,accent: "#b45309" },
          ].map(({ label, value, count, accent }) => (
            <div key={label} style={{ background: "#fff", border: "1px solid #e2e8f0", borderTop: `4px solid ${accent}`, borderRadius: 6, padding: "16px 18px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 10 }}>{label}</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>{money(value, m.dom)}</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>{count} invoice{count !== 1 ? "s" : ""}</div>
            </div>
          ))}
        </div>

        {/* Aging summary + Pipeline side by side */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 28 }}>

          {/* Aging snapshot */}
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, overflow: "hidden" }}>
            <div style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", padding: "11px 16px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#1A2744", textTransform: "uppercase", letterSpacing: "0.06em" }}>Aging Summary</div>
            </div>
            <div style={{ padding: "4px 0" }}>
              {m.buckets.map(b => (
                <div key={b.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderBottom: "1px solid #f8fafc" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: b.color, flexShrink: 0 }} />
                  <div style={{ fontSize: 12, color: "#374151", flex: 1 }}>{b.label}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", minWidth: 80, textAlign: "right" }}>{money(b.amount, m.dom)}</div>
                  <div style={{ fontSize: 11, color: "#9ca3af", minWidth: 38, textAlign: "right" }}>{m.domTotal > 0 ? pct(b.amount / m.domTotal * 100) : "—"}</div>
                  <div style={{ width: 60, flexShrink: 0 }}>
                    <div style={{ background: "#f1f5f9", borderRadius: 2, height: 5 }}>
                      <div style={{ background: b.color, height: "100%", width: `${maxBucket > 0 ? Math.min(b.amount / maxBucket * 100, 100) : 0}%`, borderRadius: 2 }} />
                    </div>
                  </div>
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", background: "#f8fafc", borderTop: "2px solid #1A2744" }}>
                <div style={{ width: 8, flexShrink: 0 }} />
                <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", flex: 1 }}>Total</div>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#0f172a", minWidth: 80, textAlign: "right" }}>{money(m.domTotal, m.dom)}</div>
                <div style={{ fontSize: 11, color: "#9ca3af", minWidth: 38, textAlign: "right" }}>100%</div>
                <div style={{ width: 60 }} />
              </div>
            </div>
          </div>

          {/* Collection pipeline */}
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, overflow: "hidden" }}>
            <div style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", padding: "11px 16px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#1A2744", textTransform: "uppercase", letterSpacing: "0.06em" }}>Payment Pipeline</div>
            </div>
            <div style={{ padding: "4px 0" }}>
              {[
                { label: "Broken Commitments",  amt: m.brokenAmt,   count: m.broken.length,   color: "#dc2626", dot: "#dc2626" },
                { label: "Due This Week",        amt: m.wkAmt,       count: m.thisWk.length,   color: "#d97706", dot: "#d97706" },
                { label: "Due This Month",       amt: m.moAmt,       count: m.thisMo.length,   color: "#1A2744", dot: "#3b82f6" },
                { label: "Total Committed",      amt: m.pipelineAmt, count: m.promised.length, color: "#059669", dot: "#059669" },
              ].map(({ label, amt, count, color, dot }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderBottom: "1px solid #f8fafc" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0 }} />
                  <div style={{ fontSize: 12, color: "#374151", flex: 1 }}>{label}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color, textAlign: "right" }}>{money(amt, m.dom)}</div>
                  <div style={{ fontSize: 11, color: "#9ca3af", minWidth: 50, textAlign: "right" }}>{count} inv.</div>
                </div>
              ))}
              <div style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 11, color: "#64748b" }}>
                  Emails sent (30d): <strong style={{ color: "#0f172a" }}>{m.emails30}</strong>
                  &nbsp;&nbsp;·&nbsp;&nbsp;
                  Replies: <strong style={{ color: "#0f172a" }}>{m.replies30}</strong>
                  &nbsp;&nbsp;·&nbsp;&nbsp;
                  Reply rate: <strong style={{ color: "#059669" }}>{m.emails30 > 0 ? pct(m.replies30 / m.emails30 * 100) : "—"}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════════
            PAGE 2 — DEBTOR ANALYSIS
        ════════════════════════════════════════════════════════════════ */}
        <div className="pg">
          {/* Section header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "2px solid #1A2744", paddingBottom: 8, marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1A2744", textTransform: "uppercase", letterSpacing: "0.06em" }}>Debtor Analysis</div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{m.dom} · {m.debtors.length} customers with open balances · as of {today}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: "#94a3b8" }}>{orgName}</div>
              <div style={{ fontSize: 10, color: "#94a3b8" }}>{today} · Confidential</div>
            </div>
          </div>

          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <TH w={28}>#</TH>
                  <TH>Customer</TH>
                  <TH right>Open Balance</TH>
                  <TH right>Overdue</TH>
                  <TH right>% of AR</TH>
                  <TH w={110}>Concentration</TH>
                  <TH right>Last Chased</TH>
                </tr>
              </thead>
              <tbody>
                {m.debtors.map((d, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc" }}>
                    <TD light>{i + 1}</TD>
                    <TD bold>{d.name}</TD>
                    <TD right bold color="#0f172a">{money(d.bal, m.dom)}</TD>
                    <TD right bold color={d.overdue > 0 ? "#dc2626" : "#16a34a"}>{d.overdue > 0 ? money(d.overdue, m.dom) : "—"}</TD>
                    <TD right light>{pct(d.share)}</TD>
                    <td style={{ padding: "10px 14px 10px 0", width: 110 }}>
                      <div style={{ background: "#f1f5f9", borderRadius: 3, height: 6 }}>
                        <div style={{ background: d.share > 20 ? "#dc2626" : "#1A2744", height: "100%", borderRadius: 3, width: `${Math.min(d.share * 3, 100)}%` }} />
                      </div>
                    </td>
                    <TD right light>{d.last ? new Date(d.last).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}</TD>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: "#f0f4f8", borderTop: "2px solid #1A2744" }}>
                  <td />
                  <TD bold color="#0f172a">Total ({m.debtors.length} customers)</TD>
                  <TD right bold color="#0f172a">{money(m.debtors.reduce((s, d) => s + d.bal, 0), m.dom)}</TD>
                  <TD right bold color="#dc2626">{money(m.debtors.reduce((s, d) => s + d.overdue, 0), m.dom)}</TD>
                  <TD right bold color="#0f172a">100%</TD>
                  <td />
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Concentration note if top 5 > 50% */}
          {(() => {
            const top5 = m.debtors.slice(0, 5).reduce((s, d) => s + d.share, 0);
            return top5 > 50 ? (
              <div style={{ marginTop: 14, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "10px 14px", fontSize: 11, color: "#78350f" }}>
                <strong>Concentration Risk:</strong> Top 5 customers account for {pct(top5)} of total receivables. Consider reviewing credit limits and payment terms.
              </div>
            ) : null;
          })()}
        </div>

        {/* ════════════════════════════════════════════════════════════════
            PAGE 3 — PAYMENT COMMITMENTS  (only if there are any)
        ════════════════════════════════════════════════════════════════ */}
        {m.promised.length > 0 && (
          <div className="pg">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "2px solid #1A2744", paddingBottom: 8, marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#1A2744", textTransform: "uppercase", letterSpacing: "0.06em" }}>Payment Commitments</div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{m.promised.length} invoices with confirmed payment dates · {m.dom}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10, color: "#94a3b8" }}>{orgName}</div>
                <div style={{ fontSize: 10, color: "#94a3b8" }}>{today} · Confidential</div>
              </div>
            </div>

            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <TH>Customer</TH>
                    <TH>Invoice #</TH>
                    <TH right>Amount</TH>
                    <TH right>Invoice Due</TH>
                    <TH right>Payment Promised</TH>
                    <TH>Status</TH>
                  </tr>
                </thead>
                <tbody>
                  {m.promised
                    .slice()
                    .sort((a: any, b: any) => (a.promiseDate > b.promiseDate ? 1 : -1))
                    .map((inv: any, i: number) => {
                      const broken  = daysOverdue(inv.promiseDate) > 0;
                      const cust    = customers.find((x: any) => x.id === inv.customerId);
                      return (
                        <tr key={inv.id} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc" }}>
                          <TD bold>{cust?.name ?? cust?.displayName ?? "—"}</TD>
                          <TD light>{inv.invoiceNumber ?? inv.docNumber ?? "—"}</TD>
                          <TD right bold color="#0f172a">{money(openBal(inv), inv.currency)}</TD>
                          <TD right light>{inv.dueDate ? fmtShort(inv.dueDate) : "—"}</TD>
                          <TD right color={broken ? "#dc2626" : "#059669"}>{fmtShort(inv.promiseDate)}</TD>
                          <td style={{ padding: "10px 16px", borderBottom: "1px solid #f3f4f6" }}>
                            <span style={{ background: broken ? "#fef2f2" : "#f0fdf4", color: broken ? "#dc2626" : "#059669", borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>
                              {broken ? "Broken" : "Committed"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: 32, paddingTop: 12, borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between" }}>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>{orgName}</div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>Generated {today} · CONFIDENTIAL — for internal use only</div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>Accounts Receivable Report</div>
        </div>
      </div>
    </>
  );
}
