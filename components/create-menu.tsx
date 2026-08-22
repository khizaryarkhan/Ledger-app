"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Plus, ChevronDown } from "lucide-react";

// QBO-style "+ Create" launcher. Each form posts to the ledger tagged with its
// transaction type (journal_entries.source_type). Items with an href are live;
// the rest are the native transaction forms still to be built (marked "soon").
type Item = { label: string; href?: string };
const GROUPS: { title: string; items: Item[] }[] = [
  { title: "Customers", items: [
    { label: "Invoice", href: "/accounting/new/Invoice" },
    { label: "Receive payment", href: "/accounting/new/Payment" },
    { label: "Estimate", href: "/accounting/new/Estimate" },
    { label: "Sales receipt", href: "/accounting/new/SalesReceipt" },
    { label: "Credit note", href: "/accounting/new/CreditNote" },
    { label: "Refund receipt", href: "/accounting/new/RefundReceipt" },
    { label: "Add customer", href: "/accounting/parties/customers?new=1" },
  ] },
  { title: "Suppliers", items: [
    { label: "Bill", href: "/accounting/new/Bill" },
    { label: "Expense", href: "/accounting/new/Expense" },
    { label: "Pay bill", href: "/accounting/new/BillPayment" },
    { label: "Purchase order", href: "/accounting/new/PurchaseOrder" },
    { label: "Receive stock", href: "/accounting/receiving?new=1" },
    { label: "Supplier credit", href: "/accounting/new/VendorCredit" },
    { label: "Add supplier", href: "/accounting/parties/suppliers?new=1" },
  ] },
  { title: "Other", items: [
    { label: "Journal entry", href: "/accounting/journal?new=1" },
    { label: "Bank deposit", href: "/accounting/new/Deposit" },
    { label: "Transfer", href: "/accounting/new/Transfer" },
    { label: "Add product / service", href: "/accounting/products?new=1" },
    { label: "Bill of Materials", href: "/accounting/bom?new=1" },
    { label: "Production build", href: "/accounting/production?new=1" },
    { label: "Add account", href: "/accounting/accounts" },
  ] },
];

export function CreateMenu() {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<any>(null);
  const openNow = () => { if (closeTimer.current) clearTimeout(closeTimer.current); setOpen(true); };
  const closeSoon = () => { closeTimer.current = setTimeout(() => setOpen(false), 180); };
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  return (
    <div className="relative" onMouseEnter={openNow} onMouseLeave={closeSoon}>
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 pl-2 pr-2.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-semibold transition-colors">
        <Plus size={15} /> Create <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div onMouseEnter={openNow} onMouseLeave={closeSoon}
          className="absolute left-0 top-full pt-1.5 z-50">
        <div className="bg-stone-900 border border-stone-700 rounded-xl shadow-2xl shadow-black/50 p-4 grid grid-cols-3 gap-x-8 gap-y-0.5 min-w-[560px]">
          {GROUPS.map(g => (
            <div key={g.title}>
              <div className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider mb-2 px-2">{g.title}</div>
              <div className="flex flex-col">
                {g.items.map(it => it.href ? (
                  <Link key={it.label} href={it.href} onClick={() => setOpen(false)}
                    className="text-[13px] text-stone-200 hover:text-white hover:bg-stone-800 rounded-md px-2 py-1.5 transition-colors">
                    {it.label}
                  </Link>
                ) : (
                  <span key={it.label} className="text-[13px] text-stone-600 px-2 py-1.5 flex items-center justify-between cursor-default">
                    {it.label}
                    <span className="text-[9px] uppercase tracking-wide bg-stone-800 text-stone-500 rounded px-1.5 py-0.5">soon</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        </div>
      )}
    </div>
  );
}
