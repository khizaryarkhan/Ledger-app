"use client";

/**
 * Shipping — post shipments (Dr COGS / Cr Inventory at FIFO cost) against a
 * Sales Order or ad-hoc, then create an Invoice from shipped-but-uninvoiced
 * shipments (Dr A/R / Cr Revenue). Supports partial shipments and invoicing
 * across multiple SOs.
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Truck, X, Loader, Check, Trash2, FileText } from "lucide-react";
import { kindOf } from "@/lib/inventory/item-kinds";
import { fmt } from "@/lib/format";
import { Field, Section, SelectField, controlInset, th } from "@/components/form-kit";

const money = fmt.num2;

export function ShippingConsole() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [invoicing, setInvoicing] = useState(false);

  async function load() {
    const r = await fetch(`/api/inventory/shipping`).then(x => x.json()).catch(() => []);
    setRows(Array.isArray(r) ? r : []);
  }
  useEffect(() => {
    load();
    fetch(`/api/parties/customers?native=1`).then(x => x.json()).then(r => setCustomers(Array.isArray(r) ? r : [])).catch(() => {});
    fetch(`/api/inventory/items`).then(x => x.json()).then(r => setItems(Array.isArray(r) ? r.filter((i: any) => kindOf(i.productType).tracked) : [])).catch(() => {});
  }, []);
  useEffect(() => { if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1") setShowNew(true); }, []);

  async function voidRow(id: string, no: string) {
    if (!confirm(`Void shipment ${no}? This puts the stock back and reverses its GL entry.`)) return;
    const r = await fetch(`/api/inventory/shipping/${id}`, { method: "DELETE" });
    if (!r.ok) { alert((await r.json().catch(() => ({})))?.error || "Could not void shipment."); return; }
    load();
  }
  const selected = (rows ?? []).filter(r => sel[r.id]);
  const selCustomers = [...new Set(selected.map(r => r.customerId ?? "—"))];
  const canInvoice = selected.length > 0 && selCustomers.length === 1 && selected.every(r => r.open > 0.005);

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-violet-500/15 flex items-center justify-center"><Truck size={18} className="text-violet-400" /></div>
          <h1 className="text-xl font-semibold text-stone-100">Shipping</h1>
        </div>
        <div className="flex items-center gap-2">
          {Object.values(sel).some(Boolean) && (
            <button disabled={!canInvoice} onClick={() => setInvoicing(true)} className="flex items-center gap-1.5 text-[13px] font-semibold bg-stone-100 text-stone-900 rounded-lg px-3.5 py-2 hover:bg-white disabled:opacity-40" title={canInvoice ? "" : "Select uninvoiced shipments from one customer"}>
              <FileText size={14} /> Invoice {selected.length} shipment{selected.length > 1 ? "s" : ""}
            </button>
          )}
          <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={rows === null ? "animate-spin" : ""} /></button>
          <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-2 hover:bg-emerald-700"><Plus size={14} /> Ship stock</button>
        </div>
      </div>
      <p className="text-sm text-stone-400 mb-5 ml-12">Fulfil customer orders — against a Sales Order or ad-hoc. COGS is recognised here (Dr COGS / Cr Inventory). Then tick shipments and create an Invoice for the revenue.</p>

      {showNew && <ShipDrawer customers={customers} items={items} onClose={() => setShowNew(false)} onDone={() => { setShowNew(false); load(); }} />}
      {invoicing && <InvoiceDrawer shipments={selected} onClose={() => setInvoicing(false)} onDone={() => { setInvoicing(false); setSel({}); load(); }} />}

      <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[760px]">
            <thead>
              <tr className="border-b border-stone-800">
                <th className="w-8" />
                <th className={th}>Shipment #</th>
                <th className={th}>Customer</th>
                <th className={th}>Date</th>
                <th className={`${th} !text-right`}>COGS</th>
                <th className={`${th} !text-right`}>Sale value</th>
                <th className={`${th} !text-right`}>Invoiced</th>
                <th className={`${th} !text-right`}>Awaiting invoice</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows === null && <tr><td colSpan={8} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
              {rows !== null && rows.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-stone-500">No shipments yet — record one with Ship stock.</td></tr>}
              {(rows ?? []).map(r => (
                <tr key={r.id} className="border-b border-stone-800/60 hover:bg-stone-950/40">
                  <td className="pl-3">{r.open > 0.005 && <input type="checkbox" checked={!!sel[r.id]} onChange={e => setSel(s => ({ ...s, [r.id]: e.target.checked }))} className="accent-emerald-600" />}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-stone-200">{r.shipmentNo || r.id.slice(0, 8)}</td>
                  <td className="px-4 py-2.5 text-stone-200">{r.customerLabel || "—"}</td>
                  <td className="px-4 py-2.5 text-stone-400">{r.shipmentDate}</td>
                  <td className="px-4 py-2.5 text-right text-stone-400 tabular-nums">{money(r.cogsTotal)}</td>
                  <td className="px-4 py-2.5 text-right text-stone-300 tabular-nums">{money(r.saleTotal)}</td>
                  <td className="px-4 py-2.5 text-right text-stone-400 tabular-nums">{money(r.invoicedAmount)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums"><span className={r.open > 0.005 ? "text-amber-400" : "text-stone-500"}>{money(r.open)}</span></td>
                  <td className="px-2 py-2.5"><button onClick={() => voidRow(r.id, r.shipmentNo || r.id.slice(0, 8))} className="p-1 rounded hover:bg-stone-700 text-stone-600 hover:text-rose-400" title="Void shipment"><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

type SLine = { key: string; itemId: string; itemName: string; baseUom: string | null; skuId: string | null; soId: string | null; soLineId: string | null; qtyBase: string; saleRate: string; taxRateId: string | null };
let keySeq = 0;
const newKey = () => `s${keySeq++}`;

function ShipDrawer({ customers, items, onClose, onDone }: { customers: any[]; items: any[]; onClose: () => void; onDone: () => void }) {
  const [customerId, setCustomerId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [currency, setCurrency] = useState("");
  const [rate, setRate] = useState("1");
  const [openSos, setOpenSos] = useState<any[]>([]);
  const [lines, setLines] = useState<SLine[]>([]);
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
  const customer = customers.find(c => c.id === customerId);

  useEffect(() => {
    const url = customerId ? `/api/inventory/so-open?customerId=${customerId}` : `/api/inventory/so-open`;
    fetch(url).then(x => x.json()).then(r => setOpenSos(Array.isArray(r) ? r : [])).catch(() => setOpenSos([]));
  }, [customerId]);

  function pullSo(so: any) {
    if (so.currency) { setCurrency(so.currency); setRate(String(so.exchangeRate || 1)); }
    if (!customerId && so.partyId) setCustomerId(so.partyId);
    setLines(ls => [...ls, ...so.lines.map((l: any) => ({ key: newKey(), itemId: l.itemId, itemName: l.itemName, baseUom: l.baseUom, skuId: l.skuId ?? null, soId: so.id, soLineId: l.lineId, qtyBase: String(l.remainingQty), saleRate: String(l.saleRateBase), taxRateId: l.taxRateId }))]);
  }
  function addAdhoc() { setLines(ls => [...ls, { key: newKey(), itemId: "", itemName: "", baseUom: null, skuId: null, soId: null, soLineId: null, qtyBase: "", saleRate: "", taxRateId: null }]); }
  function setLine(key: string, patch: Partial<SLine>) { setLines(ls => ls.map(l => l.key === key ? { ...l, ...patch } : l)); }
  function onItem(key: string, itemId: string) { const it = items.find(x => x.id === itemId); setLine(key, { itemId, itemName: it?.name ?? "", baseUom: it?.baseUom ?? null, saleRate: it?.unitPrice != null ? String(it.unitPrice) : "" }); }

  const total = useMemo(() => lines.reduce((s, l) => s + (Number(l.qtyBase) || 0) * (Number(l.saleRate) || 0), 0), [lines]);

  async function save() {
    const payloadLines = lines.filter(l => l.itemId && Number(l.qtyBase) > 0).map(l => ({
      itemId: l.itemId, skuId: l.skuId, soId: l.soId, soLineId: l.soLineId, description: l.itemName,
      qtyBase: Number(l.qtyBase), saleRate: Number(l.saleRate) || 0, taxRateId: l.taxRateId,
    }));
    if (!payloadLines.length) { setErr("Add at least one line with an item and quantity."); return; }
    setSaving(true); setErr("");
    const r = await fetch(`/api/inventory/shipping`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId: customerId || null, customerLabel: customer?.name ?? null, shipmentDate: date, currency: currency || null, exchangeRate: Number(rate) || 1, lines: payloadLines }) });
    const d = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) { setErr(d?.error || "Could not post shipment."); return; }
    if (d.pending) { alert("This shipment exceeds your org's approval threshold and has been submitted for approval — nothing has posted yet. See Approvals."); onDone(); return; }
    onDone();
  }

  return (
    <Drawer title="Ship stock" onClose={onClose} wide>
      <div className="space-y-5">
        <Section title="Customer & date">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Field label="Customer">
              <SelectField inset value={customerId} onChange={e => setCustomerId(e.target.value)}>
                <option value="">— (optional)</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </SelectField>
            </Field>
            <Field label="Shipment date"><input type="date" className={controlInset} value={date} onChange={e => setDate(e.target.value)} /></Field>
          </div>
        </Section>

        {openSos.length > 0 && (
          <div className="rounded-lg border border-stone-800 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-500 mb-2">Open sales orders — pull lines to ship</div>
            <div className="space-y-1.5">
              {openSos.map(so => (
                <div key={so.id} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="text-stone-300">{so.docNumber || so.id.slice(0, 8)} · {so.partyLabel || "—"} <span className="text-stone-500">({so.lines.length} line{so.lines.length > 1 ? "s" : ""} to ship)</span></span>
                  <button onClick={() => pullSo(so)} className="text-emerald-400 hover:text-emerald-300 font-medium">Pull →</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <Section
          title={`Lines to ship${currency && currency !== "" ? ` · ${currency}` : ""}`}
          right={<button onClick={addAdhoc} className="flex items-center gap-1 text-[12px] font-medium text-emerald-400 hover:text-emerald-300"><Plus size={13} /> Add line (no SO)</button>}
        >
          {lines.length === 0 && <p className="text-[12px] text-stone-500">Pull lines from a sales order above, or add ad-hoc lines to ship without an SO.</p>}
          <div className="space-y-2">
            {lines.map(l => (
              <div key={l.key} className="rounded-lg border border-stone-800 p-2.5">
                <div className="flex items-center gap-2 mb-2">
                  {l.soLineId ? <span className="text-[12.5px] font-medium text-stone-100">{l.itemName}</span>
                    : <div className="flex-1"><SelectField inset className="!h-8" value={l.itemId} onChange={e => onItem(l.key, e.target.value)}><option value="">Select item…</option>{items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</SelectField></div>}
                  {l.soId && <span className="text-[10px] text-violet-400 border border-violet-800/50 rounded px-1.5 py-0.5">from SO</span>}
                  <button onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))} className="ml-auto text-stone-600 hover:text-rose-400"><Trash2 size={13} /></button>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                  <Field label={`Qty (${l.baseUom || "base"})`}><input type="number" className={`${controlInset} !h-8`} value={l.qtyBase} onChange={e => setLine(l.key, { qtyBase: e.target.value })} /></Field>
                  <Field label={`Sale price / ${l.baseUom || "unit"}`}><input type="number" className={`${controlInset} !h-8`} value={l.saleRate} onChange={e => setLine(l.key, { saleRate: e.target.value })} /></Field>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {currency && currency !== "" && (
          <Section title="Currency">
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <Field label="Currency"><input className={controlInset} value={currency} onChange={e => setCurrency(e.target.value)} /></Field>
              <Field label="Exchange rate → home"><input type="number" className={controlInset} value={rate} onChange={e => setRate(e.target.value)} /></Field>
            </div>
          </Section>
        )}

        <div className="rounded-lg bg-violet-500/8 border border-violet-800/40 px-4 py-2.5 text-[12px] text-stone-300">Sale value → <span className="font-semibold text-violet-300">{money(total)}</span> {currency && currency !== "" ? currency : ""} · posts Dr COGS / Cr Inventory at cost now; revenue on invoice</div>
        {err && <p className="text-[12px] text-rose-400">{err}</p>}
      </div>
      <DrawerFooter saving={saving} onClose={onClose} onSave={save} saveLabel="Post shipment" />
    </Drawer>
  );
}

function InvoiceDrawer({ shipments, onClose, onDone }: { shipments: any[]; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
  const total = shipments.reduce((s, r) => s + Number(r.open || 0), 0);

  async function save() {
    setSaving(true); setErr("");
    const r = await fetch(`/api/inventory/shipping/invoice`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shipmentIds: shipments.map(x => x.id), invoiceDate: date, dueDate: dueDate || null, reference: reference || null }) });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not create invoice."); return; }
    onDone();
  }

  return (
    <Drawer title="Invoice shipments" onClose={onClose}>
      <p className="text-[12px] text-stone-400 mb-4">Invoicing {shipments.length} shipment{shipments.length > 1 ? "s" : ""} for <span className="text-stone-200">{shipments[0]?.customerLabel || "customer"}</span>. Posts Dr A/R / Cr Revenue (COGS already recognised at shipment).</p>
      <div className="space-y-5">
        <Section title="Invoice details">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Field label="Invoice date"><input type="date" className={controlInset} value={date} onChange={e => setDate(e.target.value)} /></Field>
            <Field label="Due date"><input type="date" className={controlInset} value={dueDate} onChange={e => setDueDate(e.target.value)} /></Field>
            <Field label="Reference / customer PO" className="col-span-2"><input className={controlInset} value={reference} onChange={e => setReference(e.target.value)} /></Field>
          </div>
        </Section>
        <div className="rounded-lg bg-stone-800/50 border border-stone-700 px-4 py-2.5 text-[12px] text-stone-300">Revenue to invoice → <span className="font-semibold text-stone-100">{money(total)}</span></div>
        {err && <p className="text-[12px] text-rose-400">{err}</p>}
      </div>
      <DrawerFooter saving={saving} onClose={onClose} onSave={save} saveLabel="Create invoice" />
    </Drawer>
  );
}

function Drawer({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", on); return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className={`relative bg-stone-900 border-l border-stone-800 h-full overflow-y-auto shadow-2xl w-full ${wide ? "max-w-2xl" : "max-w-md"}`} onMouseDown={e => e.stopPropagation()}>
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
