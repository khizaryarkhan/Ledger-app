"use client";

/**
 * Bill of Materials register — recipes defining which inputs produce which
 * outputs. Modelled on the FoodReady BOM grid: a header row (BOM ID, output
 * item, processing step, status, batch type/size, expected yield) expands to
 * Output items and Input items editors. A BOM is the definition consumed by a
 * production Build, which moves inventory cost from the inputs to the output.
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Search, ChevronRight, ChevronDown, Trash2, X, Loader, Check, GitMerge, ArrowRight } from "lucide-react";
import { kindOf } from "@/lib/inventory/item-kinds";

const inputCls = "bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-100 w-full focus:outline-none focus:border-emerald-600";
const labelCls = "block text-[11px] font-medium uppercase tracking-wide text-stone-500 mb-1";

function StatusBadge({ s }: { s: string }) {
  const cls = s === "Active" ? "bg-emerald-500/12 text-emerald-400 border-emerald-800/50" : s === "Draft" ? "bg-amber-500/12 text-amber-400 border-amber-800/50" : "bg-stone-500/12 text-stone-400 border-stone-700";
  return <span className={`text-[10px] font-medium border rounded-full px-2 py-0.5 ${cls}`}>{s}</span>;
}

export function BomRegister() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load() {
    const r = await fetch(`/api/inventory/boms`).then(x => x.json()).catch(() => []);
    setRows(Array.isArray(r) ? r : []);
  }
  useEffect(() => {
    load();
    fetch(`/api/inventory/items`).then(x => x.json()).then(r => setItems(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1") setShowNew(true);
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    let list = rows ?? [];
    if (s) list = list.filter(r => (r.name || "").toLowerCase().includes(s) || (r.code || "").toLowerCase().includes(s) || (r.outputItemName || "").toLowerCase().includes(s));
    return list;
  }, [rows, q]);

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-violet-500/15 flex items-center justify-center"><GitMerge size={18} className="text-violet-400" /></div>
          <h1 className="text-xl font-semibold text-stone-100">Bill of Materials</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={rows === null ? "animate-spin" : ""} /></button>
          <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-2 hover:bg-emerald-700"><Plus size={14} /> New BOM</button>
        </div>
      </div>
      <p className="text-sm text-stone-400 mb-5 ml-12">Recipes that define what inputs are consumed to produce which outputs. A production Build against a BOM moves inventory cost from the inputs to the finished output.</p>

      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-600" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search BOM ID, name or output…" className={`${inputCls} pl-9`} />
        </div>
      </div>

      {showNew && <NewBomDrawer items={items} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />}

      <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[820px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                <th className="w-8" />
                <th className="text-left px-4 py-2.5">BOM ID</th>
                <th className="text-left px-4 py-2.5">Output item</th>
                <th className="text-left px-4 py-2.5">Processing step</th>
                <th className="text-left px-4 py-2.5">Batch type</th>
                <th className="text-right px-4 py-2.5">Batch size</th>
                <th className="text-right px-4 py-2.5">Exp. yield</th>
                <th className="text-left px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows === null && <tr><td colSpan={8} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
              {rows !== null && filtered.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-stone-500">No BOMs yet — create one with the New BOM button.</td></tr>}
              {filtered.map(r => (
                <BomRow key={r.id} bom={r} items={items} open={expanded === r.id} onToggle={() => setExpanded(expanded === r.id ? null : r.id)} onChanged={load} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function BomRow({ bom, items, open, onToggle, onChanged }: { bom: any; items: any[]; open: boolean; onToggle: () => void; onChanged: () => void }) {
  return (
    <>
      <tr className="border-b border-stone-800/60 hover:bg-stone-800/30 cursor-pointer" onClick={onToggle}>
        <td className="pl-3 text-stone-500">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
        <td className="px-4 py-2.5"><span className="text-stone-200 font-mono text-[12px]">{bom.code || bom.id.slice(0, 8)}</span></td>
        <td className="px-4 py-2.5"><span className="text-stone-100 font-medium">{bom.outputItemName || bom.name}</span></td>
        <td className="px-4 py-2.5 text-stone-400">{bom.processingStep || "—"}</td>
        <td className="px-4 py-2.5 text-stone-400">{bom.batchType}</td>
        <td className="px-4 py-2.5 text-right text-stone-300 tabular-nums">{Number(bom.batchSize ?? 1).toLocaleString()}</td>
        <td className="px-4 py-2.5 text-right text-stone-300 tabular-nums">{bom.expYield != null ? `${Number(bom.expYield)}%` : "—"}</td>
        <td className="px-4 py-2.5"><StatusBadge s={bom.status} /></td>
      </tr>
      {open && (
        <tr className="border-b border-stone-800/60 bg-stone-950/40">
          <td colSpan={8} className="px-6 py-4"><BomEditor bom={bom} items={items} onChanged={onChanged} /></td>
        </tr>
      )}
    </>
  );
}

function BomEditor({ bom, items, onChanged }: { bom: any; items: any[]; onChanged: () => void }) {
  const [data, setData] = useState<{ outputs: any[]; inputs: any[] } | null>(null);
  const [adding, setAdding] = useState<"output" | "input" | null>(null);
  async function load() {
    const r = await fetch(`/api/inventory/boms/${bom.id}`).then(x => x.json()).catch(() => null);
    setData({ outputs: r?.outputs ?? [], inputs: r?.inputs ?? [] });
  }
  useEffect(() => { load(); }, [bom.id]);
  async function remove(id: string) { await fetch(`/api/inventory/bom-lines?id=${id}`, { method: "DELETE" }); load(); }

  const outputs = data?.outputs ?? [];
  const inputs = data?.inputs ?? [];
  const producible = items.filter(i => kindOf(i.productType).producible);
  const consumable = items.filter(i => kindOf(i.productType).consumable);

  return (
    <div className="space-y-5">
      {/* Outputs */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-stone-300"><ArrowRight size={14} className="text-emerald-400" /> Output items</div>
          <button onClick={() => setAdding("output")} className="flex items-center gap-1 text-[12px] font-medium text-emerald-400 hover:text-emerald-300"><Plus size={13} /> Add output item</button>
        </div>
        <div className="rounded-lg border border-stone-800 overflow-hidden">
          <table className="w-full text-[12px]">
            <thead><tr className="text-[10px] uppercase tracking-wide text-stone-500 border-b border-stone-800">
              <th className="text-left px-3 py-2">Item</th><th className="text-right px-3 py-2">Output qty</th><th className="text-left px-3 py-2">Packaging config</th><th className="text-right px-3 py-2">Pack qty</th><th className="w-8" />
            </tr></thead>
            <tbody>
              {data === null && <tr><td colSpan={5} className="px-3 py-4 text-center text-stone-500">Loading…</td></tr>}
              {data !== null && outputs.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-stone-500">No output items yet.</td></tr>}
              {outputs.map(l => (
                <tr key={l.id} className="border-b border-stone-800/50">
                  <td className="px-3 py-2 text-stone-200">{l.item?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-right text-stone-200 tabular-nums">{Number(l.qty)} {l.uom || l.item?.baseUom || ""}</td>
                  <td className="px-3 py-2 text-stone-400">{l.packagingConfig || "—"}</td>
                  <td className="px-3 py-2 text-right text-stone-300 tabular-nums">{l.outputPackQty != null ? Number(l.outputPackQty) : "—"}</td>
                  <td className="px-3 py-2"><button onClick={() => remove(l.id)} className="text-stone-600 hover:text-rose-400"><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {/* Inputs */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-stone-300"><ArrowRight size={14} className="text-amber-400 rotate-180" /> Input items</div>
          <button onClick={() => setAdding("input")} className="flex items-center gap-1 text-[12px] font-medium text-emerald-400 hover:text-emerald-300"><Plus size={13} /> Add input item</button>
        </div>
        <div className="rounded-lg border border-stone-800 overflow-hidden">
          <table className="w-full text-[12px]">
            <thead><tr className="text-[10px] uppercase tracking-wide text-stone-500 border-b border-stone-800">
              <th className="text-left px-3 py-2">Item</th><th className="text-left px-3 py-2">Code</th><th className="text-right px-3 py-2">Input qty</th><th className="w-8" />
            </tr></thead>
            <tbody>
              {data === null && <tr><td colSpan={4} className="px-3 py-4 text-center text-stone-500">Loading…</td></tr>}
              {data !== null && inputs.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-stone-500">No input items yet.</td></tr>}
              {inputs.map(l => (
                <tr key={l.id} className="border-b border-stone-800/50">
                  <td className="px-3 py-2 text-stone-200">{l.item?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-stone-400 font-mono">{l.item?.code || "—"}</td>
                  <td className="px-3 py-2 text-right text-stone-200 tabular-nums">{Number(l.qty)} {l.uom || l.item?.baseUom || ""}</td>
                  <td className="px-3 py-2"><button onClick={() => remove(l.id)} className="text-stone-600 hover:text-rose-400"><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {adding && <BomLineDrawer bom={bom} role={adding} items={adding === "output" ? producible : consumable} onClose={() => setAdding(null)} onCreated={() => { setAdding(null); load(); }} />}
    </div>
  );
}

function BomLineDrawer({ bom, role, items, onClose, onCreated }: { bom: any; role: "output" | "input"; items: any[]; onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState<Record<string, string>>({ itemId: "", qty: "", uom: "", packagingConfig: "", outputPackQty: "" });
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));
  const selected = items.find(i => i.id === f.itemId);

  async function save() {
    if (!f.itemId) { setErr("Choose an item."); return; }
    if (!f.qty || Number(f.qty) <= 0) { setErr("Enter a quantity."); return; }
    setSaving(true); setErr("");
    const r = await fetch(`/api/inventory/bom-lines`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bomId: bom.id, role, ...f, uom: f.uom || selected?.baseUom || null }) });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not save."); return; }
    onCreated();
  }

  return (
    <Drawer title={role === "output" ? "Add output item" : "Add input item"} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className={labelCls}>Item</label>
          <select className={inputCls} value={f.itemId} onChange={e => { const it = items.find(x => x.id === e.target.value); set("itemId", e.target.value); if (it && !f.uom) set("uom", it.baseUom || ""); }}>
            <option value="">Select item…</option>
            {items.map(i => <option key={i.id} value={i.id}>{i.name}{i.code ? ` [${i.code}]` : ""}</option>)}
          </select>
          {items.length === 0 && <p className="text-[11px] text-amber-400 mt-1">No eligible items — {role === "output" ? "create a Finished Product or WIP item first." : "create Raw Material / Stock / WIP items first."}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>{role === "output" ? "Output qty" : "Input qty"} (per batch)</label><input type="number" className={inputCls} value={f.qty} onChange={e => set("qty", e.target.value)} /></div>
          <div><label className={labelCls}>UoM</label><input className={inputCls} value={f.uom || selected?.baseUom || ""} onChange={e => set("uom", e.target.value)} placeholder={selected?.baseUom || "base"} /></div>
        </div>
        {role === "output" && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Packaging config</label><input className={inputCls} value={f.packagingConfig} onChange={e => set("packagingConfig", e.target.value)} placeholder="e.g. 4 oz/bag" /></div>
            <div><label className={labelCls}>Output pack qty</label><input type="number" className={inputCls} value={f.outputPackQty} onChange={e => set("outputPackQty", e.target.value)} placeholder="e.g. 75" /></div>
          </div>
        )}
        {err && <p className="text-[12px] text-rose-400">{err}</p>}
      </div>
      <DrawerFooter saving={saving} onClose={onClose} onSave={save} />
    </Drawer>
  );
}

function NewBomDrawer({ items, onClose, onCreated }: { items: any[]; onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState<Record<string, string>>({ code: "", name: "", outputItemId: "", outputSkuId: "", processingStep: "", batchType: "Output", batchSize: "1", expYield: "", status: "Active" });
  const [skus, setSkus] = useState<any[]>([]);
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));
  const producible = items.filter(i => kindOf(i.productType).producible);

  // Load the chosen output item's packaging SKUs so the BOM can name which one it produces.
  useEffect(() => {
    if (!f.outputItemId) { setSkus([]); return; }
    fetch(`/api/inventory/items/${f.outputItemId}`).then(r => r.json()).then(d => setSkus(d?.skus ?? [])).catch(() => setSkus([]));
  }, [f.outputItemId]);

  async function save() {
    if (!f.name.trim()) { setErr("A BOM name is required."); return; }
    setSaving(true); setErr("");
    const r = await fetch(`/api/inventory/boms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not save."); return; }
    onCreated();
  }

  return (
    <Drawer title="New Bill of Materials" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>BOM ID / code</label><input className={inputCls} value={f.code} onChange={e => set("code", e.target.value)} placeholder="e.g. SBOM_Dough" /></div>
          <div><label className={labelCls}>Status</label>
            <select className={inputCls} value={f.status} onChange={e => set("status", e.target.value)}><option>Active</option><option>Draft</option><option>Archived</option></select>
          </div>
        </div>
        <div><label className={labelCls}>BOM name</label><input className={inputCls} value={f.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Dough - WIP" /></div>
        <div><label className={labelCls}>Primary output item</label>
          <select className={inputCls} value={f.outputItemId} onChange={e => { set("outputItemId", e.target.value); set("outputSkuId", ""); }}>
            <option value="">Select item to produce…</option>
            {producible.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          {producible.length === 0 && <p className="text-[11px] text-amber-400 mt-1">Create a Finished Product or Work-in-Progress item first to set an output.</p>}
        </div>
        {f.outputItemId && (
          <div><label className={labelCls}>Output packaging (SKU)</label>
            <select className={inputCls} value={f.outputSkuId} onChange={e => set("outputSkuId", e.target.value)}>
              <option value="">Base UoM (no specific pack)</option>
              {skus.map(s => <option key={s.id} value={s.id}>{s.skuName || s.skuCode || s.id.slice(0, 8)}{s.innerUnitPackSize ? ` · ${Number(s.innerUnitPackSize)} ${s.innerPackType || ""}` : ""}</option>)}
            </select>
            <p className="text-[11px] text-stone-500 mt-1">Which packaging this recipe makes — production builds this SKU. Different packs need their own BOM. {skus.length === 0 && "Add SKUs to the item to choose one."}</p>
          </div>
        )}
        <div className="grid grid-cols-3 gap-3">
          <div><label className={labelCls}>Batch type</label>
            <select className={inputCls} value={f.batchType} onChange={e => set("batchType", e.target.value)}><option>Output</option><option>Input</option></select>
          </div>
          <div><label className={labelCls}>Batch size</label><input type="number" className={inputCls} value={f.batchSize} onChange={e => set("batchSize", e.target.value)} /></div>
          <div><label className={labelCls}>Exp. yield %</label><input type="number" className={inputCls} value={f.expYield} onChange={e => set("expYield", e.target.value)} placeholder="optional" /></div>
        </div>
        <div><label className={labelCls}>Processing step</label><input className={inputCls} value={f.processingStep} onChange={e => set("processingStep", e.target.value)} placeholder="e.g. Packaging" /></div>
        <p className="text-[11px] text-stone-500">After creating the BOM, expand its row to add the output and input items that make up the recipe.</p>
        {err && <p className="text-[12px] text-rose-400">{err}</p>}
      </div>
      <DrawerFooter saving={saving} onClose={onClose} onSave={save} saveLabel="Create BOM" />
    </Drawer>
  );
}

/* ----------------------------- Drawer shell ----------------------------- */

function Drawer({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", on); return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className={`relative bg-stone-900 border-l border-stone-800 h-full overflow-y-auto shadow-2xl w-full ${wide ? "max-w-lg" : "max-w-md"}`} onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800 sticky top-0 bg-stone-900 z-10">
          <h2 className="text-[15px] font-semibold text-stone-100">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-stone-800 text-stone-500"><X size={17} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function DrawerFooter({ saving, onClose, onSave, saveLabel = "Save" }: { saving: boolean; onClose: () => void; onSave: () => void; saveLabel?: string }) {
  return (
    <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-stone-800">
      <button onClick={onClose} className="text-[13px] font-medium text-stone-300 px-3.5 py-2 rounded-lg hover:bg-stone-800">Cancel</button>
      <button onClick={onSave} disabled={saving} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">
        {saving ? <Loader size={14} className="animate-spin" /> : <Check size={14} />} {saveLabel}
      </button>
    </div>
  );
}
