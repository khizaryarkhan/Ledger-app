"use client";

/**
 * Lot traceability — search a lot code (or arrive with ?lotId= from Stock
 * Valuation Detail) and see its complete audit-style trace: raw materials
 * procured/consumed, every subcontract/internal processing step with its
 * cost, a cost rollup reconciled against the lot's own declared valuation,
 * and outbound distribution to customers. Same data and layout as the
 * printable report (components/lot-trace-print.tsx) — this is that report
 * rendered for the app's dark theme instead of a paper sheet, so the screen
 * and the PDF never disagree. Every document number (PO, GRN, job work
 * order, production run, shipment, invoice) links to its own accounting
 * entry in a new tab when one exists.
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, GitBranch, Truck, ShieldCheck, ShieldAlert, FileDown } from "lucide-react";
import { fmt } from "@/lib/format";
import { ReportShell } from "@/components/ui";

const qty = fmt.qty;
const money = fmt.num2;

function SectionCard({ n, title, empty, children }: { n: number; title: string; empty?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-stone-800 flex items-center gap-2">
        <span className="w-5 h-5 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">{n}</span>
        <span className="text-[12.5px] font-semibold text-stone-200">{title}</span>
      </div>
      {empty ? <p className="px-4 py-6 text-[12.5px] text-stone-500 italic">{empty}</p> : <div className="overflow-x-auto">{children}</div>}
    </div>
  );
}

function Th({ children, r }: { children: React.ReactNode; r?: boolean }) {
  return <th className={`px-4 py-2.5 ${r ? "text-right" : "text-left"}`}>{children}</th>;
}

/** A document number that opens its accounting entry in a new tab when an id is available; plain text otherwise. */
function DocLink({ href, mono, children }: { href: string | null | undefined; mono?: boolean; children: React.ReactNode }) {
  const cls = mono ? "font-mono text-[12px]" : "";
  if (!href) return <span className={cls}>{children}</span>;
  return <a href={href} target="_blank" rel="noopener noreferrer" className={`${cls} text-emerald-400 hover:text-emerald-300 hover:underline`}>{children}</a>;
}

export function LotTraceabilityReport() {
  const params = useSearchParams();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searched, setSearched] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(params.get("lotId"));
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function search() {
    if (!q.trim()) { setResults([]); setSearched(false); return; }
    const r = await fetch(`/api/inventory/lots?q=${encodeURIComponent(q.trim())}`).then(x => x.json()).catch(() => []);
    setResults(Array.isArray(r) ? r : []);
    setSearched(true);
  }

  async function load(lotId: string) {
    setLoading(true); setData(null);
    const d = await fetch(`/api/inventory/lots/${lotId}/trace-report`).then(r => r.json()).catch(() => null);
    setData(d?.lot ? d : null); setLoading(false);
  }
  useEffect(() => { if (selectedId) load(selectedId); }, [selectedId]);

  const totalCost = data?.costRollup?.find((r: any) => r.label.startsWith("Total"))?.amount ?? 0;
  const declaredValue = data ? Math.round(data.lot.unitCost * data.lot.origQty * 100) / 100 : 0;
  const reconciled = data ? (Math.abs(totalCost - declaredValue) < 0.01 || (data.rawMaterials ?? []).length === 0) : false;
  const sum = (rows: any[]) => rows.reduce((s, r) => s + r.amount, 0);
  const rawTotal = data ? sum(data.rawMaterials) : 0;
  const processingTotal = data ? sum(data.processing) : 0;
  const distributionTotal = data ? sum(data.distribution) : 0;

  return (
    <ReportShell title="Lot Traceability" sub="A lot's complete history — raw materials, processing, cost rollup and distribution." icon={GitBranch} onRefresh={() => selectedId && load(selectedId)} loading={loading}>
      <div className="relative max-w-sm mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-600" />
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && search()} placeholder="Search by lot code…" className="bg-stone-950 border border-stone-700 rounded-lg pl-9 pr-3 py-2 text-sm text-stone-100 w-full focus:outline-none focus:border-emerald-600" />
      </div>

      {results.length > 0 && !selectedId && (
        <div className="rounded-xl bg-stone-900 border border-stone-800 divide-y divide-stone-800 mb-4">
          {results.map(r => (
            <button key={r.id} onClick={() => setSelectedId(r.id)} className="w-full text-left px-4 py-2.5 text-[13px] hover:bg-stone-800/60 flex items-center justify-between">
              <span className="text-stone-200">{r.itemName} <span className="font-mono text-stone-400">{r.lotNo}</span></span>
              <span className="text-stone-500">{r.status} · {qty(r.remainingQty)}/{qty(r.origQty)} remaining</span>
            </button>
          ))}
        </div>
      )}
      {results.length === 0 && searched && !selectedId && (
        <p className="text-[12.5px] text-stone-500">No lot matches "{q}" — check the code on Stock Valuation Detail.</p>
      )}

      {selectedId && (
        <div className="space-y-4">
          {loading && <div className="rounded-xl bg-stone-900 border border-stone-800 p-5"><p className="text-stone-500 text-sm">Loading…</p></div>}
          {!loading && !data && <div className="rounded-xl bg-stone-900 border border-stone-800 p-5"><p className="text-stone-500 text-sm">Lot not found.</p></div>}
          {!loading && data && (
            <>
              <div className="rounded-xl bg-stone-900 border border-stone-800 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-stone-500">Batch Traceability &amp; Cost Reconciliation</div>
                    <div className="text-lg font-semibold text-stone-100 mt-0.5">{data.lot.itemName} <span className="font-mono text-emerald-400">{data.lot.lotNo ?? data.lot.id.slice(0, 8)}</span></div>
                  </div>
                  <div className="flex items-center gap-3">
                    <a href={`/print/lot-trace/${selectedId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-emerald-400 hover:underline">
                      <FileDown size={13} /> Print / Download PDF
                    </a>
                    <button onClick={() => { setSelectedId(null); setData(null); setResults([]); setQ(""); setSearched(false); }} className="text-[12px] text-stone-500 hover:text-stone-300">New search</button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 rounded-lg border border-stone-800 divide-x divide-stone-800 overflow-hidden">
                  <div className="px-3 py-2.5 bg-stone-950/40"><div className="text-[10px] uppercase tracking-wider text-stone-500">Lot / Batch</div><div className="text-[13px] font-semibold text-stone-100 font-mono mt-0.5">{data.lot.lotNo ?? data.lot.id.slice(0, 8)}</div></div>
                  <div className="px-3 py-2.5"><div className="text-[10px] uppercase tracking-wider text-stone-500">Total Quantity</div><div className="text-[13px] font-semibold text-stone-100 tabular-nums mt-0.5">{qty(data.lot.origQty)}</div></div>
                  <div className="px-3 py-2.5 bg-stone-950/40"><div className="text-[10px] uppercase tracking-wider text-stone-500">Unit Cost</div><div className="text-[13px] font-semibold text-stone-100 tabular-nums mt-0.5">{money(data.lot.unitCost)}</div></div>
                  <div className="px-3 py-2.5"><div className="text-[10px] uppercase tracking-wider text-stone-500">Total Valuation</div><div className="text-[13px] font-semibold text-stone-100 tabular-nums mt-0.5">{money(declaredValue)}</div></div>
                  <div className="px-3 py-2.5 bg-stone-950/40"><div className="text-[10px] uppercase tracking-wider text-stone-500">Operator</div><div className="text-[13px] font-semibold text-stone-100 mt-0.5">{data.operator ?? "—"}</div></div>
                  <div className="px-3 py-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-stone-500">Reconciliation</div>
                    <div className={`text-[13px] font-semibold mt-0.5 flex items-center gap-1 ${reconciled ? "text-emerald-400" : "text-amber-400"}`}>
                      {reconciled ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />} {reconciled ? "PASSED" : `REVIEW · off by ${money(Math.abs(totalCost - declaredValue))}`}
                    </div>
                  </div>
                </div>
              </div>

              <SectionCard n={1} title="Raw Material Procurement & Consumption" empty={data.rawMaterials.length === 0 ? "No purchased raw materials in this lot's ancestry — it may have been produced entirely from other manufactured/job-worked stock." : undefined}>
                <table className="w-full text-[13px] min-w-[760px]">
                  <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                    <Th>Item</Th><Th r>Qty</Th><Th>UoM</Th><Th r>Rate</Th><Th r>Amount</Th><Th>Source / Reference</Th>
                  </tr></thead>
                  <tbody>
                    {data.rawMaterials.map((r: any, i: number) => (
                      <tr key={i} className="border-b border-stone-800/60">
                        <td className="px-4 py-2 text-stone-100 font-medium">{r.itemName}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-stone-200">{qty(r.qty)}</td>
                        <td className="px-4 py-2 text-stone-400">{r.uom ?? ""}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-stone-400">{money(r.rate)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-stone-200">{money(r.amount)}</td>
                        <td className="px-4 py-2 text-stone-300">
                          <Truck size={11} className="inline mr-1 -mt-0.5 text-cyan-400" />
                          {r.supplierLabel ?? "—"}
                          {r.poNumber ? <> (<DocLink href={r.poId ? `/print/trade/purchase-orders/${r.poId}` : null}>{r.poNumber}</DocLink>{r.receiptNo ? <> / <DocLink href={r.receiptEntryId ? `/accounting/transactions/${r.receiptEntryId}` : null}>{r.receiptNo}</DocLink></> : null})</> : r.receiptNo ? <> (<DocLink href={r.receiptEntryId ? `/accounting/transactions/${r.receiptEntryId}` : null}>{r.receiptNo}</DocLink>)</> : null}
                          <div className="text-[11px] text-stone-500 mt-0.5">↳ {r.issuedTo}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {data.rawMaterials.length > 0 && (
                    <tfoot><tr className="border-t border-stone-700 bg-stone-950/40 font-semibold">
                      <td colSpan={4} className="px-4 py-2.5 text-stone-200">Total direct materials</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-stone-100">{money(rawTotal)}</td>
                      <td></td>
                    </tr></tfoot>
                  )}
                </table>
              </SectionCard>

              <SectionCard n={2} title="Subcontract Processing (Job Work)" empty={data.processing.length === 0 ? "No job-work processing steps in this lot's ancestry — it may have been produced entirely in-house." : undefined}>
                <table className="w-full text-[13px] min-w-[760px]">
                  <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                    <Th>Order ID</Th><Th>Activity / Process</Th><Th r>Qty</Th><Th>UoM</Th><Th r>Rate</Th><Th r>Amount</Th><Th>Provider</Th><Th>Date</Th>
                  </tr></thead>
                  <tbody>
                    {data.processing.map((p: any, i: number) => {
                      const sharePct = p.orderTotalQty && p.orderTotalQty > 0 ? (p.qty / p.orderTotalQty) * 100 : null;
                      const shared = sharePct != null && sharePct < 99.95;
                      return (
                      <tr key={i} className="border-b border-stone-800/60">
                        <td className="px-4 py-2">
                          <DocLink mono href={p.entryId ? `/accounting/transactions/${p.entryId}` : null}>{p.orderId}</DocLink>
                          {shared && <div className="text-[10.5px] text-stone-500 mt-0.5">{sharePct!.toFixed(0)}% of order — shared across other builds</div>}
                          {p.orderWastagePct != null && <div className="text-[10.5px] text-amber-500/80 mt-0.5">Order had {Math.abs(p.orderWastagePct).toFixed(1)}% {p.orderWastagePct > 0 ? "wastage" : "yield gain"} written off</div>}
                        </td>
                        <td className="px-4 py-2 text-stone-300">{p.activity}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-stone-200">{qty(p.qty)}</td>
                        <td className="px-4 py-2 text-stone-400">{p.uom ?? ""}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-stone-400">{money(p.rate)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-stone-200">{money(p.amount)}</td>
                        <td className="px-4 py-2 text-stone-300">{p.provider}</td>
                        <td className="px-4 py-2 text-stone-500">{p.date ?? ""}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                  {data.processing.length > 0 && (
                    <tfoot><tr className="border-t border-stone-700 bg-stone-950/40 font-semibold">
                      <td colSpan={5} className="px-4 py-2.5 text-stone-200">Total conversion fees</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-stone-100">{money(processingTotal)}</td>
                      <td></td><td></td>
                    </tr></tfoot>
                  )}
                </table>
              </SectionCard>

              <SectionCard n={3} title="Cost Rollup Summary">
                <table className="w-full text-[13px] min-w-[560px]">
                  <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                    <Th>Cost Element</Th><Th>Detail</Th><Th r>Amount</Th><Th r>Share</Th>
                  </tr></thead>
                  <tbody>
                    {data.costRollup.map((r: any, i: number) => {
                      const isTotal = r.label.startsWith("Total");
                      return (
                        <tr key={i} className={isTotal ? "border-t-2 border-stone-700 bg-stone-950/40 font-semibold" : "border-b border-stone-800/60"}>
                          <td className="px-4 py-2 text-stone-100">{r.label}</td>
                          <td className="px-4 py-2 text-stone-500">{r.detail}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-stone-100">{money(r.amount)}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-stone-400">{r.sharePct.toFixed(2)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </SectionCard>

              <SectionCard n={4} title="Outbound Commercial Distribution" empty={data.distribution.length === 0 ? "Not yet shipped/sold — still on hand or consumed internally only." : undefined}>
                <table className="w-full text-[13px] min-w-[760px]">
                  <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                    <Th>Shipment</Th><Th>Invoice</Th><Th>Sold-To Customer</Th><Th r>Qty</Th><Th>UoM</Th><Th r>Unit Price</Th><Th r>Amount</Th><Th>Date</Th>
                  </tr></thead>
                  <tbody>
                    {data.distribution.map((d: any, i: number) => (
                      <tr key={i} className="border-b border-stone-800/60">
                        <td className="px-4 py-2"><DocLink mono href={d.shipmentEntryId ? `/accounting/transactions/${d.shipmentEntryId}` : null}>{d.shipmentNo ?? "—"}</DocLink></td>
                        <td className="px-4 py-2">{d.invoiceNo ? <DocLink href={d.invoiceEntryId ? `/accounting/transactions/${d.invoiceEntryId}` : null}>{d.invoiceNo}</DocLink> : "Not yet invoiced"}</td>
                        <td className="px-4 py-2 text-stone-200">{d.customerLabel ?? "—"}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-stone-200">{qty(d.qty)}</td>
                        <td className="px-4 py-2 text-stone-400">{d.uom ?? ""}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-stone-400">{money(d.unitPrice)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-stone-100">{money(d.amount)}</td>
                        <td className="px-4 py-2 text-stone-500">{d.date ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                  {data.distribution.length > 0 && (
                    <tfoot><tr className="border-t border-stone-700 bg-stone-950/40 font-semibold">
                      <td colSpan={6} className="px-4 py-2.5 text-stone-200">Total distributed</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-stone-100">{money(distributionTotal)}</td>
                      <td></td>
                    </tr></tfoot>
                  )}
                </table>
              </SectionCard>

              <div className="flex gap-8 px-1 pt-2 pb-4 text-[12px] text-stone-500">
                <div><span className="block text-stone-600 mb-3">Prepared by</span><span className="text-stone-200 font-medium">{data.operator ?? "—"}</span></div>
                <div><span className="block text-stone-600 mb-3">Reviewed by</span><span className="text-stone-700">—</span></div>
                <div><span className="block text-stone-600 mb-3">Approved by</span><span className="text-stone-700">—</span></div>
              </div>
            </>
          )}
        </div>
      )}
    </ReportShell>
  );
}
