"use client";

/**
 * Lot traceability — search a lot code (or arrive with ?lotId= from Stock
 * Valuation Detail) and see its complete history: what it was made from
 * (ancestors, up to the originating purchase) and what it became
 * (descendants, down to a sale or remaining on-hand).
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, GitBranch } from "lucide-react";
import { fmt } from "@/lib/format";
import { ReportShell } from "@/components/ui";

const qty = fmt.qty;
const money = fmt.num2;

function AncestorTree({ edges, depth = 0 }: { edges: any[]; depth?: number }) {
  if (!edges.length) return null;
  return (
    <div style={{ marginLeft: depth > 0 ? 20 : 0 }} className="space-y-2 mt-2">
      {edges.map((e, i) => (
        <div key={i} className="border-l-2 border-stone-800 pl-3">
          <div className="text-[12px] text-stone-500">{e.via.label}{e.via.date ? ` · ${e.via.date}` : ""}</div>
          <div className="text-[13px] text-stone-200">
            {e.lot.itemName} <span className="font-mono text-stone-400">{e.lot.lotNo || e.lot.id.slice(0, 8)}</span>
            <span className="text-stone-500"> — {qty(e.qtyConsumed)} consumed</span>
          </div>
          <AncestorTree edges={e.ancestors} depth={depth + 1} />
        </div>
      ))}
    </div>
  );
}

function DescendantTree({ edges, depth = 0 }: { edges: any[]; depth?: number }) {
  if (!edges.length) return null;
  return (
    <div style={{ marginLeft: depth > 0 ? 20 : 0 }} className="space-y-2 mt-2">
      {edges.map((e, i) => (
        <div key={i} className="border-l-2 border-stone-800 pl-3">
          <div className="text-[12px] text-stone-500">{e.label}{e.date ? ` · ${e.date}` : ""}</div>
          <div className="text-[13px] text-stone-200">
            {qty(e.qtyConsumed)} consumed
            {e.kind === "sale" && e.sale?.customerLabel && <span className="text-stone-500"> — sold to {e.sale.customerLabel}</span>}
          </div>
          {(e.producedLots ?? []).map((pl: any) => (
            <div key={pl.id} className="text-[12.5px] text-emerald-400/90 mt-1">→ {pl.itemName} <span className="font-mono text-stone-400">{pl.lotNo || pl.id.slice(0, 8)}</span></div>
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
  const [selectedId, setSelectedId] = useState<string | null>(params.get("lotId"));
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function search() {
    if (!q.trim()) { setResults([]); return; }
    const r = await fetch(`/api/inventory/lots?q=${encodeURIComponent(q.trim())}`).then(x => x.json()).catch(() => []);
    setResults(Array.isArray(r) ? r : []);
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
                  <div className="text-[12.5px] text-stone-400 mt-1">{qty(data.lot.remainingQty)} of {qty(data.lot.origQty)} remaining · unit cost {money(data.lot.unitCost)}</div>
                  {data.origin && <div className="text-[12.5px] text-stone-500 mt-1">Purchased on {data.origin.receiptNo} from {data.origin.supplierLabel ?? "—"} ({data.origin.date})</div>}
                </div>
                <button onClick={() => { setSelectedId(null); setData(null); setResults([]); setQ(""); }} className="text-[12px] text-stone-500 hover:text-stone-300">New search</button>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-1">Made from (ancestors)</div>
                  {data.ancestors.length === 0 ? <p className="text-[12.5px] text-stone-600">Originating stock — no further ancestors.</p> : <AncestorTree edges={data.ancestors} />}
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-1">Became (descendants)</div>
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
