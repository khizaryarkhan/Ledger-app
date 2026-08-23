"use client";

/**
 * Reports hub — the home for every accounting report. Grouped like QBO's
 * Reports centre; we keep adding reports here over time.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search, BookOpen, ScrollText, TrendingUp, Scale, Boxes, ClipboardList, PackageSearch, ArrowRight, ShoppingCart, PackageCheck, FileText, Truck, Users, Building2, Receipt, Coins } from "lucide-react";

type Report = { href: string; title: string; sub: string; icon: any };
type Group = { label: string; reports: Report[] };

const GROUPS: Group[] = [
  {
    label: "Financial statements",
    reports: [
      { href: "/accounting/reports/general-ledger", title: "General Ledger", sub: "Every posting to every account, in date order.", icon: BookOpen },
      { href: "/accounting/reports/trial-balance",  title: "Trial Balance",  sub: "Each account's balance — debits must equal credits.", icon: ScrollText },
      { href: "/accounting/reports/profit-loss",    title: "Profit & Loss",  sub: "Income and expenses for a chosen period.", icon: TrendingUp },
      { href: "/accounting/reports/balance-sheet",  title: "Balance Sheet",  sub: "Assets, equity and liabilities at a point in time.", icon: Scale },
      { href: "/accounting/reports/cash-flow",      title: "Cash Flow",      sub: "Where cash came from and went — operating, investing, financing.", icon: TrendingUp },
    ],
  },
  {
    label: "Stock & inventory",
    reports: [
      { href: "/accounting/reports/stock-valuation", title: "Stock Valuation Summary", sub: "On-hand quantity, average cost and total value per item.", icon: Boxes },
      { href: "/accounting/reports/stock-valuation?view=lots", title: "Stock Valuation Detail", sub: "Every open FIFO cost lot with its remaining qty and value.", icon: PackageSearch },
      { href: "/accounting/reports/stock-status", title: "Stock Status", sub: "On-hand & expected (on PO) vs minimum reorder level.", icon: ClipboardList },
    ],
  },
  {
    label: "Purchasing",
    reports: [
      { href: "/accounting/reports/open-pos", title: "Open Purchase Orders", sub: "Ordered but not fully received — remaining value per PO.", icon: ShoppingCart },
      { href: "/accounting/reports/expected-bills", title: "Expected Bills", sub: "Goods received not yet billed — the open GR/IR accrual.", icon: PackageCheck },
      { href: "/accounting/reports/open-bills", title: "Open Bills", sub: "Posted supplier bills with an unpaid A/P balance.", icon: FileText },
    ],
  },
  {
    label: "Sales",
    reports: [
      { href: "/accounting/reports/open-sos", title: "Open Sales Orders", sub: "Confirmed but not fully shipped — value committed to customers.", icon: ShoppingCart },
      { href: "/accounting/reports/awaiting-invoicing", title: "Awaiting Invoicing", sub: "Goods shipped to customers but not yet invoiced.", icon: Truck },
      { href: "/accounting/reports/open-invoices", title: "Open Invoices", sub: "Posted customer invoices with an unpaid A/R balance.", icon: FileText },
    ],
  },
  {
    label: "Receivables & payables",
    reports: [
      { href: "/accounting/reports/aged-receivables", title: "Aged Receivables", sub: "Open customer invoices bucketed by how overdue they are.", icon: Users },
      { href: "/accounting/reports/aged-payables", title: "Aged Payables", sub: "Open supplier bills bucketed by how overdue they are.", icon: Building2 },
      { href: "/accounting/reports/tax-liability", title: "Sales Tax Liability", sub: "Output tax on sales less input tax on purchases, per period.", icon: Receipt },
      { href: "/accounting/reports/fx-exposure", title: "Currency Exposure", sub: "Foreign balances vs home carrying value — unrealised FX gain/loss.", icon: Coins },
    ],
  },
];

export default function ReportsHubPage() {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return GROUPS;
    return GROUPS.map(g => ({ ...g, reports: g.reports.filter(r => r.title.toLowerCase().includes(s) || r.sub.toLowerCase().includes(s)) })).filter(g => g.reports.length);
  }, [q]);

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-indigo-500/15 flex items-center justify-center"><BookOpen size={18} className="text-indigo-400" /></div>
        <h1 className="text-xl font-semibold text-stone-100">Reports</h1>
      </div>
      <p className="text-sm text-stone-400 mb-5 ml-12">All your accounting reports in one place.</p>

      <div className="relative max-w-sm mb-6">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-600" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search reports…" className="bg-stone-950 border border-stone-700 rounded-lg pl-9 pr-3 py-2 text-sm text-stone-100 w-full focus:outline-none focus:border-emerald-600" />
      </div>

      {groups.map(g => (
        <div key={g.label} className="mb-7">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 mb-2">{g.label}</div>
          <div className="grid sm:grid-cols-2 gap-2.5">
            {g.reports.map(r => {
              const Icon = r.icon;
              return (
                <Link key={r.href} href={r.href} className="group flex items-start gap-3 rounded-xl bg-stone-900 border border-stone-800 hover:border-stone-600 p-3.5 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-stone-800 flex items-center justify-center shrink-0 mt-0.5"><Icon size={15} className="text-stone-300" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 text-[13.5px] font-medium text-stone-100">{r.title}<ArrowRight size={13} className="text-stone-600 opacity-0 group-hover:opacity-100 transition-opacity" /></div>
                    <p className="text-[12px] text-stone-400 leading-snug mt-0.5">{r.sub}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
      {groups.length === 0 && <p className="text-sm text-stone-500">No reports match “{q}”.</p>}
    </div>
  );
}
