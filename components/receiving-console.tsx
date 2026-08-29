"use client";

/**
 * Receiving — post goods receipts (Dr Inventory / Cr GR/IR) against a PO or
 * ad-hoc, capturing lot/batch numbers, then create a Bill from received-but-
 * unbilled receipts (clears GR/IR → A/P). Supports partial receipts and
 * receiving/billing across multiple POs.
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, PackageCheck, X, Loader, Check, Trash2, FileText } from "lucide-react";
import { kindOf } from "@/lib/inventory/item-kinds";
import { fmt } from "@/lib/format";
import { Field, Section, SelectField, controlInset, th } from "@/components/form-kit";

const money = fmt.num2;

export function ReceivingConsole() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [taxes, setTaxes] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [billing, setBilling] = useState(false);
  const [voidErr, setVoidErr] = useState("");

  async function load() {
    const r = await fetch(`/api/inventory/receiving`).then(x => x.json()).catch(() => []);
    setRows(Array.isArray(r) ? r : []);
  }
  useEffect(() => {
    load();
    fetch(`/api/parties/suppliers?native=1`).then(x => x.json()).then(r => setSuppliers(Array.isArray(r) ? r : [])).catch(() => {});
    fetch(`/api/inventory/items`).then(x => x.json()).then(r => setItems(Array.isArray(r) ? r.filter((i: any) => kindOf(i.productType).tracked) : [])).catch(() => {});
    fetch(`/api/accounting/tax-rates`).then(x => x.json()).then(r => setTaxes(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);
  useEffect(() => { if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1") setShowNew(true); }, []);

  async function voidRow(id: string, no: string) {
    if (!confirm(`Void receipt ${no}? This reverses the stock and its GL entry.`)) return;
    setVoidErr("");
    const r = await fetch(`/api/inventory/receiving/${id}`, { method: "DELETE" });
    if (!r.ok) { setVoidErr((await r.json().catch(() => ({})))?.error || "Could not void receipt."); return; }
    load();
  }
  const selectedIds = Object.keys(sel).filter(k => sel[k]);
  const selectedReceipts = (rows ?? []).filter(r => sel[r.id]);
  const selSuppliers = [...new Set(selectedReceipts.map(r => r.supplierId ?? "—"))];
  const canBill = selectedReceipts.length > 0 && selSuppliers.length === 1 && selectedReceipts.every(r => r.open > 0.005);

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-cyan-500/15 flex items-center justify-center"><PackageCheck size={18} className="text-cyan-400" /></div>
          <h1 className="text-xl font-semibold text-stone-100">Receiving</h1>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.length > 0 && (
            <button disabled={!canBill} onClick={() => setBilling(true)} className="flex items-center gap-1.5 text-[13px] font-semibold bg-stone-100 text-stone-900 rounded-lg px-3.5 py-2 hover:bg-white disabled:opacity-40" title={canBill ? "" : "Select unbilled receipts from one supplier"}>
              <FileText size={14} /> Bill {selectedIds.length} receipt{selectedIds.length > 1 ? "s" : ""}
            </button>
          )}
          <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={rows === null ? "animate-spin" : ""} /></button>
          <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-2 hover:bg-emerald-700"><Plus size={14} /> Receive stock</button>
        </div>
      </div>
      <p className="text-sm text-stone-400 mb-5 ml-12">Record goods received into stock — against a PO or ad-hoc. Then tick received receipts and create a Bill to clear the GR/IR accrual to Accounts Payable.</p>
      {voidErr && <div className="mb-4 text-[12.5px] text-rose-400 bg-rose-950/30 border border-rose-900 rounded-lg px-3 py-2">{voidErr}</div>}

      {showNew && <ReceiveDrawer suppliers={suppliers} items={items} onClose={() => setShowNew(false)} onDone={() => { setShowNew(false); load(); }} />}
      {billing && <BillDrawer receipts={selectedReceipts} taxes={taxes} onClose={() => setBilling(false)} onDone={() => { setBilling(false); setSel({}); load(); }} />}

      <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[720px]">
            <thead>
              <tr className="border-b border-stone-800">
                <th className="w-8" />
                <th className={th}>Receipt #</th>
                <th className={th}>Supplier</th>
                <th className={th}>Date</th>
                <th className={`${th} !text-right`}>Received value</th>
                <th className={`${th} !text-right`}>Billed</th>
                <th className={`${th} !text-right`}>Awaiting bill</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows === null && <tr><td colSpan={7} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
              {rows !== null && rows.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-stone-500">No goods receipts yet — record one with Receive stock.</td></tr>}
              {(rows ?? []).map(r => (
                <tr key={r.id} className="border-b border-stone-800/60 hover:bg-stone-800/20">
                  <td className="pl-3">{r.open > 0.005 && <input type="checkbox" checked={!!sel[r.id]} onChange={e => setSel(s => ({ ...s, [r.id]: e.target.checked }))} className="accent-emerald-600" />}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-stone-200">{r.receiptNo || r.id.slice(0, 8)}</td>
                  <td className="px-4 py-2.5 text-stone-200">{r.supplierLabel || "—"}</td>
                  <td className="px-4 py-2.5 text-stone-400">{r.receiptDate}</td>
                  <td className="px-4 py-2.5 text-right text-stone-300 tabular-nums">{money(r.grirTotal)}</td>
                  <td className="px-4 py-2.5 text-right text-stone-400 tabular-nums">{money(r.billedAmount)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums"><span className={r.open > 0.005 ? "text-amber-400" : "text-stone-500"}>{money(r.open)}</span></td>
                  <td className="px-2 py-2.5"><button onClick={() => voidRow(r.id, r.receiptNo || r.id.slice(0, 8))} className="p-1 rounded hover:bg-stone-700 text-stone-600 hover:text-rose-400" title="Void receipt"><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

type RLine = { key: string; itemId: string; itemName: string; baseUom: string | null; skuId: string | null; poId: string | null; poLineId: string | null; qtyBase: string; unitCost: string; lotNo: string; expiryDate: string };
let keySeq = 0;
const newKey = () => `l${keySeq++}`;

function ReceiveDrawer({ suppliers, items, onClose, onDone }: { suppliers: any[]; items: any[]; onClose: () => void; onDone: () => void }) {
  const [supplierId, setSupplierId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [currency, setCurrency] = useState("");
  const [rate, setRate] = useState("1");
  const [openPos, setOpenPos] = useState<any[]>([]);
  const [lines, setLines] = useState<RLine[]>([]);
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
  const [pendingMsg, setPendingMsg] = useState("");
  const supplier = suppliers.find(s => s.id === supplierId);

  useEffect(() => {
    const url = supplierId ? `/api/inventory/po-open?supplierId=${supplierId}` : `/api/inventory/po-open`;
    fetch(url).then(x => x.json()).then(r => setOpenPos(Array.isArray(r) ? r : [])).catch(() => setOpenPos([]));
  }, [supplierId]);

  async function pullPo(po: any) {
    if (po.currency) { setCurrency(po.currency); setRate(String(po.exchangeRate || 1)); }
    if (!supplierId && po.partyId) setSupplierId(po.partyId);
    const newLines = po.lines.map((l: any) => ({
      key: newKey(), itemId: l.itemId, itemName: l.itemName, baseUom: l.baseUom, skuId: l.skuId ?? null, poId: po.id, poLineId: l.lineId,
      qtyBase: String(l.remainingQty), unitCost: String(l.unitCostBase), lotNo: "", expiryDate: "",
    }));
    setLines(ls => [...ls, ...newLines]);
    // Pre-fill a suggested lot code for each non-FP/WIP line (one peek per
    // line so each gets its own suggestion, not the same code repeated).
    for (const nl of newLines) {
      const it = items.find(x => x.id === nl.itemId);
      if (it && !isFPWIP(it)) {
        const suggestion = await fetch(`/api/inventory/lot-suggestion`).then(r => r.json()).catch(() => null);
        if (suggestion?.code) setLine(nl.key, { lotNo: suggestion.code });
      }
    }
  }
  function addAdhoc() { setLines(ls => [...ls, { key: newKey(), itemId: "", itemName: "", baseUom: null, skuId: null, poId: null, poLineId: null, qtyBase: "", unitCost: "", lotNo: "", expiryDate: "" }]); }
  function setLine(key: string, patch: Partial<RLine>) { setLines(ls => ls.map(l => l.key === key ? { ...l, ...patch } : l)); }
  // Finished Product / Work in Progress lots are always system-generated at
  // commit time (never editable here); Stock Item / Raw Material get a
  // suggested code pre-filled — accept it or overwrite with the supplier's
  // own batch number.
  function isFPWIP(it: any) { return ["FinishedProduct", "WorkInProgress"].includes(kindOf(it?.productType).kind); }
  async function onItem(key: string, itemId: string) {
    const it = items.find(x => x.id === itemId);
    setLine(key, { itemId, itemName: it?.name ?? "", baseUom: it?.baseUom ?? null, unitCost: it?.unitCost != null ? String(it.unitCost) : "", lotNo: "" });
    if (it && !isFPWIP(it)) {
      const suggestion = await fetch(`/api/inventory/lot-suggestion`).then(r => r.json()).catch(() => null);
      if (suggestion?.code) setLine(key, { lotNo: suggestion.code });
    }
  }

  const total = useMemo(() => lines.reduce((s, l) => s + (Number(l.qtyBase) || 0) * (Number(l.unitCost) || 0), 0), [lines]);

  async function save() {
    const payloadLines = lines.filter(l => l.itemId && Number(l.qtyBase) > 0).map(l => ({
      itemId: l.itemId, skuId: l.skuId, poId: l.poId, poLineId: l.poLineId, description: l.itemName,
      qtyBase: Number(l.qtyBase), unitCost: Number(l.unitCost) || 0, lotNo: l.lotNo || null, expiryDate: l.expiryDate || null,
    }));
    if (!payloadLines.length) { setErr("Add at least one line with an item and quantity."); return; }
    setSaving(true); setErr("");
    const r = await fetch(`/api/inventory/receiving`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supplierId: supplierId || null, supplierLabel: supplier?.name ?? null, receiptDate: date, currency: currency || null, exchangeRate: Number(rate) || 1, lines: payloadLines }) });
    const d = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) { setErr(d?.error || "Could not post receipt."); return; }
    if (d.pending) { setPendingMsg("This receipt exceeds your org's approval threshold and has been submitted for approval — nothing has posted yet. See Approvals."); return; }
    onDone();
  }

  return (
    <Drawer title="Receive stock" onClose={onClose} wide>
      <div className="space-y-5">
        <Section title="Supplier & date">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Field label="Supplier">
              <SelectField inset value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                <option value="">— (optional)</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </SelectField>
            </Field>
            <Field label="Receipt date">
              <input type="date" className={controlInset} value={date} onChange={e => setDate(e.target.value)} />
            </Field>
          </div>
        </Section>

        {openPos.length > 0 && (
          <Section title="Open purchase orders" desc="Pull lines to receive">
            <div className="rounded-lg border border-stone-800 p-3">
              <div className="space-y-1.5">
                {openPos.map(po => (
                  <div key={po.id} className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="text-stone-300">{po.docNumber || po.id.slice(0, 8)} · {po.partyLabel || "—"} <span className="text-stone-500">({po.lines.length} line{po.lines.length > 1 ? "s" : ""} to receive)</span></span>
                    <button onClick={() => pullPo(po)} className="text-emerald-400 hover:text-emerald-300 font-medium">Pull →</button>
                  </div>
                ))}
              </div>
            </div>
          </Section>
        )}

        <Section
          title={`Lines to receive${currency && currency !== "" ? ` · ${currency}` : ""}`}
          right={<button onClick={addAdhoc} className="flex items-center gap-1 text-[12px] font-medium text-emerald-400 hover:text-emerald-300"><Plus size={13} /> Add line (no PO)</button>}
        >
          {lines.length === 0 && <p className="text-[12px] text-stone-500">Pull lines from a PO above, or add ad-hoc lines to receive without a PO.</p>}
          <div className="space-y-2">
            {lines.map(l => (
              <div key={l.key} className="rounded-lg border border-stone-800 p-3">
                <div className="flex items-center gap-2 mb-3">
                  {l.poLineId ? <span className="text-[12.5px] font-medium text-stone-100">{l.itemName}</span>
                    : <SelectField inset className="!h-8" value={l.itemId} onChange={e => onItem(l.key, e.target.value)}><option value="">Select item…</option>{items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</SelectField>}
                  {l.poId && <span className="text-[10px] text-cyan-400 border border-cyan-800/50 rounded px-1.5 py-0.5">from PO</span>}
                  <button onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))} className="ml-auto text-stone-600 hover:text-rose-400"><Trash2 size={13} /></button>
                </div>
                <div className="grid grid-cols-4 gap-x-4 gap-y-4">
                  <Field label={`Qty (${l.baseUom || "base"})`}><input type="number" className={`${controlInset} !h-8`} value={l.qtyBase} onChange={e => setLine(l.key, { qtyBase: e.target.value })} /></Field>
                  <Field label="Unit cost"><input type="number" className={`${controlInset} !h-8`} value={l.unitCost} onChange={e => setLine(l.key, { unitCost: e.target.value })} /></Field>
                  <Field label="Lot / batch no.">
                    {isFPWIP(items.find(x => x.id === l.itemId)) ? (
                      <input className={`${controlInset} !h-8 opacity-60`} value="assigned automatically" disabled />
                    ) : (
                      <input className={`${controlInset} !h-8`} value={l.lotNo} onChange={e => setLine(l.key, { lotNo: e.target.value })} />
                    )}
                  </Field>
                  <Field label="Expiry"><input type="date" className={`${controlInset} !h-8`} value={l.expiryDate} onChange={e => setLine(l.key, { expiryDate: e.target.value })} /></Field>
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

        <div className="rounded-lg bg-cyan-500/8 border border-cyan-800/40 px-4 py-2.5 text-[12px] text-stone-300">Receipt value → <span className="font-semibold text-cyan-300">{money(total)}</span> {currency && currency !== "" ? currency : ""} · posts Dr Inventory / Cr GR/IR</div>
        {err && <p className="text-[12px] text-rose-400">{err}</p>}
        {pendingMsg && <p className="text-[12px] text-amber-400 bg-amber-950/30 border border-amber-900 rounded-lg px-3 py-2">{pendingMsg}</p>}
      </div>
      <DrawerFooter saving={saving} onClose={pendingMsg ? onDone : onClose} onSave={save} saveLabel="Post receipt" pendingMsg={pendingMsg} />
    </Drawer>
  );
}

function BillDrawer({ receipts, taxes, onClose, onDone }: { receipts: any[]; taxes: any[]; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [reference, setReference] = useState("");
  const [taxRateId, setTaxRateId] = useState("");
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
  const total = receipts.reduce((s, r) => s + Number(r.open || 0), 0);

  async function save() {
    setSaving(true); setErr("");
    const r = await fetch(`/api/inventory/receiving/bill`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receiptIds: receipts.map(x => x.id), billDate: date, dueDate: dueDate || null, reference: reference || null, taxRateId: taxRateId || null }) });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not create bill."); return; }
    onDone();
  }

  return (
    <Drawer title="Create bill from receipts" onClose={onClose}>
      <p className="text-[12px] text-stone-400 mb-4">Billing {receipts.length} receipt{receipts.length > 1 ? "s" : ""} for <span className="text-stone-200">{receipts[0]?.supplierLabel || "supplier"}</span>. Posts Dr GR/IR clearing / Cr Accounts Payable.</p>
      <div className="space-y-5">
        <Section title="Bill details">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Field label="Bill date"><input type="date" className={controlInset} value={date} onChange={e => setDate(e.target.value)} /></Field>
            <Field label="Due date"><input type="date" className={controlInset} value={dueDate} onChange={e => setDueDate(e.target.value)} /></Field>
            <Field label="Supplier bill reference" className="col-span-2"><input className={controlInset} value={reference} onChange={e => setReference(e.target.value)} placeholder="Supplier invoice no." /></Field>
            <Field label="Tax" className="col-span-2">
              <SelectField inset value={taxRateId} onChange={e => setTaxRateId(e.target.value)}>
                <option value="">No tax</option>
                {taxes.map(t => <option key={t.id} value={t.id}>{t.name} ({Number(t.rate)}%)</option>)}
              </SelectField>
            </Field>
          </div>
        </Section>
        <div className="rounded-lg bg-stone-800/50 border border-stone-700 px-4 py-2.5 text-[12px] text-stone-300">Net to bill (clears GR/IR) → <span className="font-semibold text-stone-100">{money(total)}</span></div>
        {err && <p className="text-[12px] text-rose-400">{err}</p>}
      </div>
      <DrawerFooter saving={saving} onClose={onClose} onSave={save} saveLabel="Create bill" />
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

function DrawerFooter({ saving, onClose, onSave, saveLabel = "Save", pendingMsg }: { saving: boolean; onClose: () => void; onSave: () => void; saveLabel?: string; pendingMsg?: string }) {
  if (pendingMsg) {
    return (
      <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-stone-800">
        <button onClick={onClose} className="text-[13px] font-semibold bg-stone-800 text-stone-200 rounded-lg px-4 py-2 hover:bg-stone-700">Done</button>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-stone-800">
      <button onClick={onClose} className="text-[13px] font-medium text-stone-300 px-3.5 py-2 rounded-lg hover:bg-stone-800">Cancel</button>
      <button onClick={onSave} disabled={saving} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">
        {saving ? <Loader size={14} className="animate-spin" /> : <Check size={14} />} {saveLabel}
      </button>
    </div>
  );
}
