"use client";

/**
 * Production console — run a Build against a BOM: pick which cost lots each
 * input is drawn from (FIFO-prefilled, fully overridable), see the exact cost
 * that will move into the finished item, and post it. Consuming inputs credits
 * their inventory; the output is produced at the summed cost (Dr FP Inventory).
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Factory, X, Loader, Check, Wand2, Trash2 } from "lucide-react";
import { fmt } from "@/lib/format";

const inputCls = "bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-100 w-full focus:outline-none focus:border-emerald-600";
const labelCls = "block text-[11px] font-medium uppercase tracking-wide text-stone-500 mb-1";
const money = fmt.num2;

export function ProductionConsole() {
  const [runs, setRuns] = useState<any[] | null>(null);
  const [boms, setBoms] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);

  async function load() {
    const r = await fetch(`/api/inventory/production`).then(x => x.json()).catch(() => []);
    setRuns(Array.isArray(r) ? r : []);
  }
  useEffect(() => {
    load();
    fetch(`/api/inventory/boms`).then(x => x.json()).then(r => setBoms(Array.isArray(r) ? r : [])).catch(() => {});
    fetch(`/api/inventory/items`).then(x => x.json()).then(r => setItems(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);
  useEffect(() => { if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1") setShowNew(true); }, []);

  async function voidRow(id: string, no: string) {
    if (!confirm(`Void build ${no}? This puts the consumed inputs back and removes the produced output.`)) return;
    const r = await fetch(`/api/inventory/production/${id}`, { method: "DELETE" });
    if (!r.ok) { alert((await r.json().catch(() => ({})))?.error || "Could not void build."); return; }
    load();
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-orange-500/15 flex items-center justify-center"><Factory size={18} className="text-orange-400" /></div>
          <h1 className="text-xl font-semibold text-stone-100">Production</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={runs === null ? "animate-spin" : ""} /></button>
          <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-2 hover:bg-emerald-700"><Plus size={14} /> New build</button>
        </div>
      </div>
      <p className="text-sm text-stone-400 mb-5 ml-12">Run a build against a BOM. Inputs are consumed from their FIFO cost lots (or lots you pick) and the finished item is produced at the exact summed cost.</p>

      {showNew && <BuildDrawer boms={boms} items={items} onClose={() => setShowNew(false)} onDone={() => { setShowNew(false); load(); fetch(`/api/inventory/items`).then(x => x.json()).then(r => setItems(Array.isArray(r) ? r : [])).catch(() => {}); }} />}

      <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[640px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                <th className="text-left px-4 py-2.5">Build #</th>
                <th className="text-left px-4 py-2.5">Output</th>
                <th className="text-right px-4 py-2.5">Qty</th>
                <th className="text-right px-4 py-2.5">Total cost</th>
                <th className="text-right px-4 py-2.5">Unit cost</th>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {runs === null && <tr><td colSpan={8} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
              {runs !== null && runs.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-stone-500">No builds yet — run one with the New build button.</td></tr>}
              {(runs ?? []).map(r => {
                const qty = Number(r.qtyToProduce) || 0; const total = Number(r.totalInputCost) || 0;
                return (
                  <tr key={r.id} className="border-b border-stone-800/60">
                    <td className="px-4 py-2.5 font-mono text-[12px] text-stone-200">{r.runNo || r.id.slice(0, 8)}</td>
                    <td className="px-4 py-2.5 text-stone-100">{r.outputItem?.name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right text-stone-300 tabular-nums">{qty.toLocaleString()} {r.outputItem?.baseUom || ""}</td>
                    <td className="px-4 py-2.5 text-right text-stone-300 tabular-nums">{money(total)}</td>
                    <td className="px-4 py-2.5 text-right text-stone-300 tabular-nums">{money(qty > 0 ? total / qty : 0)}</td>
                    <td className="px-4 py-2.5 text-stone-400">{r.producedDate || "—"}</td>
                    <td className="px-4 py-2.5"><span className="text-[11px] text-emerald-400">{r.status}</span></td>
                    <td className="px-2 py-2.5"><button onClick={() => voidRow(r.id, r.runNo || r.id.slice(0, 8))} className="p-1 rounded hover:bg-stone-700 text-stone-600 hover:text-rose-400" title="Void build"><Trash2 size={13} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

type InputRow = { itemId: string; name: string; baseUom: string | null; skuId: string | null; required: number; lots: any[] | null; alloc: Record<string, string> };

function BuildDrawer({ boms, items, onClose, onDone }: { boms: any[]; items: any[]; onClose: () => void; onDone: () => void }) {
  const producible = items.filter(i => i.productType === "FinishedProduct" || i.productType === "WorkInProgress");
  const [bomId, setBomId] = useState("");
  const [outputItemId, setOutputItemId] = useState("");
  const [outputSkuId, setOutputSkuId] = useState("");
  const [outputSkus, setOutputSkus] = useState<any[]>([]);
  const [qty, setQty] = useState("1");
  const [batchSize, setBatchSize] = useState(1);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<InputRow[]>([]);
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");

  const outputItem = items.find(i => i.id === outputItemId);
  const outputSku = outputSkus.find(s => s.id === outputSkuId);
  const packSize = outputSku ? Number(outputSku.innerUnitPackSize) || 0 : 0;

  async function loadLots(itemId: string): Promise<any[]> {
    const r = await fetch(`/api/inventory/items/${itemId}`).then(x => x.json()).catch(() => null);
    return r?.lots ?? [];
  }

  // Load the output item's SKUs so the build can name which packaging it makes.
  useEffect(() => {
    if (!outputItemId) { setOutputSkus([]); return; }
    fetch(`/api/inventory/items/${outputItemId}`).then(r => r.json()).then(d => setOutputSkus(d?.skus ?? [])).catch(() => setOutputSkus([]));
  }, [outputItemId]);

  // Choosing a BOM loads its inputs and output (item + packaging SKU).
  async function onBom(id: string) {
    setBomId(id);
    if (!id) { setRows([]); return; }
    const d = await fetch(`/api/inventory/boms/${id}`).then(x => x.json()).catch(() => null);
    if (!d?.bom) return;
    setBatchSize(Number(d.bom.batchSize) || 1);
    if (d.bom.outputItemId) setOutputItemId(d.bom.outputItemId);
    else if (d.outputs?.[0]?.itemId) setOutputItemId(d.outputs[0].itemId);
    if (d.bom.outputSkuId) setOutputSkuId(d.bom.outputSkuId);
    const inputRows: InputRow[] = await Promise.all((d.inputs ?? []).map(async (l: any) => ({
      itemId: l.itemId, name: l.item?.name ?? "Item", baseUom: l.item?.baseUom ?? l.uom ?? null, skuId: l.skuId ?? null,
      required: Number(l.qty) || 0, lots: await loadLots(l.itemId), alloc: {},
    })));
    setRows(inputRows);
  }

  // Scale required qty by qty-to-produce / batch size and FIFO-prefill.
  const scaled = useMemo(() => {
    const factor = batchSize > 0 ? (Number(qty) || 0) / batchSize : 0;
    return rows.map(r => ({ ...r, need: Math.round(r.required * factor * 1e4) / 1e4 }));
  }, [rows, qty, batchSize]);

  function fifoFill(idx: number) {
    setRows(rs => rs.map((r, i) => {
      if (i !== idx) return r;
      const factor = batchSize > 0 ? (Number(qty) || 0) / batchSize : 0;
      let need = Math.round(r.required * factor * 1e4) / 1e4;
      const alloc: Record<string, string> = {};
      for (const lot of (r.lots ?? [])) {
        if (need <= 0) break;
        const take = Math.min(Number(lot.remainingQty) || 0, need);
        if (take > 0) { alloc[lot.id] = String(take); need = Math.round((need - take) * 1e4) / 1e4; }
      }
      return { ...r, alloc };
    }));
  }
  function setAlloc(idx: number, lotId: string, v: string) {
    setRows(rs => rs.map((r, i) => i === idx ? { ...r, alloc: { ...r.alloc, [lotId]: v } } : r));
  }

  const preview = useMemo(() => {
    let total = 0; let anyUnder = false;
    for (const r of scaled) {
      let allocQty = 0, allocCost = 0;
      for (const lot of (r.lots ?? [])) {
        const q = Number(r.alloc[lot.id]) || 0;
        allocQty += q; allocCost += q * (Number(lot.unitCost) || 0);
      }
      // If nothing allocated, the server will FIFO the needed qty — estimate at oldest lots.
      if (allocQty === 0 && r.need > 0) {
        let need = r.need;
        for (const lot of (r.lots ?? [])) { if (need <= 0) break; const take = Math.min(Number(lot.remainingQty) || 0, need); allocCost += take * (Number(lot.unitCost) || 0); allocQty += take; need -= take; }
        if (need > 0.0001) anyUnder = true;
      } else if (allocQty + 0.0001 < r.need) anyUnder = true;
      total += allocCost;
    }
    const q = Number(qty) || 0;
    return { total: Math.round(total * 100) / 100, unit: q > 0 ? Math.round((total / q) * 100) / 100 : 0, anyUnder };
  }, [scaled, qty]);

  async function save() {
    if (!outputItemId) { setErr("Select the item to produce."); return; }
    if (!(Number(qty) > 0)) { setErr("Enter a quantity to produce."); return; }
    const inputs = scaled.map(r => ({
      itemId: r.itemId,
      qty: r.need,
      skuId: r.skuId,
      lotPicks: Object.entries(r.alloc).map(([lotId, v]) => ({ lotId, qty: Number(v) || 0 })).filter(p => p.qty > 0),
    })).filter(i => i.qty > 0);
    if (!inputs.length) { setErr("Add at least one input to consume (via a BOM or below)."); return; }
    setSaving(true); setErr("");
    const r = await fetch(`/api/inventory/production`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bomId: bomId || null, outputItemId, outputSkuId: outputSkuId || null, qtyToProduce: Number(qty), producedDate: date, inputs }) });
    const d = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) { setErr(d?.error || "Build failed."); return; }
    if (d.pending) { alert("This build exceeds your org's approval threshold and has been submitted for approval — nothing has posted yet. See Approvals."); onDone(); return; }
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative bg-stone-900 border-l border-stone-800 h-full overflow-y-auto shadow-2xl w-full max-w-xl" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800 sticky top-0 bg-stone-900 z-10">
          <h2 className="text-[15px] font-semibold text-stone-100">New production build</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-stone-800 text-stone-500"><X size={17} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>From BOM (optional)</label>
              <select className={inputCls} value={bomId} onChange={e => onBom(e.target.value)}>
                <option value="">No BOM — pick inputs manually</option>
                {boms.map(b => <option key={b.id} value={b.id}>{b.code ? `${b.code} · ` : ""}{b.outputItemName || b.name}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>Production date</label><input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Output item</label>
              <select className={inputCls} value={outputItemId} onChange={e => { setOutputItemId(e.target.value); setOutputSkuId(""); }}>
                <option value="">Select item to produce…</option>
                {producible.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>Output packaging (SKU)</label>
              <select className={inputCls} value={outputSkuId} onChange={e => setOutputSkuId(e.target.value)}>
                <option value="">Base UoM {outputItem?.baseUom ? `(${outputItem.baseUom})` : ""}</option>
                {outputSkus.map(s => <option key={s.id} value={s.id}>{s.skuName || s.skuCode || s.id.slice(0, 8)}{s.innerUnitPackSize ? ` · ${Number(s.innerUnitPackSize)} ${outputItem?.baseUom || ""}` : ""}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Qty to produce {outputSku ? `(${outputSku.innerPackType || "packs"})` : outputItem?.baseUom ? `(${outputItem.baseUom})` : ""}</label><input type="number" className={inputCls} value={qty} onChange={e => setQty(e.target.value)} />
            {packSize > 0 && Number(qty) > 0 && <p className="text-[11px] text-stone-500 mt-1">= {(Number(qty) * packSize).toLocaleString()} {outputItem?.baseUom || ""} into stock</p>}
            <p className="text-[11px] text-stone-500 mt-1">The output lot code is assigned automatically — finished/WIP items don't get a user-editable lot number.</p>
          </div>

          {rows.length === 0 && bomId && <p className="text-[12px] text-amber-400">This BOM has no input items yet — add them on the BOM first.</p>}
          {rows.length === 0 && !bomId && <p className="text-[12px] text-stone-500">Choose a BOM above to load its inputs, or (manual builds) select one on the BOM and reopen.</p>}

          {scaled.map((r, idx) => {
            const alloc = (r.lots ?? []).reduce((s: number, lot: any) => s + (Number(r.alloc[lot.id]) || 0), 0);
            return (
              <div key={r.itemId} className="rounded-lg border border-stone-800 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[13px] font-semibold text-stone-100">{r.name} <span className="text-[11px] text-stone-500 font-normal">need {r.need} {r.baseUom || ""}</span></div>
                  <button onClick={() => fifoFill(idx)} className="flex items-center gap-1 text-[11px] font-medium text-sky-400 hover:text-sky-300"><Wand2 size={12} /> FIFO fill</button>
                </div>
                {(r.lots ?? []).length === 0
                  ? <p className="text-[11px] text-rose-400">No stock on hand — receive this material first, or it will be costed at its fallback unit cost.</p>
                  : (
                    <table className="w-full text-[11.5px]">
                      <thead><tr className="text-[10px] uppercase text-stone-500"><th className="text-left py-1">Lot</th><th className="text-right py-1">Available</th><th className="text-right py-1">Unit cost</th><th className="text-right py-1 w-24">Use qty</th></tr></thead>
                      <tbody>
                        {(r.lots ?? []).map((lot: any) => (
                          <tr key={lot.id}>
                            <td className="py-1 text-stone-300 font-mono">{lot.lotNo || lot.id.slice(0, 8)}</td>
                            <td className="py-1 text-right text-stone-400 tabular-nums">{Number(lot.remainingQty)}</td>
                            <td className="py-1 text-right text-stone-400 tabular-nums font-mono">{money(lot.unitCost)}</td>
                            <td className="py-1 text-right"><input type="number" value={r.alloc[lot.id] ?? ""} onChange={e => setAlloc(idx, lot.id, e.target.value)} className="bg-stone-950 border border-stone-700 rounded px-2 py-1 text-[11.5px] text-stone-100 w-20 text-right" /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                <div className={`text-[11px] mt-1 ${alloc + 0.0001 < r.need && alloc > 0 ? "text-amber-400" : "text-stone-500"}`}>allocated {Math.round(alloc * 1e4) / 1e4} / {r.need} {r.baseUom || ""}{alloc === 0 && r.need > 0 ? " · will auto-fill FIFO on save" : ""}</div>
              </div>
            );
          })}

          {rows.length > 0 && (
            <div className="rounded-lg bg-emerald-500/8 border border-emerald-800/40 px-4 py-3 flex items-center justify-between">
              <div className="text-[12px] text-stone-300">Total input cost → <span className="font-semibold text-emerald-300">{money(preview.total)}</span></div>
              <div className="text-[12px] text-stone-300">Output unit cost <span className="font-semibold text-emerald-300">{money(preview.unit)}</span></div>
            </div>
          )}
          {preview.anyUnder && rows.length > 0 && <p className="text-[11px] text-amber-400">Some inputs are short of stock — the shortfall will be costed at the item's fallback unit cost and drive its on-hand negative.</p>}
          {err && <p className="text-[12px] text-rose-400">{err}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-stone-800 sticky bottom-0 bg-stone-900">
          <button onClick={onClose} className="text-[13px] font-medium text-stone-300 px-3.5 py-2 rounded-lg hover:bg-stone-800">Cancel</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">
            {saving ? <Loader size={14} className="animate-spin" /> : <Check size={14} />} Run build
          </button>
        </div>
      </div>
    </div>
  );
}
