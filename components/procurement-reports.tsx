"use client";

/** Procurement reports — Open POs, Expected Bills (open GR/IR), Open Bills. */

import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, ShoppingCart, PackageCheck, FileText, ArrowLeft } from "lucide-react";

const money = (n: any) => Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: any) => Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 });

function Shell({ title, sub, icon: Icon, children, onRefresh, loading }: { title: string; sub: string; icon: any; children: React.ReactNode; onRefresh: () => void; loading: boolean }) {
  return (
    <div className="p-6 max-w-5xl">
      <Link href="/accounting/reports" className="inline-flex items-center gap-1 text-[12px] text-stone-500 hover:text-stone-300 mb-3"><ArrowLeft size={13} /> All reports</Link>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/15 flex items-center justify-center"><Icon size={18} className="text-indigo-400" /></div>
          <h1 className="text-xl font-semibold text-stone-100">{title}</h1>
        </div>
        <button onClick={onRefresh} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></button>
      </div>
      <p className="text-sm text-stone-400 mb-5 ml-12">{sub}</p>
      {children}
    </div>
  );
}

function useReport(type: string) {
  const [data, setData] = useState<any>(null);
  async function load() { setData(await fetch(`/api/inventory/procurement-reports?type=${type}`).then(r => r.json()).catch(() => ({ rows: [], total: 0 }))); }
  useEffect(() => { load(); }, []);
  return { data, load, loading: data === null };
}

export function OpenPosReport() {
  const { data, load, loading } = useReport("open-pos");
  const rows = data?.rows ?? [];
  return (
    <Shell title="Open Purchase Orders" sub="Ordered but not fully received — with the quantity still expected from each supplier." icon={ShoppingCart} onRefresh={load} loading={loading}>
      <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[640px]">
            <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
              <th className="text-left px-4 py-2.5">PO #</th><th className="text-left px-4 py-2.5">Supplier</th><th className="text-left px-4 py-2.5">Date</th><th className="text-left px-4 py-2.5">Status</th><th className="text-right px-4 py-2.5">Remaining value</th>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={5} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-stone-500">No open purchase orders.</td></tr>}
              {rows.map((p: any) => (
                <tr key={p.id} className="border-b border-stone-800/60">
                  <td className="px-4 py-2 font-mono text-[12px] text-stone-200">{p.docNumber || p.id.slice(0, 8)}</td>
                  <td className="px-4 py-2 text-stone-200">{p.supplier || "—"}</td>
                  <td className="px-4 py-2 text-stone-400">{p.date}</td>
                  <td className="px-4 py-2"><span className={`text-[11px] ${p.status === "Partial" ? "text-amber-400" : "text-stone-400"}`}>{p.status}</span></td>
                  <td className="px-4 py-2 text-right text-stone-200 tabular-nums">{money(p.remainingValue)}</td>
                </tr>
              ))}
              {!loading && rows.length > 0 && <tr className="border-t border-stone-700 bg-stone-950/40 font-semibold"><td className="px-4 py-2.5 text-stone-200" colSpan={4}>Total remaining on order</td><td className="px-4 py-2.5 text-right text-stone-100 tabular-nums">{money(data.total)}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}

export function ExpectedBillsReport() {
  const { data, load, loading } = useReport("expected-bills");
  const rows = data?.rows ?? [];
  return (
    <Shell title="Expected Bills" sub="Goods received but not yet billed — the open GR/IR accrual awaiting a supplier bill." icon={PackageCheck} onRefresh={load} loading={loading}>
      <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[620px]">
            <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
              <th className="text-left px-4 py-2.5">Receipt #</th><th className="text-left px-4 py-2.5">Supplier</th><th className="text-left px-4 py-2.5">Date</th><th className="text-right px-4 py-2.5">Received</th><th className="text-right px-4 py-2.5">Billed</th><th className="text-right px-4 py-2.5">Awaiting bill</th>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-500">Nothing awaiting a bill — GR/IR is clear.</td></tr>}
              {rows.map((r: any) => (
                <tr key={r.id} className="border-b border-stone-800/60">
                  <td className="px-4 py-2 font-mono text-[12px] text-stone-200">{r.receiptNo || r.id.slice(0, 8)}</td>
                  <td className="px-4 py-2 text-stone-200">{r.supplierLabel || "—"}</td>
                  <td className="px-4 py-2 text-stone-400">{r.receiptDate}</td>
                  <td className="px-4 py-2 text-right text-stone-400 tabular-nums">{money(r.received)}</td>
                  <td className="px-4 py-2 text-right text-stone-400 tabular-nums">{money(r.billed)}</td>
                  <td className="px-4 py-2 text-right text-amber-400 tabular-nums">{money(r.openAmount)}</td>
                </tr>
              ))}
              {!loading && rows.length > 0 && <tr className="border-t border-stone-700 bg-stone-950/40 font-semibold"><td className="px-4 py-2.5 text-stone-200" colSpan={5}>Total expected bills (GR/IR)</td><td className="px-4 py-2.5 text-right text-stone-100 tabular-nums">{money(data.total)}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}

export function OpenBillsReport() {
  const { data, load, loading } = useReport("open-bills");
  const rows = data?.rows ?? [];
  return (
    <Shell title="Open Bills" sub="Posted supplier bills with an unpaid Accounts Payable balance." icon={FileText} onRefresh={load} loading={loading}>
      <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[640px]">
            <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
              <th className="text-left px-4 py-2.5">Bill #</th><th className="text-left px-4 py-2.5">Supplier</th><th className="text-left px-4 py-2.5">Due</th><th className="text-right px-4 py-2.5">Total</th><th className="text-right px-4 py-2.5">Open</th>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={5} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-stone-500">No open bills — everything is paid.</td></tr>}
              {rows.map((b: any) => (
                <tr key={b.id} className="border-b border-stone-800/60">
                  <td className="px-4 py-2 font-mono text-[12px]"><Link href={`/accounting/transactions/${b.id}`} className="text-emerald-400 hover:text-emerald-300 hover:underline">{b.docNumber}</Link></td>
                  <td className="px-4 py-2 text-stone-200">{b.supplier}</td>
                  <td className="px-4 py-2"><span className={b.overdue ? "text-rose-400" : "text-stone-400"}>{b.dueDate || "—"}</span></td>
                  <td className="px-4 py-2 text-right text-stone-400 tabular-nums">{money(b.total)}</td>
                  <td className="px-4 py-2 text-right text-stone-200 tabular-nums">{money(b.open)}</td>
                </tr>
              ))}
              {!loading && rows.length > 0 && <tr className="border-t border-stone-700 bg-stone-950/40 font-semibold"><td className="px-4 py-2.5 text-stone-200" colSpan={4}>Total payable</td><td className="px-4 py-2.5 text-right text-stone-100 tabular-nums">{money(data.total)}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
