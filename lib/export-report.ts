/**
 * Excel export for all report types.
 * Pure functions — no React, no side effects.
 * Call exportArReport() or exportSalesReport() then trigger download.
 */
import * as XLSX from "xlsx";

// ─── helpers ───────────────────────────────────────────────────────────────

function isCreditMemo(inv: any): boolean {
  return inv.txnType === "CreditMemo" || String(inv.qboId || "").startsWith("CM-");
}

function daysOverdueAt(dueDate: string, asAt: Date): number {
  return Math.floor((asAt.getTime() - new Date(dueDate).getTime()) / 86400000);
}

/** Open balance of an invoice relative to a given as-at date. */
function openBalance(inv: any, asAt: Date, asAtStr: string, todayStr: string): number {
  const isHistorical = asAtStr !== todayStr;

  if (isCreditMemo(inv)) {
    const bal = Number(inv.qboBalance ?? 0);
    return bal < 0 ? bal : 0; // only unapplied credits (negative) count
  }

  if (!isHistorical && (inv.paymentStatus === "Paid" || inv.paymentStatus === "Written Off")) return 0;
  if (isHistorical && inv.paidAt && inv.paidAt <= asAtStr) return 0;

  if (isHistorical && inv.paidAt && inv.paidAt > asAtStr) {
    return Number(inv.total); // was fully outstanding on that date
  }
  return inv.qboBalance != null
    ? Number(inv.qboBalance)
    : Math.max(0, Number(inv.total || 0) - Number(inv.paid || 0));
}

type Buckets = { Current: number; "1-30": number; "31-60": number; "61-90": number; "90+": number; total: number };

function emptyBuckets(): Buckets {
  return { Current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0, total: 0 };
}

function calcBuckets(inv: any, asAt: Date, asAtStr: string, todayStr: string): Buckets {
  const b = emptyBuckets();
  const bal = openBalance(inv, asAt, asAtStr, todayStr);
  if (bal === 0) return b;

  if (isCreditMemo(inv)) {
    b.Current = bal;
    b.total   = bal;
    return b;
  }

  const days = daysOverdueAt(inv.dueDate, asAt);
  if      (days <= 0)  b.Current  = bal;
  else if (days <= 30) b["1-30"]  = bal;
  else if (days <= 60) b["31-60"] = bal;
  else if (days <= 90) b["61-90"] = bal;
  else                 b["90+"]   = bal;
  b.total = bal;
  return b;
}

function addBuckets(a: Buckets, b: Buckets): Buckets {
  return {
    Current:  a.Current  + b.Current,
    "1-30":   a["1-30"]  + b["1-30"],
    "31-60":  a["31-60"] + b["31-60"],
    "61-90":  a["61-90"] + b["61-90"],
    "90+":    a["90+"]   + b["90+"],
    total:    a.total    + b.total,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function netAmount(inv: any): number {
  const base = Math.abs(Number(inv.amount || 0));
  return isCreditMemo(inv) ? -base : base;
}

// ─── AR reports ────────────────────────────────────────────────────────────

export type ArExportInput = {
  reportId: "aging-customer" | "aging-project" | "regional" | "by-rep";
  reportLabel: string;
  orgName: string;
  asAtDate: string;
  invoices: any[];
  customers: any[];
  projects: any[];
  regions?: any[];
  reps?: any[];
  regionFilter?: string;
};

export function exportArReport(opts: ArExportInput) {
  const { reportId, reportLabel, orgName, asAtDate, invoices, customers, projects, regions, reps, regionFilter } = opts;
  const todayStr = new Date().toISOString().slice(0, 10);
  const asAt = new Date(asAtDate + "T23:59:59");

  // ── Filter invoices ────────────────────────────────────────────────────
  const filtered = invoices.filter(inv => {
    if (asAtDate < todayStr && inv.invoiceDate > asAtDate) return false;
    if (asAtDate < todayStr && inv.paidAt && inv.paidAt <= asAtDate) return false;
    if (asAtDate === todayStr && (inv.paymentStatus === "Paid" || inv.paymentStatus === "Written Off")) return false;
    if (isCreditMemo(inv) && (inv.qboBalance ?? 0) >= 0) return false;
    if (!isCreditMemo(inv)) {
      const bal = inv.qboBalance != null ? Number(inv.qboBalance) : Math.max(0, Number(inv.total || 0) - Number(inv.paid || 0));
      if (bal <= 0 && asAtDate === todayStr) return false;
    }
    // region filter
    if (regionFilter) {
      const cust = customers.find((c: any) => c.id === inv.customerId);
      const proj = projects.find((p: any) => p.id === inv.projectId);
      if (cust?.regionId !== regionFilter && proj?.regionId !== regionFilter) return false;
    }
    return true;
  });

  const wb = XLSX.utils.book_new();
  const meta = [
    ["Report:", reportLabel],
    ["Organisation:", orgName],
    ["As at:", asAtDate],
    ["Exported:", new Date().toISOString().slice(0, 19).replace("T", " ")],
    [],
  ];

  // ── Summary sheet ──────────────────────────────────────────────────────
  const BUCKET_COLS = ["Current", "1–30 days", "31–60 days", "61–90 days", "91+ days", "Total Outstanding"];

  if (reportId === "aging-customer") {
    const custMap = new Map<string, { name: string; buckets: Buckets; currencies: Set<string> }>();
    for (const inv of filtered) {
      const cust = customers.find((c: any) => c.id === inv.customerId);
      if (!cust) continue;
      if (!custMap.has(cust.id)) custMap.set(cust.id, { name: cust.name, buckets: emptyBuckets(), currencies: new Set() });
      const row = custMap.get(cust.id)!;
      row.buckets = addBuckets(row.buckets, calcBuckets(inv, asAt, asAtDate, todayStr));
      if (inv.currency) row.currencies.add(inv.currency);
    }
    const summaryRows = Array.from(custMap.values())
      .filter(r => r.buckets.total !== 0)
      .sort((a, b) => b.buckets.total - a.buckets.total);

    const headers = ["Customer", ...BUCKET_COLS, "Currency"];
    const rows = summaryRows.map(r => [
      r.name,
      round2(r.buckets.Current), round2(r.buckets["1-30"]), round2(r.buckets["31-60"]),
      round2(r.buckets["61-90"]), round2(r.buckets["90+"]), round2(r.buckets.total),
      [...r.currencies].join(" / ") || "—",
    ]);
    // Totals row
    const totBuckets = summaryRows.reduce((acc, r) => addBuckets(acc, r.buckets), emptyBuckets());
    rows.push(["TOTAL", round2(totBuckets.Current), round2(totBuckets["1-30"]), round2(totBuckets["31-60"]),
      round2(totBuckets["61-90"]), round2(totBuckets["90+"]), round2(totBuckets.total), ""]);
    appendSheet(wb, "Summary", [...meta, headers, ...rows]);
  }

  if (reportId === "aging-project") {
    const projMap = new Map<string, { name: string; customer: string; buckets: Buckets; currencies: Set<string> }>();
    for (const inv of filtered) {
      const proj = inv.projectId ? projects.find((p: any) => p.id === inv.projectId) : null;
      const cust = customers.find((c: any) => c.id === inv.customerId);
      const key = proj?.id ?? `__unassigned__${inv.customerId}`;
      const name = proj?.name ?? "— No project —";
      if (!projMap.has(key)) projMap.set(key, { name, customer: cust?.name ?? "—", buckets: emptyBuckets(), currencies: new Set() });
      const row = projMap.get(key)!;
      row.buckets = addBuckets(row.buckets, calcBuckets(inv, asAt, asAtDate, todayStr));
      if (inv.currency) row.currencies.add(inv.currency);
    }
    const summaryRows = Array.from(projMap.values()).filter(r => r.buckets.total !== 0).sort((a, b) => b.buckets.total - a.buckets.total);
    const headers = ["Project", "Customer", ...BUCKET_COLS, "Currency"];
    const rows = summaryRows.map(r => [
      r.name, r.customer,
      round2(r.buckets.Current), round2(r.buckets["1-30"]), round2(r.buckets["31-60"]),
      round2(r.buckets["61-90"]), round2(r.buckets["90+"]), round2(r.buckets.total),
      [...r.currencies].join(" / ") || "—",
    ]);
    const totBuckets = summaryRows.reduce((acc, r) => addBuckets(acc, r.buckets), emptyBuckets());
    rows.push(["TOTAL", "", round2(totBuckets.Current), round2(totBuckets["1-30"]), round2(totBuckets["31-60"]),
      round2(totBuckets["61-90"]), round2(totBuckets["90+"]), round2(totBuckets.total), ""]);
    appendSheet(wb, "Summary", [...meta, headers, ...rows]);
  }

  if (reportId === "regional") {
    const regionMap = new Map<string, { name: string; customers: Set<string>; invCount: number; buckets: Buckets; currencies: Set<string> }>();
    for (const inv of filtered) {
      const cust = customers.find((c: any) => c.id === inv.customerId);
      const proj = projects.find((p: any) => p.id === inv.projectId);
      const regId = cust?.regionId || proj?.regionId || null;
      const regName = (regions ?? []).find((r: any) => r.id === regId)?.name || "Other";
      if (!regionMap.has(regName)) regionMap.set(regName, { name: regName, customers: new Set(), invCount: 0, buckets: emptyBuckets(), currencies: new Set() });
      const row = regionMap.get(regName)!;
      row.customers.add(inv.customerId);
      row.invCount++;
      row.buckets = addBuckets(row.buckets, calcBuckets(inv, asAt, asAtDate, todayStr));
      if (inv.currency) row.currencies.add(inv.currency);
    }
    const summaryRows = Array.from(regionMap.values()).filter(r => r.buckets.total !== 0).sort((a, b) => b.buckets.total - a.buckets.total);
    const grandTotal = summaryRows.reduce((acc, r) => acc + r.buckets.total, 0);
    const headers = ["Region", "Customers", "Invoices", ...BUCKET_COLS, "% of Total", "Currency"];
    const rows = summaryRows.map(r => [
      r.name, r.customers.size, r.invCount,
      round2(r.buckets.Current), round2(r.buckets["1-30"]), round2(r.buckets["31-60"]),
      round2(r.buckets["61-90"]), round2(r.buckets["90+"]), round2(r.buckets.total),
      grandTotal > 0 ? `${(r.buckets.total / grandTotal * 100).toFixed(1)}%` : "—",
      [...r.currencies].join(" / ") || "—",
    ]);
    const totBuckets = summaryRows.reduce((acc, r) => addBuckets(acc, r.buckets), emptyBuckets());
    rows.push(["TOTAL",
      new Set(summaryRows.flatMap(r => [...r.customers])).size,
      summaryRows.reduce((s, r) => s + r.invCount, 0),
      round2(totBuckets.Current), round2(totBuckets["1-30"]), round2(totBuckets["31-60"]),
      round2(totBuckets["61-90"]), round2(totBuckets["90+"]), round2(totBuckets.total), "100%", ""]);
    appendSheet(wb, "Summary", [...meta, headers, ...rows]);
  }

  if (reportId === "by-rep") {
    const repMap = new Map<string, { name: string; customers: Set<string>; invCount: number; buckets: Buckets; currencies: Set<string> }>();
    for (const inv of filtered) {
      const cust = customers.find((c: any) => c.id === inv.customerId);
      const proj = projects.find((p: any) => p.id === inv.projectId);
      const repId = cust?.repId || proj?.repId || "unassigned";
      const rep = (reps ?? []).find((r: any) => r.id === repId);
      const repName = rep?.name || "Unassigned";
      if (!repMap.has(repId)) repMap.set(repId, { name: repName, customers: new Set(), invCount: 0, buckets: emptyBuckets(), currencies: new Set() });
      const row = repMap.get(repId)!;
      row.customers.add(inv.customerId);
      row.invCount++;
      row.buckets = addBuckets(row.buckets, calcBuckets(inv, asAt, asAtDate, todayStr));
      if (inv.currency) row.currencies.add(inv.currency);
    }
    const summaryRows = Array.from(repMap.values()).filter(r => r.buckets.total !== 0).sort((a, b) => b.buckets.total - a.buckets.total);
    const grandTotal = summaryRows.reduce((acc, r) => acc + r.buckets.total, 0);
    const headers = ["Rep", "Customers", "Invoices", ...BUCKET_COLS, "% of Total", "Currency"];
    const rows = summaryRows.map(r => [
      r.name, r.customers.size, r.invCount,
      round2(r.buckets.Current), round2(r.buckets["1-30"]), round2(r.buckets["31-60"]),
      round2(r.buckets["61-90"]), round2(r.buckets["90+"]), round2(r.buckets.total),
      grandTotal > 0 ? `${(r.buckets.total / grandTotal * 100).toFixed(1)}%` : "—",
      [...r.currencies].join(" / ") || "—",
    ]);
    const totBuckets = summaryRows.reduce((acc, r) => addBuckets(acc, r.buckets), emptyBuckets());
    rows.push(["TOTAL",
      new Set(summaryRows.flatMap(r => [...r.customers])).size,
      summaryRows.reduce((s, r) => s + r.invCount, 0),
      round2(totBuckets.Current), round2(totBuckets["1-30"]), round2(totBuckets["31-60"]),
      round2(totBuckets["61-90"]), round2(totBuckets["90+"]), round2(totBuckets.total), "100%", ""]);
    appendSheet(wb, "Summary", [...meta, headers, ...rows]);
  }

  // ── Invoice Detail sheet (common to all AR reports) ────────────────────
  const detailHeaders = [
    "Invoice #", "Customer", "Project", "Invoice Date", "Due Date",
    "Currency", "Current", "1–30 days", "31–60 days", "61–90 days", "91+ days",
    "Outstanding", "Collection Stage", "Type",
  ];
  const detailRows = filtered
    .map(inv => {
      const b = calcBuckets(inv, asAt, asAtDate, todayStr);
      if (b.total === 0) return null;
      const cust = customers.find((c: any) => c.id === inv.customerId);
      const proj = projects.find((p: any) => p.id === inv.projectId);
      return [
        inv.invoiceNumber, cust?.name ?? "—", proj?.name ?? "—",
        inv.invoiceDate, inv.dueDate,
        inv.currency || "EUR",
        round2(b.Current), round2(b["1-30"]), round2(b["31-60"]),
        round2(b["61-90"]), round2(b["90+"]), round2(b.total),
        inv.collectionStage ?? "—",
        isCreditMemo(inv) ? "Credit Note" : "Invoice",
      ];
    })
    .filter(Boolean)
    .sort((a: any, b: any) => (b[11] as number) - (a[11] as number)); // sort by outstanding desc
  appendSheet(wb, "Invoice Detail", [...meta, detailHeaders, ...detailRows as any[][]]);

  // ── Trigger download ───────────────────────────────────────────────────
  const filename = `${reportLabel.replace(/\s+/g, "-")}_${asAtDate}.xlsx`;
  XLSX.writeFile(wb, filename);
}

// ─── Sales reports ─────────────────────────────────────────────────────────

export type SalesExportInput = {
  reportId: string;
  reportLabel: string;
  orgName: string;
  periodLabel: string;
  periodFrom: string;
  periodTo: string;
  invoices: any[];
  customers: any[];
  projects: any[];
  regions?: any[];
  reps?: any[];
  breakdown: "customer" | "project" | "rep" | "region";
};

export function exportSalesReport(opts: SalesExportInput) {
  const { reportId, reportLabel, orgName, periodLabel, periodFrom, periodTo, invoices, customers, projects, regions, reps, breakdown } = opts;
  const wb = XLSX.utils.book_new();

  const from = new Date(periodFrom + "T00:00:00");
  const to   = new Date(periodTo   + "T23:59:59");

  const meta = [
    ["Report:", reportLabel],
    ["Organisation:", orgName],
    ["Period:", `${periodLabel} (${periodFrom} – ${periodTo})`],
    ["Exported:", new Date().toISOString().slice(0, 19).replace("T", " ")],
    [],
  ];

  const periodItems = invoices.filter((i: any) => {
    const d = new Date(i.invoiceDate);
    return d >= from && d <= to;
  });

  // ── Breakdown sheet ────────────────────────────────────────────────────
  type BdRow = { label: string; gross: number; cnAdj: number; net: number; invCount: number; cnCount: number; currency: Set<string> };
  const bdMap = new Map<string, BdRow>();
  for (const inv of periodItems) {
    let key = "", label = "";
    if (breakdown === "customer") {
      const c = customers.find((c: any) => c.id === inv.customerId);
      key = inv.customerId || "unknown"; label = c?.name || "Unknown";
    } else if (breakdown === "project") {
      const p = projects.find((p: any) => p.id === inv.projectId);
      key = inv.projectId || "no-project"; label = p?.name || "No Project";
    } else if (breakdown === "rep") {
      const c = customers.find((c: any) => c.id === inv.customerId);
      const p = projects.find((p: any) => p.id === inv.projectId);
      const repId = c?.repId || p?.repId || "unassigned";
      const rep = (reps ?? []).find((r: any) => r.id === repId);
      key = repId; label = rep?.name || "Unassigned";
    } else {
      const c = customers.find((c: any) => c.id === inv.customerId);
      const p = projects.find((p: any) => p.id === inv.projectId);
      const regId = c?.regionId || p?.regionId || "none";
      const reg = (regions ?? []).find((r: any) => r.id === regId);
      key = regId; label = reg?.name || "No Region";
    }
    if (!bdMap.has(key)) bdMap.set(key, { label, gross: 0, cnAdj: 0, net: 0, invCount: 0, cnCount: 0, currency: new Set() });
    const row = bdMap.get(key)!;
    const amt = netAmount(inv);
    row.net += amt;
    if (inv.currency) row.currency.add(inv.currency);
    if (isCreditMemo(inv)) { row.cnAdj += amt; row.cnCount++; }
    else { row.gross += amt; row.invCount++; }
  }
  const bdRows = Array.from(bdMap.values()).sort((a, b) => b.net - a.net);
  const totalNet = bdRows.reduce((s, r) => s + r.net, 0);
  const bdHeaders = [
    breakdown.charAt(0).toUpperCase() + breakdown.slice(1),
    "Gross Revenue", "Credit Note Adj.", "Net Revenue",
    "Invoices", "Credit Notes", "Avg Invoice", "% of Total", "Currency",
  ];
  const bdData = bdRows.map(r => [
    r.label,
    round2(r.gross), round2(Math.abs(r.cnAdj)), round2(r.net),
    r.invCount, r.cnCount,
    r.invCount > 0 ? round2(r.gross / r.invCount) : 0,
    totalNet > 0 ? `${(r.net / totalNet * 100).toFixed(1)}%` : "—",
    [...r.currency].join(" / ") || "—",
  ]);
  const totRow = [
    "TOTAL",
    round2(bdRows.reduce((s, r) => s + r.gross, 0)),
    round2(Math.abs(bdRows.reduce((s, r) => s + r.cnAdj, 0))),
    round2(totalNet),
    bdRows.reduce((s, r) => s + r.invCount, 0),
    bdRows.reduce((s, r) => s + r.cnCount, 0),
    "", "100%", "",
  ];
  appendSheet(wb, "Breakdown", [...meta, bdHeaders, ...bdData, totRow]);

  // ── Monthly trend sheet ────────────────────────────────────────────────
  const now = new Date();
  const trendHeaders = ["Month", "This Year", "Prior Year", "YoY Change", "YoY %"];
  const trendData: any[][] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const pd = new Date(now.getFullYear() - 1, now.getMonth() - i, 1);
    const priorKey = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, "0")}`;
    const net   = invoices.filter((inv: any) => inv.invoiceDate?.slice(0, 7) === key).reduce((s: number, inv: any) => s + netAmount(inv), 0);
    const prior = invoices.filter((inv: any) => inv.invoiceDate?.slice(0, 7) === priorKey).reduce((s: number, inv: any) => s + netAmount(inv), 0);
    const change = net - prior;
    const changePct = prior > 0 ? (change / prior * 100) : null;
    trendData.push([
      d.toLocaleString("default", { month: "short", year: "numeric" }),
      round2(net), round2(prior), round2(change),
      changePct !== null ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%` : "—",
    ]);
  }
  appendSheet(wb, "Monthly Trend", [...meta, trendHeaders, ...trendData]);

  // ── Invoice list sheet ─────────────────────────────────────────────────
  const invHeaders = [
    "Invoice #", "Customer", "Project", "Invoice Date", "Due Date", "Currency",
    "Gross Amount", "Type", "Payment Status",
  ];
  const invData = periodItems.map((inv: any) => {
    const cust = customers.find((c: any) => c.id === inv.customerId);
    const proj = projects.find((p: any) => p.id === inv.projectId);
    return [
      inv.invoiceNumber, cust?.name ?? "—", proj?.name ?? "—",
      inv.invoiceDate, inv.dueDate, inv.currency || "EUR",
      round2(Math.abs(inv.amount || 0)),
      isCreditMemo(inv) ? "Credit Note" : "Invoice",
      inv.paymentStatus ?? "—",
    ];
  }).sort((a: any, b: any) => (String(b[3]) > String(a[3]) ? 1 : -1));
  appendSheet(wb, "Invoice List", [...meta, invHeaders, ...invData]);

  const filename = `${reportLabel.replace(/\s+/g, "-")}_${periodFrom}_${periodTo}.xlsx`;
  XLSX.writeFile(wb, filename);
}

// ─── Chase report (Collections Board) ──────────────────────────────────────

export type ChaseExportInput = {
  orgName: string;
  /** Board rows currently visible (already filtered/sorted by the user). */
  rows: {
    inv: any; custName: string; projName: string | null; regionName: string | null;
    repName: string | null; stageLabel: string; bal: number; days: number;
    email: string | null; lastSent: string | null; lastRef: string | null;
  }[];
  /** All communications (any invoice) — used for chase counts and last comments. */
  comments: any[];
};

/**
 * Management chase report — replaces the old manual A/R Ageing + Owner/Action
 * spreadsheet. Sheet 1 is a pure flat table (headers on row 1, one row per
 * invoice) so Excel pivot tables work directly on it. Sheet 2 is an
 * owner-level summary; sheet 3 holds report metadata.
 */
export function exportChaseReport({ orgName, rows, comments }: ChaseExportInput) {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  const bucketOf = (days: number) =>
    days <= 0 ? "Current" : days <= 30 ? "1–30" : days <= 60 ? "31–60" : days <= 90 ? "61–90" : "91+";

  // Index communications by invoice once.
  const CHASE_CHANNELS = new Set(["Email", "Chase"]);
  const COMMENT_CHANNELS = new Set(["Note", "Portal", "Dispute", "Promise", "Email", "Chase"]);
  const chaseCount = new Map<string, number>();
  const lastComment = new Map<string, any>();
  for (const c of comments) {
    if (!c.invoiceId || c.isDraft) continue;
    if (c.direction === "Outbound" && CHASE_CHANNELS.has(c.channel)) {
      chaseCount.set(c.invoiceId, (chaseCount.get(c.invoiceId) ?? 0) + 1);
    }
    if (COMMENT_CHANNELS.has(c.channel) && c.body) {
      const prev = lastComment.get(c.invoiceId);
      const ts = new Date(c.sentAt ?? c.createdAt).getTime();
      if (!prev || ts > new Date(prev.sentAt ?? prev.createdAt).getTime()) lastComment.set(c.invoiceId, c);
    }
  }

  // ── Sheet 1: flat pivot-ready detail ────────────────────────────────────
  const headers = [
    "Invoice #", "Customer", "Project", "Region", "Rep",
    "Invoice Date", "Due Date", "Days Overdue", "Aging Bucket",
    "Currency", "Invoice Total", "Paid", "Outstanding", "% Unpaid",
    "Stage", "Owner", "Owner Email",
    "Response", "Promise Date",
    "Last Chased", "Days Since Chase", "Chase Count", "Last Ref",
    "Last Comment", "Comment By", "Comment Date",
  ];

  const detail = rows.map(r => {
    const inv = r.inv;
    const total = Number(inv.total || 0);
    const pctUnpaid = total > 0 ? round2((r.bal / total) * 100) : 100;
    const owner = inv.collectionStage === "Escalated" && inv.escalatedToName ? inv.escalatedToName : "Accounts";
    const ownerEmail = inv.collectionStage === "Escalated" ? (inv.escalatedToEmail ?? "") : "";
    const response = inv.hasOpenDispute
      ? `Disputed${inv.disputeReason ? ": " + inv.disputeReason : ""}`
      : inv.promiseDate ? "Committed" : "";
    const lastSentIso = r.lastSent ? r.lastSent.slice(0, 10) : "";
    const daysSinceChase = lastSentIso
      ? Math.floor((today.getTime() - new Date(lastSentIso).getTime()) / 86400000)
      : "";
    const cm = lastComment.get(inv.id);
    return [
      inv.invoiceNumber, r.custName, r.projName ?? "", r.regionName ?? "", r.repName ?? "",
      inv.invoiceDate ?? "", inv.dueDate ?? "", Math.max(0, r.days), bucketOf(r.days),
      inv.currency || "EUR", round2(total), round2(Math.max(0, total - r.bal)), round2(r.bal), pctUnpaid,
      r.stageLabel, owner, ownerEmail,
      response, inv.promiseDate ?? "",
      lastSentIso, daysSinceChase, chaseCount.get(inv.id) ?? 0, r.lastRef ?? "",
      cm ? String(cm.body).slice(0, 500) : "", cm ? (cm.sender ?? "") : "", cm ? new Date(cm.sentAt ?? cm.createdAt).toISOString().slice(0, 10) : "",
    ];
  });
  const wb = XLSX.utils.book_new();
  appendSheet(wb, "Chase Report", [headers, ...detail]);

  // ── Sheet 2: summary by owner ───────────────────────────────────────────
  type OwnerRow = { count: number; buckets: Buckets };
  const byOwner = new Map<string, OwnerRow>();
  rows.forEach(r => {
    const owner = r.inv.collectionStage === "Escalated" && r.inv.escalatedToName ? r.inv.escalatedToName : "Accounts";
    if (!byOwner.has(owner)) byOwner.set(owner, { count: 0, buckets: emptyBuckets() });
    const o = byOwner.get(owner)!;
    o.count++;
    const b = emptyBuckets();
    const key = r.days <= 0 ? "Current" : r.days <= 30 ? "1-30" : r.days <= 60 ? "31-60" : r.days <= 90 ? "61-90" : "90+";
    (b as any)[key] = r.bal; b.total = r.bal;
    o.buckets = addBuckets(o.buckets, b);
  });
  const ownerRows = [...byOwner.entries()].sort((a, b) => b[1].buckets.total - a[1].buckets.total);
  const grand = ownerRows.reduce((acc, [, o]) => addBuckets(acc, o.buckets), emptyBuckets());
  appendSheet(wb, "Summary by Owner", [
    ["Report:", "Collections Chase Report"],
    ["Organisation:", orgName],
    ["As at:", todayIso],
    ["Invoices:", rows.length],
    [],
    ["Owner", "Invoices", "Current", "1–30 days", "31–60 days", "61–90 days", "91+ days", "Total Outstanding", "% of Total"],
    ...ownerRows.map(([name, o]) => [
      name, o.count,
      round2(o.buckets.Current), round2(o.buckets["1-30"]), round2(o.buckets["31-60"]),
      round2(o.buckets["61-90"]), round2(o.buckets["90+"]), round2(o.buckets.total),
      grand.total > 0 ? `${(o.buckets.total / grand.total * 100).toFixed(1)}%` : "—",
    ]),
    ["TOTAL", rows.length,
      round2(grand.Current), round2(grand["1-30"]), round2(grand["31-60"]),
      round2(grand["61-90"]), round2(grand["90+"]), round2(grand.total), "100%"],
  ]);

  XLSX.writeFile(wb, `Chase-Report_${todayIso}.xlsx`);
}

// ─── A/R Ageing & Chase report (Collections Board) ─────────────────────────

export type AgeingChaseInput = {
  orgName: string;
  rows: {
    inv: any; custName: string; projName: string | null;
    bal: number; days: number; lastSent: string | null; lastRef: string | null; stageLabel: string;
  }[];
  comments: any[];
};

/**
 * A/R Ageing & Chase — the management report firms circulate, styled to match
 * the QuickBooks "A/R Ageing Summary" layout: centred title block, grouped
 * Customer → Project, aged into buckets with a bold per-customer subtotal
 * (ruled above) and a grand total, plus a Status column from the stage
 * (escalation status when escalated, else the normal chase stage), the last
 * email reference, and the chase count. Stays an editable workbook so reps can
 * type into the RC Comments column.
 *
 * Uses exceljs (dynamically imported so it never weighs down the app bundle)
 * because it supports the cell styling — bold, borders, currency number
 * formats, merges — that the QBO look needs and SheetJS's free build can't do.
 */
export async function exportAgeingChaseReport({ orgName, rows, comments }: AgeingChaseInput) {
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const asOf = `${now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`.replace(/(\w+) (\d{4})$/, "$1, $2");
  const rcDate = now.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit" });

  // Latest account comment (invoiceId null, channel Note), indexed at both the
  // project level and the customer level. A project row shows its project
  // comment, falling back to the customer-level comment when it has none.
  const projComment = new Map<string, { body: string; at: number }>();
  const custComment = new Map<string, { body: string; at: number }>();
  for (const c of comments) {
    if (c.invoiceId || c.isDraft || !c.body) continue;
    if (c.channel !== "Note" && c.channel !== "ProjectNote") continue;
    const at = new Date(c.sentAt ?? c.createdAt ?? 0).getTime();
    if (c.projectId) {
      const prev = projComment.get(c.projectId);
      if (!prev || at > prev.at) projComment.set(c.projectId, { body: String(c.body), at });
    } else if (c.customerId && c.matchedBy === "CustomerNote") {
      const prev = custComment.get(c.customerId);
      if (!prev || at > prev.at) custComment.set(c.customerId, { body: String(c.body), at });
    }
  }
  const commentFor = (prjRows: AgeingChaseInput["rows"]) => {
    const pid = prjRows.find(r => r.inv.projectId)?.inv.projectId;
    if (pid && projComment.has(pid)) return projComment.get(pid)!.body;
    const cid = prjRows.find(r => r.inv.customerId)?.inv.customerId;
    return cid ? (custComment.get(cid)?.body ?? "") : "";
  };

  const bucketOf = (days: number) => days <= 0 ? "Current" : days <= 30 ? "1-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";

  // Status (Column H): escalation status when escalated, else the normal chase stage.
  const projectStatus = (prjRows: AgeingChaseInput["rows"]): string => {
    if (prjRows.some(r => r.inv.hasOpenDispute)) return "Disputed";
    const esc = prjRows.find(r => r.stageLabel === "Escalated" && r.inv.escalatedToName);
    if (esc) return `Escalated: ${esc.inv.escalationType || "Handed over"}${esc.inv.escalatedToName ? " → " + esc.inv.escalatedToName : ""}`;
    if (prjRows.some(r => r.inv.promiseDate && r.inv.promiseDate < todayIso)) return "Broken commitment";
    const committed = prjRows.filter(r => r.inv.promiseDate && r.inv.promiseDate >= todayIso);
    if (committed.length) return `Awaiting payment ${committed.map(r => r.inv.promiseDate).sort()[0]}`;
    if (prjRows.some(r => r.days > 0)) return [...prjRows].sort((a, b) => b.days - a.days)[0].stageLabel || "Chasing";
    return "N/A";
  };

  // Group Customer → Project.
  type Prj = { name: string; rows: AgeingChaseInput["rows"] };
  const byCust = new Map<string, { name: string; projects: Map<string, Prj> }>();
  for (const r of rows) {
    const cKey = r.custName || "—";
    if (!byCust.has(cKey)) byCust.set(cKey, { name: cKey, projects: new Map() });
    const cg = byCust.get(cKey)!;
    const pKey = r.projName || "— No project —";
    if (!cg.projects.has(pKey)) cg.projects.set(pKey, { name: pKey, rows: [] });
    cg.projects.get(pKey)!.rows.push(r);
  }

  const bucketsFor = (prjRows: AgeingChaseInput["rows"]) => {
    const b: Record<string, number> = { Current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0, total: 0 };
    for (const r of prjRows) { b[bucketOf(r.days)] += r.bal; b.total += r.bal; }
    return b;
  };
  const customers = [...byCust.values()].sort((a, b) =>
    bucketsFor([...b.projects.values()].flatMap(p => p.rows)).total -
    bucketsFor([...a.projects.values()].flatMap(p => p.rows)).total);

  // ── Build the styled workbook (exceljs) ──────────────────────────────────
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("AR Ageing & Chase", { views: [{ state: "frozen", ySplit: 5 }] });

  const FONT = "Calibri";                        // crisp, standard Excel face
  const PLAIN = '#,##0.00;-#,##0.00';            // detail amounts — no symbol
  const EURO  = '"€"#,##0.00;-"€"#,##0.00';       // totals — with € symbol
  const AMOUNT_COLS = [2, 3, 4, 5, 6, 7];         // B..G
  const wLen = new Array(11).fill(0);             // widest content seen per column
  const track = (r: any) => r.eachCell({ includeEmpty: false }, (c: any, col: number) => {
    const len = String(c.value ?? "").length;
    if (len > wLen[col]) wLen[col] = len;
  });

  const title = (text: string, size: number, bold: boolean) => {
    const r = ws.addRow([text]);
    ws.mergeCells(r.number, 1, r.number, 9);
    r.getCell(1).font = { name: FONT, bold, size };
    r.getCell(1).alignment = { horizontal: "center" };
    return r;
  };
  title(orgName, 14, true);
  title("A/R Ageing Summary Report", 11, true);
  title(`As of ${asOf}`, 10, false);
  ws.addRow([]);

  // Header row (row 5 — frozen). H = Action (stage), I = Comments (project-level).
  const hdr = ws.addRow(["", "CURRENT", "1 - 30", "31 - 60", "61 - 90", "91 AND OVER", "Total", "Action", "Comments"]);
  hdr.eachCell((c, col) => {
    c.font = { name: FONT, bold: true };
    c.border = { bottom: { style: "thin" } };
    c.alignment = { horizontal: AMOUNT_COLS.includes(col) ? "right" : "left" };
  });
  track(hdr);

  const grand: Record<string, number> = { Current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0, total: 0 };

  for (const cg of customers) {
    // Customer group header (label only)
    const cr = ws.addRow([cg.name]);
    cr.getCell(1).font = { name: FONT, bold: false };
    track(cr);

    const cust: Record<string, number> = { Current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0, total: 0 };
    const projects = [...cg.projects.values()].sort((a, b) => bucketsFor(b.rows).total - bucketsFor(a.rows).total);

    for (const pg of projects) {
      const b = bucketsFor(pg.rows);
      (Object.keys(cust) as string[]).forEach(k => { cust[k] += b[k]; grand[k] += b[k]; });
      // Detail: blank cells for empty buckets, plain number format (no €).
      const cell = (v: number) => (Math.abs(v) < 0.005 ? null : round2(v));
      const row = ws.addRow([
        pg.name,
        cell(b.Current), cell(b["1-30"]), cell(b["31-60"]), cell(b["61-90"]), cell(b["90+"]), round2(b.total),
        projectStatus(pg.rows), commentFor(pg.rows),
      ]);
      row.getCell(1).alignment = { indent: 2 };
      row.getCell(9).alignment = { wrapText: true, vertical: "top" };  // Comments can be long
      row.eachCell({ includeEmpty: false }, c => (c.font = { name: FONT, size: 11 }));
      AMOUNT_COLS.forEach(col => (row.getCell(col).numFmt = PLAIN));
      // Track width using the indented label + a couple of chars for indent.
      wLen[1] = Math.max(wLen[1], pg.name.length + 3);
      track(row);
    }

    // Customer total — bold, € format (shows €0.00 for empty), ruled above.
    const tr = ws.addRow([
      `Total for ${cg.name}`,
      round2(cust.Current), round2(cust["1-30"]), round2(cust["31-60"]), round2(cust["61-90"]), round2(cust["90+"]), round2(cust.total),
    ]);
    tr.font = { name: FONT, bold: true };
    tr.eachCell({ includeEmpty: false }, c => (c.font = { name: FONT, bold: true }));
    AMOUNT_COLS.forEach(col => { tr.getCell(col).numFmt = EURO; tr.getCell(col).border = { top: { style: "thin" } }; });
    tr.getCell(1).border = { top: { style: "thin" } };
    track(tr);
    ws.addRow([]);
  }

  // Grand total — bold, double rule above.
  const gr = ws.addRow([
    "GRAND TOTAL",
    round2(grand.Current), round2(grand["1-30"]), round2(grand["31-60"]), round2(grand["61-90"]), round2(grand["90+"]), round2(grand.total),
  ]);
  gr.eachCell({ includeEmpty: false }, c => (c.font = { name: FONT, bold: true, size: 11 }));
  gr.getCell(1).border = { top: { style: "double" } };
  AMOUNT_COLS.forEach(col => { gr.getCell(col).numFmt = EURO; gr.getCell(col).border = { top: { style: "double" } }; });
  track(gr);

  // Auto-fit column widths to content (title rows excluded from col A so the
  // merged company name doesn't blow the width out).
  const MIN = [16, 12, 12, 12, 12, 13, 14, 22, 30];
  const MAX = [52, 16, 16, 16, 16, 16, 18, 34, 48];  // Comments column allowed wider
  ws.columns.forEach((col, i) => {
    const n = i + 1;
    col.width = Math.min(Math.max((wLen[n] || 0) + 2, MIN[i] ?? 10), MAX[i] ?? 52);
  });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `AR-Ageing-Chase_${todayIso}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Comment update template (bulk import) ────────────────────────────────

export type CommentTemplateInput = {
  orgName: string;
  rows: { custId: string; custName: string; projName: string | null; inv: any }[];
  comments: any[];
};

/**
 * Downloadable template for logging Customer / Project comments in bulk — the
 * spreadsheet folks already mark up in review meetings. Pre-filled with one row
 * per customer (account-level) and one per project that has open invoices, so
 * they only type the Comment. Hidden customerId/projectId columns let the
 * importer match rows back EXACTLY (never by fuzzy name). The Comment cell is
 * left blank — comments are append-only history — with the last logged comment
 * attached as a cell note for reference.
 */
export async function exportCommentTemplate({ orgName, rows, comments }: CommentTemplateInput) {
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);

  // Latest existing comment (hint) per project and per customer.
  const projHint = new Map<string, { body: string; at: number }>();
  const custHint = new Map<string, { body: string; at: number }>();
  for (const c of comments) {
    if (c.invoiceId || c.isDraft || !c.body) continue;
    if (c.channel !== "Note" && c.channel !== "ProjectNote") continue;
    const at = new Date(c.sentAt ?? c.createdAt ?? 0).getTime();
    if (c.projectId) {
      const p = projHint.get(c.projectId); if (!p || at > p.at) projHint.set(c.projectId, { body: String(c.body), at });
    } else if (c.customerId && c.matchedBy === "CustomerNote") {
      const p = custHint.get(c.customerId); if (!p || at > p.at) custHint.set(c.customerId, { body: String(c.body), at });
    }
  }

  // Build customer → projects (only where invoices are open).
  type Cust = { id: string; name: string; projects: Map<string, string> };
  const custs = new Map<string, Cust>();
  for (const r of rows) {
    if (!custs.has(r.custId)) custs.set(r.custId, { id: r.custId, name: r.custName || "—", projects: new Map() });
    const pid = r.inv?.projectId as string | null | undefined;
    if (pid) custs.get(r.custId)!.projects.set(pid, r.projName || "Project");
  }
  const ordered = [...custs.values()].sort((a, b) => a.name.localeCompare(b.name));

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Comments", { views: [{ state: "frozen", ySplit: 3 }] });
  const FONT = "Calibri";

  // Title + instruction rows.
  const t = ws.addRow([`${orgName} — Comment update template`]);
  ws.mergeCells(t.number, 1, t.number, 4);
  t.getCell(1).font = { name: FONT, bold: true, size: 13 };
  const g = ws.addRow(["Type your comment in column D against each Customer / Project, then upload this file. Blank rows are ignored. Leave the date blank to use today. Don't edit columns E–F."]);
  ws.mergeCells(g.number, 1, g.number, 4);
  g.getCell(1).font = { name: FONT, italic: true, size: 9, color: { argb: "FF888888" } };

  // Header.
  const head = ws.addRow(["Date of comment", "Customer", "Project", "Comment", "customerId", "projectId"]);
  head.eachCell((c: any) => { c.font = { name: FONT, bold: true }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F0F0" } }; c.border = { bottom: { style: "thin" } }; });

  const addLine = (customer: Cust, projectId: string | null, projName: string, hint?: string) => {
    const row = ws.addRow(["", customer.name, projName, "", customer.id, projectId ?? ""]);
    row.eachCell({ includeEmpty: true }, (c: any) => (c.font = { name: FONT }));
    row.getCell(1).numFmt = "dd/mm/yyyy";
    if (hint) row.getCell(4).note = `Last comment: ${hint}`;
    // Visually mark the account-level row.
    if (!projectId) { row.getCell(3).value = "(all — account level)"; row.getCell(3).font = { name: FONT, italic: true, color: { argb: "FF999999" } }; }
  };

  for (const c of ordered) {
    addLine(c, null, "(all — account level)", custHint.get(c.id)?.body);
    [...c.projects.entries()].sort((a, b) => a[1].localeCompare(b[1])).forEach(([pid, pname]) => addLine(c, pid, pname, projHint.get(pid)?.body));
  }

  ws.columns.forEach((col: any, i: number) => { col.width = [16, 30, 30, 60, 38, 38][i] ?? 16; });
  ws.getColumn(5).hidden = true; // customerId
  ws.getColumn(6).hidden = true; // projectId

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Comment-template_${todayIso}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Statement of account (Collections Board) ─────────────────────────────

export type StatementExportInput = {
  orgName: string;
  /** Selected/visible board rows. */
  rows: { inv: any; custName: string; projName: string | null; bal: number; days: number }[];
};

/** Format a per-currency total map as "€1,234.00 · $500.00". */
function fmtCcyMap(map: Record<string, number>): string {
  const parts = Object.entries(map).filter(([, v]) => Math.abs(v) > 0.005).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  if (parts.length === 0) return num2(0);
  return parts.map(([c, v]) => `${c} ${num2(v)}`).join(" · ");
}
function num2(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Statement of account — one document, grouped Customer → Project, with a
 * subtotal at each level and a grand total. Built for handing to a customer
 * or attaching to a chase: invoices are listed chronologically (oldest due
 * first) within each project, exactly how a statement reads.
 */
export function exportStatement({ orgName, rows }: StatementExportInput) {
  const todayIso = new Date().toISOString().slice(0, 10);

  // Group Customer → Project, preserving each invoice.
  type Grp = { total: Record<string, number>; rows: typeof rows };
  const byCust = new Map<string, { total: Record<string, number>; projects: Map<string, Grp> }>();
  for (const r of rows) {
    const ccy = r.inv.currency || "EUR";
    const cKey = r.custName || "—";
    if (!byCust.has(cKey)) byCust.set(cKey, { total: {}, projects: new Map() });
    const cg = byCust.get(cKey)!;
    cg.total[ccy] = (cg.total[ccy] ?? 0) + r.bal;
    const pKey = r.projName || "No project";
    if (!cg.projects.has(pKey)) cg.projects.set(pKey, { total: {}, rows: [] });
    const pg = cg.projects.get(pKey)!;
    pg.total[ccy] = (pg.total[ccy] ?? 0) + r.bal;
    pg.rows.push(r);
  }

  const custTotalNum = (t: Record<string, number>) => Object.values(t).reduce((s, v) => s + v, 0);
  const customers = [...byCust.entries()].sort((a, b) => custTotalNum(b[1].total) - custTotalNum(a[1].total));

  const grand: Record<string, number> = {};
  rows.forEach(r => { const c = r.inv.currency || "EUR"; grand[c] = (grand[c] ?? 0) + r.bal; });

  const COLS = ["Customer / Project / Invoice", "Invoice Date", "Due Date", "Days Overdue", "Currency", "Invoice Total", "Paid", "Outstanding"];

  const data: any[][] = [
    [orgName],
    ["Statement of Open Invoices"],
    ["Generated:", todayIso, "", "Invoices:", rows.length, "", "Total outstanding:", fmtCcyMap(grand)],
    [],
    COLS,
  ];

  for (const [custName, cg] of customers) {
    // Heading rows are labels only — amounts live on the subtotal / total rows.
    data.push([custName]);
    const projects = [...cg.projects.entries()].sort((a, b) => custTotalNum(b[1].total) - custTotalNum(a[1].total));
    for (const [projName, pg] of projects) {
      const showProj = projName !== "No project" || projects.length > 1;
      if (showProj) data.push([`    ${projName}`]);
      const invRows = [...pg.rows].sort((a, b) => String(a.inv.dueDate).localeCompare(String(b.inv.dueDate)));
      for (const r of invRows) {
        const inv = r.inv;
        const total = Number(inv.total || 0);
        data.push([
          `        #${inv.invoiceNumber}`,
          inv.invoiceDate ?? "",
          inv.dueDate ?? "",
          Math.max(0, r.days),
          inv.currency || "EUR",
          round2(total),
          round2(Math.max(0, total - r.bal)),
          round2(r.bal),
        ]);
      }
      if (showProj) data.push(["", "", "", "", "", "", "    Project subtotal:", fmtCcyMap(pg.total)]);
    }
    data.push(["", "", "", "", "", "", `Total — ${custName}:`, fmtCcyMap(cg.total)]);
    data.push([]);
  }

  data.push([]);
  data.push(["", "", "", "", "", "", "GRAND TOTAL:", fmtCcyMap(grand)]);

  const wb = XLSX.utils.book_new();
  appendSheet(wb, "Statement", data);
  XLSX.writeFile(wb, `Statement_${todayIso}.xlsx`);
}

// ─── util ──────────────────────────────────────────────────────────────────

function appendSheet(wb: XLSX.WorkBook, name: string, data: any[][]) {
  const ws = XLSX.utils.aoa_to_sheet(data);

  // Auto-width: find max char length per column
  const colWidths: number[] = [];
  for (const row of data) {
    if (!Array.isArray(row)) continue;
    row.forEach((cell, i) => {
      const len = String(cell ?? "").length;
      colWidths[i] = Math.max(colWidths[i] || 0, len);
    });
  }
  ws["!cols"] = colWidths.map(w => ({ wch: Math.min(Math.max(w + 2, 8), 50) }));

  XLSX.utils.book_append_sheet(wb, ws, name);
}
