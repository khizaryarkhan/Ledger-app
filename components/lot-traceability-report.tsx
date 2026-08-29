"use client";

/**
 * Lot traceability — search a lot code (or arrive with ?lotId= from Stock
 * Valuation Detail) and see its complete history: what it was made from
 * (ancestors, all the way back to the originating purchase — supplier, PO,
 * receipt date, who received it, and cost) and what it became (descendants,
 * down to a sale — customer, invoice — or remaining on-hand), with who
 * performed/recorded each processing step along the way.
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, GitBranch, Truck, Factory, Shirt, Package } from "lucide-react";
import { fmt } from "@/lib/format";
import { ReportShell } from "@/components/ui";

const qty = fmt.qty;
const money = fmt.num2;

function OriginCard({ origin }: { origin: any }) {
  if (!origin) return null;
  return (
    <div className="mt-1.5 rounded-lg bg-cyan-500/5 border border-cyan-900/40 px-3 py-2 text-[12px] space-y-0.5">
      <div className="text-cyan-300 font-medium flex items-center gap-1.5"><Truck size={12} /> Purchased — {origin.receiptNo ?? "goods receipt"}{origin.date ? ` · ${origin.date}` : ""}</div>
      <div className="text-stone-400">Supplier: <span className="text-stone-200">{origin.supplierLabel ?? "—"}</span>{origin.poNumber ? <> · PO <span className="text-stone-200">{origin.poNumber}</span></> : null}</div>
      <div className="text-stone-500">Received by {origin.receivedBy ?? "—"} · {qty(origin.qty)} @ {money(origin.unitCost)}/unit</div>
    </div>
  );
}

function hopIcon(kind: string) {
  if (kind === "jobwork") return <Shirt size={12} />;
  if (kind === "production") return <Factory size={12} />;
  return <Package size={12} />;
}

function AncestorTree({ edges, depth = 0 }: { edges: any[]; depth?: number }) {
  if (!edges.length) return null;
  return (
    <div style={{ marginLeft: depth > 0 ? 20 : 0 }} className="space-y-3 mt-2">
      {edges.map((e, i) => (
        <div key={i} className="border-l-2 border-stone-800 pl-3">
          <div className="text-[12px] text-stone-500 flex items-center gap-1.5">{hopIcon(e.via.kind)} {e.via.label}{e.via.date ? ` · ${e.via.date}` : ""}{e.via.by ? ` · by ${e.via.by}` : ""}</div>
          {e.via.notes && <div className="text-[11.5px] text-stone-600 italic">"{e.via.notes}"</div>}
          <div className="text-[13px] text-stone-200 mt-0.5">
            {e.lot.itemName} <span className="font-mono text-stone-400">{e.lot.lotNo || e.lot.id.slice(0, 8)}</span>
            <span className="text-stone-500"> — {qty(e.qtyConsumed)} consumed · cost {money(e.costContribution)}</span>
          </div>
          <OriginCard origin={e.lot.origin} />
          <AncestorTree edges={e.ancestors} depth={depth + 1} />
        </div>
      ))}
    </div>
  );
}

function DescendantTree({ edges, depth = 0 }: { edges: any[]; depth?: number }) {
  if (!edges.length) return null;
  return (
    <div style={{ marginLeft: depth > 0 ? 20 : 0 }} className="space-y-3 mt-2">
      {edges.map((e, i) => (
        <div key={i} className="border-l-2 border-stone-800 pl-3">
          <div className="text-[12px] text-stone-500 flex items-center gap-1.5">{hopIcon(e.kind)} {e.label}{e.date ? ` · ${e.date}` : ""}{e.by ? ` · by ${e.by}` : ""}</div>
          {e.notes && <div className="text-[11.5px] text-stone-600 italic">"{e.notes}"</div>}
          <div className="text-[13px] text-stone-200 mt-0.5">
            {qty(e.qtyConsumed)} consumed
            {e.kind === "sale" && e.sale && (
              <span className="text-stone-500"> — sold to {e.sale.customerLabel ?? "customer"}{e.sale.invoiceNo ? `, invoiced ${e.sale.invoiceNo}` : " (not yet invoiced)"}</span>
            )}
          </div>
          {(e.producedLots ?? []).map((pl: any) => (
            <div key={pl.id}>
              <div className="text-[12.5px] text-emerald-400/90 mt-1">→ {pl.itemName} <span className="font-mono text-stone-400">{pl.lotNo || pl.id.slice(0, 8)}</span> <span className="text-stone-500">· unit cost {money(pl.unitCost)}</span></div>
            </div>
          ))}
          <DescendantTree edges={e.descendants ?? []} depth={depth + 1} />
        </div>
      ))}
    </div>
  );
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
    const d = await fetch(`/api/inventory/lots/${lotId}/genealogy`).then(r => r.json()).catch(() => null);
    setData(d); setLoading(false);
  }
  useEffect(() => { if (selectedId) load(selectedId); }, [selectedId]);

  return (
    <ReportShell title="Lot Traceability" sub="A lot's complete history — what it was made from and what it became." icon={GitBranch} onRefresh={() => selectedId && load(selectedId)} loading={loading}>
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
        <div className="rounded-xl bg-stone-900 border border-stone-800 p-5">
          {loading && <p className="text-stone-500 text-sm">Loading…</p>}
          {!loading && !data && <p className="text-stone-500 text-sm">Lot not found.</p>}
          {!loading && data && (
            <>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-stone-500">Lot</div>
                  <div className="text-lg font-semibold text-stone-100">{data.lot.itemName} <span className="font-mono text-emerald-400">{data.lot.lotNo}</span></div>
                  <div className="text-[12.5px] text-stone-400 mt-1">{qty(data.lot.remainingQty)} of {qty(data.lot.origQty)} remaining · unit cost {money(data.lot.unitCost)} · total value {money(data.lot.origQty * data.lot.unitCost)}</div>
                  <OriginCard origin={data.origin} />
                </div>
                <button onClick={() => { setSelectedId(null); setData(null); setResults([]); setQ(""); setSearched(false); }} className="text-[12px] text-stone-500 hover:text-stone-300">New search</button>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-1">Made from (backward trace)</div>
                  {data.ancestors.length === 0 ? <p className="text-[12.5px] text-stone-600">Originating stock — no further ancestors.</p> : <AncestorTree edges={data.ancestors} />}
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-1">Became (forward trace)</div>
                  {data.descendants.length === 0 ? <p className="text-[12.5px] text-stone-600">Still on hand — not yet consumed or sold.</p> : <DescendantTree edges={data.descendants} />}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </ReportShell>
  );
}
