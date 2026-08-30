"use client";

/**
 * Subcontractor Yield & Wastage Performance — ranks job-work vendors by how
 * much material they actually return vs. what was sent, computed only from
 * CLOSED orders (an order still in flight has no final wastage figure yet).
 * Wastage is never assumed or apportioned into build costs — this is where
 * it's meant to be visible instead: which subcontractor is losing the most
 * material, in dollars and in percent, vs. any expected-yield benchmark set
 * per order.
 */

import { useEffect, useState, Fragment } from "react";
import { Gauge, ChevronDown, ChevronRight } from "lucide-react";
import { fmt } from "@/lib/format";
import { ReportShell } from "@/components/ui";

const money = fmt.num2;
const qty = fmt.qty;

export function JobWorkYieldReport() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const d = await fetch(`/api/inventory/jobwork-reports?type=vendor-yield`).then(r => r.json()).catch(() => null);
    setData(d); setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const vendors = data?.vendors ?? [];

  return (
    <ReportShell title="Subcontractor Yield & Wastage Performance" sub="Actual material yield vs. sent, per job-work vendor — only closed orders (wastage is only final once an order is closed)." icon={Gauge} onRefresh={load} loading={loading}>
      <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[820px]">
            <thead><tr className="text-left text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
              <th className="px-4 py-2.5"></th>
              <th className="px-4 py-2.5">Vendor</th>
              <th className="px-4 py-2.5 text-right">Closed orders</th>
              <th className="px-4 py-2.5 text-right">Sent</th>
              <th className="px-4 py-2.5 text-right">Received</th>
              <th className="px-4 py-2.5 text-right">Actual yield</th>
              <th className="px-4 py-2.5 text-right">Expected (avg)</th>
              <th className="px-4 py-2.5 text-right">Wastage value</th>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
              {!loading && vendors.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-stone-500">No closed job-work orders yet — wastage is only recognized once an order is explicitly closed.</td></tr>}
              {vendors.map((v: any) => {
                const isOpen = expanded === (v.vendorId ?? v.vendorLabel);
                const variance = v.avgExpectedYieldPct != null ? round2(v.actualYieldPct - v.avgExpectedYieldPct) : null;
                return (
                  <Fragment key={v.vendorId ?? v.vendorLabel}>
                    <tr className="border-b border-stone-800/60 hover:bg-stone-800/30 cursor-pointer" onClick={() => setExpanded(isOpen ? null : (v.vendorId ?? v.vendorLabel))}>
                      <td className="px-4 py-2.5 text-stone-600">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                      <td className="px-4 py-2.5 text-stone-100 font-medium">{v.vendorLabel}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-stone-300">{v.orderCount}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-stone-300">{qty(v.totalSentQty)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-stone-300">{qty(v.totalReceivedQty)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-stone-100">{v.actualYieldPct.toFixed(2)}%</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-stone-400">
                        {v.avgExpectedYieldPct != null ? (
                          <>{v.avgExpectedYieldPct.toFixed(2)}% <span className={variance! < 0 ? "text-amber-400" : "text-emerald-400"}>({variance! >= 0 ? "+" : ""}{variance!.toFixed(2)})</span></>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-amber-400 font-medium">{money(v.totalWastageAmount)}</td>
                    </tr>
                    {isOpen && v.orders.map((o: any) => (
                      <tr key={o.id} className="border-b border-stone-800/40 bg-stone-950/40">
                        <td></td>
                        <td className="px-4 py-1.5 pl-8 text-stone-400 font-mono text-[12px]" colSpan={2}>{o.docNumber} · closed {o.closedAt ? String(o.closedAt).slice(0, 10) : ""}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums text-stone-500 text-[12px]">{qty(o.sentQty)}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums text-stone-500 text-[12px]">{qty(o.receivedQty)}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums text-stone-400 text-[12px]">{o.actualYieldPct.toFixed(2)}%</td>
                        <td className="px-4 py-1.5 text-right tabular-nums text-stone-500 text-[12px]">{o.expectedYieldPct != null ? `${Number(o.expectedYieldPct).toFixed(2)}%` : "—"}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums text-amber-400/80 text-[12px]">{money(o.wastageAmount)}</td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
            {vendors.length > 0 && (
              <tfoot><tr className="border-t border-stone-700 bg-stone-950/40 font-semibold">
                <td colSpan={3} className="px-4 py-2.5 text-stone-200">Total ({data.grandTotal.orderCount} closed orders)</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-stone-100">{qty(data.grandTotal.totalSentQty)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-stone-100">{qty(data.grandTotal.totalReceivedQty)}</td>
                <td></td><td></td>
                <td className="px-4 py-2.5 text-right tabular-nums text-amber-400">{money(data.grandTotal.totalWastageAmount)}</td>
              </tr></tfoot>
            )}
          </table>
        </div>
      </div>
    </ReportShell>
  );
}

function round2(n: number) { return Math.round((n || 0) * 100) / 100; }
