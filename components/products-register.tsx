"use client";

/**
 * Inventory Products register — Finished Products & Raw Materials.
 *
 *  • Finished Product: a base UoM is set on the item; each SKU defines how it is
 *    packaged for sale (inner unit → inner pack → outer pack), with a live pack
 *    configuration string.
 *  • Raw Material: each supplier link records the supplier's own UoM & packaging.
 *    When the supplier UoM is in a different dimension from the item base UoM
 *    (e.g. item "lt", supplier "lb"), a conversion factor is required.
 *
 * Accounting fields (price, cost, income/expense account, tax) live on the item.
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Search, ChevronRight, ChevronDown, Trash2, X, Loader, Check, Package, Boxes, Layers } from "lucide-react";
import { UOMS, PACK_TYPES, needsConversionFactor, packConfig } from "@/lib/inventory/uom";
import { QuickAdd, type QuickAddKind } from "@/components/quick-add";

type ProductType = "FinishedProduct" | "RawMaterial";

const inputCls = "bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-100 w-full focus:outline-none focus:border-emerald-600";
const labelCls = "block text-[11px] font-medium uppercase tracking-wide text-stone-500 mb-1";

const UOM_GROUPS: { dim: string; label: string }[] = [
  { dim: "mass", label: "Mass" }, { dim: "volume", label: "Volume" },
  { dim: "count", label: "Count" }, { dim: "length", label: "Length" },
];

function UomSelect({ value, onChange, placeholder = "Select UoM…" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={inputCls}>
      <option value="">{placeholder}</option>
      {UOM_GROUPS.map(g => (
        <optgroup key={g.dim} label={g.label}>
          {UOMS.filter(u => u.dimension === g.dim).map(u => <option key={u.code} value={u.code}>{u.name} ({u.code})</option>)}
        </optgroup>
      ))}
    </select>
  );
}

function PackTypeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={inputCls}>
      <option value="">Pack type…</option>
      {PACK_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
    </select>
  );
}

function TypeBadge({ t }: { t: ProductType }) {
  return t === "RawMaterial"
    ? <span className="text-[10px] font-medium border rounded-full px-2 py-0.5 bg-amber-500/12 text-amber-400 border-amber-800/50">Raw material</span>
    : <span className="text-[10px] font-medium border rounded-full px-2 py-0.5 bg-emerald-500/12 text-emerald-400 border-emerald-800/50">Finished product</span>;
}

export function ProductsRegister() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | ProductType>("all");
  const [showNew, setShowNew] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load() {
    const r = await fetch(`/api/inventory/items`).then(x => x.json()).catch(() => []);
    setRows(Array.isArray(r) ? r : []);
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1") setShowNew(true);
  }, []);

  const filtered = useMemo(() => {
    let list = rows ?? [];
    if (typeFilter !== "all") list = list.filter(r => r.productType === typeFilter);
    const s = q.trim().toLowerCase();
    if (s) list = list.filter(r => (r.name || "").toLowerCase().includes(s) || (r.code || "").toLowerCase().includes(s) || (r.category || "").toLowerCase().includes(s));
    return list;
  }, [rows, q, typeFilter]);

  const counts = useMemo(() => {
    const l = rows ?? [];
    return { all: l.length, FinishedProduct: l.filter(r => r.productType === "FinishedProduct").length, RawMaterial: l.filter(r => r.productType === "RawMaterial").length };
  }, [rows]);

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-teal-500/15 flex items-center justify-center"><Boxes size={18} className="text-teal-400" /></div>
          <h1 className="text-xl font-semibold text-stone-100">Products &amp; Services</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={rows === null ? "animate-spin" : ""} /></button>
          <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-2 hover:bg-emerald-700">
            <Plus size={14} /> New item
          </button>
        </div>
      </div>
      <p className="text-sm text-stone-400 mb-5 ml-12">
        Your inventory register. <span className="text-emerald-400">Finished products</span> carry a base UoM and packaging SKUs; <span className="text-amber-400">raw materials</span> link to suppliers with their UoM and a conversion factor when units differ.
      </p>

      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-600" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, code or category…" className={`${inputCls} pl-9`} />
        </div>
        <div className="flex items-center gap-1 bg-stone-900 border border-stone-800 rounded-lg p-1">
          {([["all", "All"], ["FinishedProduct", "Finished"], ["RawMaterial", "Raw material"]] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setTypeFilter(k)}
              className={`text-[12px] font-medium rounded-md px-2.5 py-1 ${typeFilter === k ? "bg-stone-700 text-stone-100" : "text-stone-400 hover:text-stone-200"}`}>
              {lbl} <span className="text-stone-500">{counts[k as keyof typeof counts]}</span>
            </button>
          ))}
        </div>
      </div>

      {showNew && <NewItemDrawer onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />}

      <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[720px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                <th className="w-8" />
                <th className="text-left px-4 py-2.5">Item name</th>
                <th className="text-left px-4 py-2.5">Category</th>
                <th className="text-left px-4 py-2.5">Base UoM</th>
                <th className="text-left px-4 py-2.5">Item code</th>
                <th className="text-right px-4 py-2.5">Min req. OH qty</th>
                <th className="text-left px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows === null && <tr><td colSpan={7} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
              {rows !== null && filtered.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-stone-500">No items yet — add one with the New item button.</td></tr>}
              {filtered.map(r => (
                <RowGroup key={r.id} item={r} open={expanded === r.id} onToggle={() => setExpanded(expanded === r.id ? null : r.id)} onChanged={load} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function RowGroup({ item, open, onToggle, onChanged }: { item: any; open: boolean; onToggle: () => void; onChanged: () => void }) {
  return (
    <>
      <tr className={`border-b border-stone-800/60 hover:bg-stone-800/30 cursor-pointer ${item.status === "Inactive" ? "opacity-45" : ""}`} onClick={onToggle}>
        <td className="pl-3 text-stone-500">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-stone-100 font-medium">{item.name}</span>
            <TypeBadge t={item.productType} />
          </div>
        </td>
        <td className="px-4 py-2.5 text-stone-400">{item.category || "—"}</td>
        <td className="px-4 py-2.5 text-stone-300 font-mono text-[12px]">{item.baseUom || "—"}</td>
        <td className="px-4 py-2.5 text-stone-400 font-mono text-[12px]">{item.code || "—"}</td>
        <td className="px-4 py-2.5 text-right text-stone-300 tabular-nums">{Number(item.minOhQty ?? 0).toLocaleString()}</td>
        <td className="px-4 py-2.5"><span className={`text-[11px] ${item.status === "Inactive" ? "text-stone-500" : "text-emerald-400"}`}>{item.status || "Active"}</span></td>
      </tr>
      {open && (
        <tr className="border-b border-stone-800/60 bg-stone-950/40">
          <td colSpan={7} className="px-6 py-4">
            {item.productType === "RawMaterial"
              ? <SupplierSkuEditor item={item} onChanged={onChanged} />
              : <SkuEditor item={item} onChanged={onChanged} />}
          </td>
        </tr>
      )}
    </>
  );
}

/* ----------------------------- Finished-product SKUs ----------------------------- */

function SkuEditor({ item, onChanged }: { item: any; onChanged: () => void }) {
  const [skus, setSkus] = useState<any[] | null>(null);
  const [adding, setAdding] = useState(false);
  async function load() {
    const r = await fetch(`/api/inventory/items/${item.id}`).then(x => x.json()).catch(() => null);
    setSkus(r?.skus ?? []);
  }
  useEffect(() => { load(); }, [item.id]);

  async function remove(id: string) {
    await fetch(`/api/inventory/skus?id=${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-stone-300"><Layers size={14} className="text-emerald-400" /> Packaging SKUs <span className="text-stone-500 font-normal">· base UoM {item.baseUom || "—"}</span></div>
        <button onClick={() => setAdding(true)} className="flex items-center gap-1 text-[12px] font-medium text-emerald-400 hover:text-emerald-300"><Plus size={13} /> Add SKU</button>
      </div>
      {!item.baseUom && <p className="text-[12px] text-amber-400 mb-2">Set a base UoM on this item first so packaging can be expressed in it.</p>}
      <div className="rounded-lg border border-stone-800 overflow-hidden">
        <table className="w-full text-[12px]">
          <thead><tr className="text-[10px] uppercase tracking-wide text-stone-500 border-b border-stone-800">
            <th className="text-left px-3 py-2">SKU name</th><th className="text-left px-3 py-2">SKU code</th>
            <th className="text-left px-3 py-2">Pack configuration</th><th className="text-left px-3 py-2">UPC</th><th className="w-8" />
          </tr></thead>
          <tbody>
            {skus === null && <tr><td colSpan={5} className="px-3 py-4 text-center text-stone-500">Loading…</td></tr>}
            {skus !== null && skus.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-stone-500">No SKUs yet.</td></tr>}
            {(skus ?? []).map(s => (
              <tr key={s.id} className="border-b border-stone-800/50">
                <td className="px-3 py-2 text-stone-200">{s.skuName || "—"}</td>
                <td className="px-3 py-2 text-stone-400 font-mono">{s.skuCode || "—"}</td>
                <td className="px-3 py-2 text-stone-300 font-mono text-[11px]">{packConfig({ baseUom: item.baseUom || "", innerSize: s.innerUnitPackSize, innerType: s.innerPackType, unitsAddl: s.unitsInAddlInnerPack, addlType: s.addlInnerPackType, unitsOuter: s.unitsInOuterPack, outerType: s.outerPackType }) || "—"}</td>
                <td className="px-3 py-2 text-stone-400 font-mono">{s.upc || "—"}</td>
                <td className="px-3 py-2"><button onClick={() => remove(s.id)} className="text-stone-600 hover:text-rose-400"><Trash2 size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && <SkuDrawer item={item} onClose={() => setAdding(false)} onCreated={() => { setAdding(false); load(); }} />}
    </div>
  );
}

function SkuDrawer({ item, onClose, onCreated }: { item: any; onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState<Record<string, string>>({ skuName: "", skuCode: "", innerUnitPackSize: "", innerPackType: "", unitsInAddlInnerPack: "", addlInnerPackType: "", unitsInOuterPack: "", outerPackType: "", upc: "" });
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));
  const preview = packConfig({ baseUom: item.baseUom || "", innerSize: Number(f.innerUnitPackSize) || null, innerType: f.innerPackType || null, unitsAddl: Number(f.unitsInAddlInnerPack) || null, addlType: f.addlInnerPackType || null, unitsOuter: Number(f.unitsInOuterPack) || null, outerType: f.outerPackType || null });

  async function save() {
    if (!f.skuName.trim()) { setErr("SKU name is required."); return; }
    setSaving(true); setErr("");
    const r = await fetch(`/api/inventory/skus`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: item.id, ...f }) });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not save."); return; }
    onCreated();
  }

  return (
    <Drawer title="New packaging SKU" onClose={onClose}>
      <p className="text-[12px] text-stone-400 mb-4">Base UoM: <span className="font-mono text-stone-200">{item.baseUom || "not set"}</span>. Define how many base units nest in each container.</p>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>SKU name</label><input className={inputCls} value={f.skuName} onChange={e => set("skuName", e.target.value)} placeholder="e.g. 750ml bottle" /></div>
          <div><label className={labelCls}>SKU code</label><input className={inputCls} value={f.skuCode} onChange={e => set("skuCode", e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Inner unit pack size ({item.baseUom || "base"})</label><input type="number" className={inputCls} value={f.innerUnitPackSize} onChange={e => set("innerUnitPackSize", e.target.value)} placeholder="750" /></div>
          <div><label className={labelCls}>Inner pack type</label><PackTypeSelect value={f.innerPackType} onChange={v => set("innerPackType", v)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Units in addl. inner pack</label><input type="number" className={inputCls} value={f.unitsInAddlInnerPack} onChange={e => set("unitsInAddlInnerPack", e.target.value)} placeholder="optional" /></div>
          <div><label className={labelCls}>Addl. inner pack type</label><PackTypeSelect value={f.addlInnerPackType} onChange={v => set("addlInnerPackType", v)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Units in outer pack</label><input type="number" className={inputCls} value={f.unitsInOuterPack} onChange={e => set("unitsInOuterPack", e.target.value)} placeholder="e.g. 6" /></div>
          <div><label className={labelCls}>Outer pack type</label><PackTypeSelect value={f.outerPackType} onChange={v => set("outerPackType", v)} /></div>
        </div>
        <div><label className={labelCls}>UPC / barcode</label><input className={inputCls} value={f.upc} onChange={e => set("upc", e.target.value)} /></div>
        {preview && <div className="rounded-lg bg-emerald-500/8 border border-emerald-800/40 px-3 py-2 text-[12px] text-emerald-300 font-mono">{preview}</div>}
        {err && <p className="text-[12px] text-rose-400">{err}</p>}
      </div>
      <DrawerFooter saving={saving} onClose={onClose} onSave={save} />
    </Drawer>
  );
}

/* ----------------------------- Raw-material supplier SKUs ----------------------------- */

function SupplierSkuEditor({ item, onChanged }: { item: any; onChanged: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [adding, setAdding] = useState(false);
  async function load() {
    const r = await fetch(`/api/inventory/items/${item.id}`).then(x => x.json()).catch(() => null);
    setRows(r?.supplierSkus ?? []);
  }
  useEffect(() => { load(); }, [item.id]);
  async function remove(id: string) { await fetch(`/api/inventory/supplier-skus?id=${id}`, { method: "DELETE" }); load(); }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-stone-300"><Package size={14} className="text-amber-400" /> Suppliers <span className="text-stone-500 font-normal">· item base UoM {item.baseUom || "—"}</span></div>
        <button onClick={() => setAdding(true)} className="flex items-center gap-1 text-[12px] font-medium text-emerald-400 hover:text-emerald-300"><Plus size={13} /> Link supplier</button>
      </div>
      <div className="rounded-lg border border-stone-800 overflow-hidden">
        <table className="w-full text-[12px]">
          <thead><tr className="text-[10px] uppercase tracking-wide text-stone-500 border-b border-stone-800">
            <th className="text-left px-3 py-2">Supplier</th><th className="text-left px-3 py-2">Supplier UoM</th>
            <th className="text-left px-3 py-2">Supplier SKU</th><th className="text-left px-3 py-2">Pack configuration</th><th className="text-right px-3 py-2">Conv. factor</th><th className="w-8" />
          </tr></thead>
          <tbody>
            {rows === null && <tr><td colSpan={6} className="px-3 py-4 text-center text-stone-500">Loading…</td></tr>}
            {rows !== null && rows.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-stone-500">No suppliers linked yet.</td></tr>}
            {(rows ?? []).map(s => {
              const cross = item.baseUom && s.supplierUom && needsConversionFactor(s.supplierUom, item.baseUom);
              return (
                <tr key={s.id} className="border-b border-stone-800/50">
                  <td className="px-3 py-2 text-stone-200">{s.supplierName || "—"}</td>
                  <td className="px-3 py-2 text-stone-300 font-mono">{s.supplierUom || "—"}</td>
                  <td className="px-3 py-2 text-stone-400 font-mono">{s.supplierSku || "—"}</td>
                  <td className="px-3 py-2 text-stone-300 font-mono text-[11px]">{packConfig({ baseUom: s.supplierUom || "", innerSize: s.innerUnitPackSize, innerType: s.innerPackType, unitsOuter: s.unitsInOuterPack, outerType: s.outerPackType }) || "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{s.conversionFactor ? <span className="text-amber-300">{Number(s.conversionFactor)} {item.baseUom}/{s.supplierUom}</span> : (cross ? <span className="text-rose-400">missing</span> : <span className="text-stone-600">auto</span>)}</td>
                  <td className="px-3 py-2"><button onClick={() => remove(s.id)} className="text-stone-600 hover:text-rose-400"><Trash2 size={13} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {adding && <SupplierSkuDrawer item={item} onClose={() => setAdding(false)} onCreated={() => { setAdding(false); load(); }} />}
    </div>
  );
}

function SupplierSkuDrawer({ item, onClose, onCreated }: { item: any; onClose: () => void; onCreated: () => void }) {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [quick, setQuick] = useState<QuickAddKind | null>(null);
  const [f, setF] = useState<Record<string, string>>({ supplierId: "", supplierUom: "", skuName: "", supplierSku: "", itemCodeBySupplier: "", innerUnitPackSize: "", innerPackType: "", unitsInOuterPack: "", outerPackType: "", conversionFactor: "" });
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  useEffect(() => { fetch(`/api/parties/suppliers?native=1`).then(x => x.json()).then(r => setSuppliers(Array.isArray(r) ? r : [])).catch(() => {}); }, []);

  const crossDim = item.baseUom && f.supplierUom && needsConversionFactor(f.supplierUom, item.baseUom);
  const preview = packConfig({ baseUom: f.supplierUom || "", innerSize: Number(f.innerUnitPackSize) || null, innerType: f.innerPackType || null, unitsOuter: Number(f.unitsInOuterPack) || null, outerType: f.outerPackType || null });

  async function save() {
    if (!f.supplierId) { setErr("Choose a supplier."); return; }
    if (!f.supplierUom) { setErr("Choose the supplier's UoM."); return; }
    if (crossDim && !f.conversionFactor) { setErr(`Supplier UoM "${f.supplierUom}" and item base UoM "${item.baseUom}" are different measures — enter a conversion factor.`); return; }
    setSaving(true); setErr("");
    const r = await fetch(`/api/inventory/supplier-skus`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: item.id, ...f }) });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not save."); return; }
    onCreated();
  }

  return (
    <Drawer title="Link supplier" onClose={onClose}>
      <p className="text-[12px] text-stone-400 mb-4">Item base UoM: <span className="font-mono text-stone-200">{item.baseUom || "not set"}</span>. Record how this supplier sells and packages the material.</p>
      <div className="space-y-4">
        <div>
          <label className={labelCls}>Supplier</label>
          <select className={inputCls} value={f.supplierId} onChange={e => { if (e.target.value === "__add__") { setQuick("supplier"); return; } set("supplierId", e.target.value); }}>
            <option value="">Select supplier…</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value="__add__">+ Add new supplier…</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Supplier's base UoM</label><UomSelect value={f.supplierUom} onChange={v => set("supplierUom", v)} /></div>
          <div><label className={labelCls}>Supplier SKU</label><input className={inputCls} value={f.supplierSku} onChange={e => set("supplierSku", e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>SKU name</label><input className={inputCls} value={f.skuName} onChange={e => set("skuName", e.target.value)} placeholder="e.g. 25kg sack" /></div>
          <div><label className={labelCls}>Item code by supplier</label><input className={inputCls} value={f.itemCodeBySupplier} onChange={e => set("itemCodeBySupplier", e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Inner unit pack size ({f.supplierUom || "supplier UoM"})</label><input type="number" className={inputCls} value={f.innerUnitPackSize} onChange={e => set("innerUnitPackSize", e.target.value)} /></div>
          <div><label className={labelCls}>Inner pack type</label><PackTypeSelect value={f.innerPackType} onChange={v => set("innerPackType", v)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Units in outer pack</label><input type="number" className={inputCls} value={f.unitsInOuterPack} onChange={e => set("unitsInOuterPack", e.target.value)} /></div>
          <div><label className={labelCls}>Outer pack type</label><PackTypeSelect value={f.outerPackType} onChange={v => set("outerPackType", v)} /></div>
        </div>
        {preview && <div className="rounded-lg bg-amber-500/8 border border-amber-800/40 px-3 py-2 text-[12px] text-amber-300 font-mono">{preview}</div>}
        {crossDim && (
          <div className="rounded-lg bg-rose-500/8 border border-rose-800/40 px-3 py-3">
            <label className={`${labelCls} text-rose-300`}>Conversion factor required</label>
            <p className="text-[11px] text-stone-400 mb-2">Supplier uses <span className="font-mono text-stone-200">{f.supplierUom}</span> but the item is measured in <span className="font-mono text-stone-200">{item.baseUom}</span> — these are different measures. Enter how many <span className="font-mono">{item.baseUom}</span> equal one <span className="font-mono">{f.supplierUom}</span>.</p>
            <div className="flex items-center gap-2">
              <input type="number" className={`${inputCls} max-w-[160px]`} value={f.conversionFactor} onChange={e => set("conversionFactor", e.target.value)} placeholder="e.g. 0.4536" />
              <span className="text-[12px] text-stone-400 font-mono">{item.baseUom} per 1 {f.supplierUom}</span>
            </div>
          </div>
        )}
        {err && <p className="text-[12px] text-rose-400">{err}</p>}
      </div>
      <DrawerFooter saving={saving} onClose={onClose} onSave={save} />
      {quick && <QuickAdd kind={quick} onClose={() => setQuick(null)} onCreated={(row) => { setSuppliers(p => [...p, row]); set("supplierId", row.id); setQuick(null); }} />}
    </Drawer>
  );
}

/* ----------------------------- New item drawer ----------------------------- */

function NewItemDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [taxes, setTaxes] = useState<any[]>([]);
  const [quick, setQuick] = useState<QuickAddKind | null>(null);
  const [f, setF] = useState<Record<string, string>>({ name: "", productType: "FinishedProduct", baseUom: "", category: "", code: "", minOhQty: "0", unitPrice: "", unitCost: "", incomeAccountId: "", expenseAccountId: "", taxRateId: "" });
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  useEffect(() => {
    fetch(`/api/accounting/accounts`).then(x => x.json()).then(r => setAccounts(Array.isArray(r) ? r : [])).catch(() => {});
    fetch(`/api/accounting/tax-rates`).then(x => x.json()).then(r => setTaxes(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);

  const isRM = f.productType === "RawMaterial";
  const incomeAccts = accounts.filter(a => ["Income", "Other Income"].includes(a.type));
  const expenseAccts = accounts.filter(a => ["Expense", "Cost of Goods Sold", "Other Expense"].includes(a.type));

  async function save() {
    if (!f.name.trim()) { setErr("Item name is required."); return; }
    setSaving(true); setErr("");
    const r = await fetch(`/api/inventory/items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not save."); return; }
    onCreated();
  }

  return (
    <Drawer title="New item" onClose={onClose} wide>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={() => set("productType", "FinishedProduct")}
            className={`rounded-lg border p-3 text-left ${!isRM ? "border-emerald-600 bg-emerald-500/8" : "border-stone-700 hover:border-stone-600"}`}>
            <div className="flex items-center gap-2 text-[13px] font-semibold text-stone-100"><Layers size={15} className="text-emerald-400" /> Finished product</div>
            <p className="text-[11px] text-stone-400 mt-1">What you sell. Set a base UoM; define packaging SKUs.</p>
          </button>
          <button type="button" onClick={() => set("productType", "RawMaterial")}
            className={`rounded-lg border p-3 text-left ${isRM ? "border-amber-600 bg-amber-500/8" : "border-stone-700 hover:border-stone-600"}`}>
            <div className="flex items-center gap-2 text-[13px] font-semibold text-stone-100"><Package size={15} className="text-amber-400" /> Raw material</div>
            <p className="text-[11px] text-stone-400 mt-1">What you buy. Link suppliers with their UoM & packaging.</p>
          </button>
        </div>

        <div><label className={labelCls}>Item name</label><input className={inputCls} value={f.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Olive Oil" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Base UoM</label><UomSelect value={f.baseUom} onChange={v => set("baseUom", v)} /></div>
          <div><label className={labelCls}>Category</label><input className={inputCls} value={f.category} onChange={e => set("category", e.target.value)} placeholder="e.g. Oils" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Item code</label><input className={inputCls} value={f.code} onChange={e => set("code", e.target.value)} /></div>
          <div><label className={labelCls}>Min required on-hand qty</label><input type="number" className={inputCls} value={f.minOhQty} onChange={e => set("minOhQty", e.target.value)} /></div>
        </div>

        <div className="pt-2 border-t border-stone-800">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-500 mb-3">Accounting</div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Sales price</label><input type="number" className={inputCls} value={f.unitPrice} onChange={e => set("unitPrice", e.target.value)} /></div>
            <div><label className={labelCls}>Cost</label><input type="number" className={inputCls} value={f.unitCost} onChange={e => set("unitCost", e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            {!isRM && (
              <div><label className={labelCls}>Income account</label>
                <select className={inputCls} value={f.incomeAccountId} onChange={e => { if (e.target.value === "__add__") { setQuick("account-income"); return; } set("incomeAccountId", e.target.value); }}>
                  <option value="">Select…</option>
                  {incomeAccts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  <option value="__add__">+ Add new income account…</option>
                </select>
              </div>
            )}
            <div><label className={labelCls}>{isRM ? "Expense / COGS account" : "Expense account"}</label>
              <select className={inputCls} value={f.expenseAccountId} onChange={e => { if (e.target.value === "__add__") { setQuick("account-expense"); return; } set("expenseAccountId", e.target.value); }}>
                <option value="">Select…</option>
                {expenseAccts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                <option value="__add__">+ Add new expense account…</option>
              </select>
            </div>
            <div><label className={labelCls}>Tax rate</label>
              <select className={inputCls} value={f.taxRateId} onChange={e => { if (e.target.value === "__add__") { setQuick("tax"); return; } set("taxRateId", e.target.value); }}>
                <option value="">Select…</option>
                {taxes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                <option value="__add__">+ Add new tax rate…</option>
              </select>
            </div>
          </div>
        </div>
        {err && <p className="text-[12px] text-rose-400">{err}</p>}
      </div>
      <DrawerFooter saving={saving} onClose={onClose} onSave={save} saveLabel="Create item" />
      {quick && <QuickAdd kind={quick} accounts={accounts} taxes={taxes}
        onClose={() => setQuick(null)}
        onCreated={(row) => {
          if (quick === "account-income") { setAccounts(p => [...p, row]); set("incomeAccountId", row.id); }
          else if (quick === "account-expense") { setAccounts(p => [...p, row]); set("expenseAccountId", row.id); }
          else if (quick === "tax") { setTaxes(p => [...p, row]); set("taxRateId", row.id); }
          setQuick(null);
        }} />}
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
      <div className={`relative bg-stone-900 border-l border-stone-800 h-full overflow-y-auto shadow-2xl ${wide ? "w-full max-w-lg" : "w-full max-w-md"}`} onMouseDown={e => e.stopPropagation()}>
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
