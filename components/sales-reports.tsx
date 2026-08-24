"use client";

/** Sales reports — Open SOs, Awaiting Invoicing (shipped not invoiced), Open Invoices. */

import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, ShoppingCart, Truck, FileText, ArrowLeft } from "lucide-react";
import { fmt } from "@/lib/format";
import { ReportShell } from "@/components/ui";

const money = fmt.num2;

function useReport(type: string) {
  const [data, setData] = useState<any>(null);
  async function load() { setData(await fetch(`/api/inventory/sales-reports?type=${type}`).then(r => r.json()).catch(() => ({ rows: [], total: 0 }))); }
  useEffect(() => { load(); }, []);
  return { data, load, loading: data === null };
}

export function OpenSosReport() {
  const { data, load, loading } = useReport("open-sos");
  const rows = data?.rows ?? [];
  return (
    <ReportShell title="Open Sales Orders" sub="Confirmed but not fully shipped — the value still committed to customers." icon={ShoppingCart} onRefresh={load} loading={loading}>
      <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden"><div className="overflow-x-auto">
        <table className="w-full text-[13px] min-w-[640px]">
          <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
            <th className="text-left px-4 py-2.5">SO #</th><th className="text-left px-4 py-2.5">Customer</th><th className="text-left px-4 py-2.5">Date</th><th className="text-left px-4 py-2.5">Status</th><th className="text-right px-4 py-2.5">Remaining value</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-stone-500">No open sales orders.</td></tr>}
            {rows.map((p: any) => (
              <tr key={p.id} className="border-b border-stone-800/60">
                <td className="px-4 py-2 font-mono text-[12px] text-stone-200">{p.docNumber || p.id.slice(0, 8)}</td>
                <td className="px-4 py-2 text-stone-200">{p.customer || "—"}</td>
                <td className="px-4 py-2 text-stone-400">{p.date}</td>
                <td className="px-4 py-2"><span className={`text-[11px] ${p.status === "Partial" ? "text-amber-400" : "text-stone-400"}`}>{p.status}</span></td>
                <td className="px-4 py-2 text-right text-stone-200 tabular-nums">{money(p.remainingValue)}</td>
              </tr>
            ))}
            {!loading && rows.length > 0 && <tr className="border-t border-stone-700 bg-stone-950/40 font-semibold"><td className="px-4 py-2.5 text-stone-200" colSpan={4}>Total committed to customers</td><td className="px-4 py-2.5 text-right text-stone-100 tabular-nums">{money(data.total)}</td></tr>}
          </tbody>
        </table>
      </div></div>
    </ReportShell>
  );
}

export function AwaitingInvoicingReport() {
  const { data, load, loading } = useReport("awaiting-invoicing");
  const rows = data?.rows ?? [];
  return (
    <ReportShell title="Awaiting Invoicing" sub="Goods shipped to customers but not yet invoiced — revenue still to be billed." icon={Truck} onRefresh={load} loading={loading}>
      <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden"><div className="overflow-x-auto">
        <table className="w-full text-[13px] min-w-[620px]">
          <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
            <th className="text-left px-4 py-2.5">Shipment #</th><th className="text-left px-4 py-2.5">Customer</th><th className="text-left px-4 py-2.5">Date</th><th className="text-right px-4 py-2.5">Sale value</th><th className="text-right px-4 py-2.5">Invoiced</th><th className="text-right px-4 py-2.5">Awaiting invoice</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-500">Nothing awaiting an invoice.</td></tr>}
            {rows.map((r: any) => (
              <tr key={r.id} className="border-b border-stone-800/60">
                <td className="px-4 py-2 font-mono text-[12px] text-stone-200">{r.shipmentNo || r.id.slice(0, 8)}</td>
                <td className="px-4 py-2 text-stone-200">{r.customerLabel || "—"}</td>
                <td className="px-4 py-2 text-stone-400">{r.shipmentDate}</td>
                <td className="px-4 py-2 text-right text-stone-400 tabular-nums">{money(r.saleValue)}</td>
                <td className="px-4 py-2 text-right text-stone-400 tabular-nums">{money(r.invoiced)}</td>
                <td className="px-4 py-2 text-right text-amber-400 tabular-nums">{money(r.openAmount)}</td>
              </tr>
            ))}
            {!loading && rows.length > 0 && <tr className="border-t border-stone-700 bg-stone-950/40 font-semibold"><td className="px-4 py-2.5 text-stone-200" colSpan={5}>Total awaiting invoicing</td><td className="px-4 py-2.5 text-right text-stone-100 tabular-nums">{money(data.total)}</td></tr>}
          </tbody>
        </table>
      </div></div>
    </ReportShell>
  );
}

export function OpenInvoicesReport() {
  const { data, load, loading } = useReport("open-invoices");
  const rows = data?.rows ?? [];
  return (
    <ReportShell title="Open Invoices" sub="Posted customer invoices with an unpaid Accounts Receivable balance." icon={FileText} onRefresh={load} loading={loading}>
      <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden"><div className="overflow-x-auto">
        <table className="w-full text-[13px] min-w-[640px]">
          <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
            <th className="text-left px-4 py-2.5">Invoice #</th><th className="text-left px-4 py-2.5">Customer</th><th className="text-left px-4 py-2.5">Due</th><th className="text-right px-4 py-2.5">Total</th><th className="text-right px-4 py-2.5">Open</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-stone-500">No open invoices.</td></tr>}
            {rows.map((b: any) => (
              <tr key={b.id} className="border-b border-stone-800/60">
                <td className="px-4 py-2 font-mono text-[12px]"><Link href={`/accounting/transactions/${b.id}`} className="text-emerald-400 hover:text-emerald-300 hover:underline">{b.docNumber}</Link></td>
                <td className="px-4 py-2 text-stone-200">{b.customer}</td>
                <td className="px-4 py-2"><span className={b.overdue ? "text-rose-400" : "text-stone-400"}>{b.dueDate || "—"}</span></td>
                <td className="px-4 py-2 text-right text-stone-400 tabular-nums">{money(b.total)}</td>
                <td className="px-4 py-2 text-right text-stone-200 tabular-nums">{money(b.open)}</td>
              </tr>
            ))}
            {!loading && rows.length > 0 && <tr className="border-t border-stone-700 bg-stone-950/40 font-semibold"><td className="px-4 py-2.5 text-stone-200" colSpan={4}>Total receivable</td><td className="px-4 py-2.5 text-right text-stone-100 tabular-nums">{money(data.total)}</td></tr>}
          </tbody>
        </table>
      </div></div>
    </ReportShell>
  );
}
