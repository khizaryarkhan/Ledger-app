"use client";

/**
 * Job work console — subcontracting: send owned material to a vendor for
 * external processing (knitting, dyeing, ...) and receive it back
 * transformed, still owned throughout. Dispatch relieves the sent item's
 * stock into the Job Work clearing account; Receive creates a lot for the
 * transformed item at (carried material cost + processing fee), and records
 * the fee-only portion as an ordinary goods receipt so it can be billed via
 * the normal three-way-match Bill flow.
 */

import { useEffect, useState } from "react";
import { Plus, RefreshCw, Shirt, X, Loader, Check, Trash2 } from "lucide-react";
import { fmt } from "@/lib/format";
import { kindOf } from "@/lib/inventory/item-kinds";

const inputCls = "bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-100 w-full focus:outline-none focus:border-emerald-600";
const labelCls = "block text-[11px] font-medium uppercase tracking-wide text-stone-500 mb-1";
const money = fmt.num2;

export function JobWorkConsole() {
  const [orders, setOrders] = useState<any[] | null>(null);
  const [vendors, setVendors] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [receiving, setReceiving] = useState<any | null>(null);

  async function load() {
    const r = await fetch(`/api/inventory/jobwork`).then(x => x.json()).catch(() => []);
    setOrders(Array.isArray(r) ? r : []);
  }
  useEffect(() => {
    load();
    fetch(`/api/parties/suppliers?native=1`).then(x => x.json()).then(r => setVendors(Array.isArray(r) ? r : [])).catch(() => {});
    fetch(`/api/inventory/items`).then(x => x.json()).then(r => setItems(Array.isArray(r) ? r.filter((i: any) => kindOf(i.productType).tracked) : [])).catch(() => {});
  }, []);

  async function voidOrder(id: string, docNumber: string) {
    if (!confirm(`Void job work order ${docNumber}? This reverses the dispatch (and receipt, if received) and restores the sent item's stock.`)) return;
    const r = await fetch(`/api/inventory/jobwork/${id}`, { method: "DELETE" });
    if (!r.ok) { alert((await r.json().catch(() => ({})))?.error || "Could not void job work order."); return; }
    load();
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-sky-500/15 flex items-center justify-center"><Shirt size={18} className="text-sky-400" /></div>
          <h1 className="text-xl font-semibold text-stone-100">Job Work</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={orders === null ? "animate-spin" : ""} /></button>
          <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-2 hover:bg-emerald-700"><Plus size={14} /> Send to job worker</button>
        </div>
      </div>
      <p className="text-sm text-stone-400 mb-5 ml-12">Send your own material to a vendor for external processing (knitting, dyeing, ...) and receive it back transformed — still owned throughout, no purchase or sale.</p>

      {showNew && <DispatchDrawer vendors={vendors} items={items} onClose={() => setShowNew(false)} onDone={() => { setShowNew(false); load(); }} />}
      {receiving && <ReceiveDrawer order={receiving} items={items} onClose={() => setReceiving(null)} onDone={() => { setReceiving(null); load(); }} />}

      <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[720px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                <th className="px-4 py-2.5">Order</th>
                <th className="px-4 py-2.5">Vendor</th>
                <th className="px-4 py-2.5">Sent</th>
                <th className="px-4 py-2.5">Received</th>
                <th className="px-4 py-2.5 text-right">Amount</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {(orders ?? []).map(o => (
                <tr key={o.id} className="border-b border-stone-800/60 hover:bg-stone-800/30">
                  <td className="px-4 py-2.5 font-medium text-stone-200">{o.docNumber}</td>
                  <td className="px-4 py-2.5 text-stone-300">{o.vendorLabel ?? "—"}</td>
                  <td className="px-4 py-2.5 text-stone-300">{Number(o.sentQty)} {o.sentItem?.name ?? ""}</td>
                  <td className="px-4 py-2.5 text-stone-300">{o.receivedQty ? `${Number(o.receivedQty)} ${o.receivedItem?.name ?? ""}` : "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-stone-300">{money(Number(o.sentAmount) + Number(o.processingFeeAmount ?? 0))}</td>
                  <td className="px-4 py-2.5"><span className={`text-[11px] font-medium border rounded-full px-2 py-0.5 ${o.status === "Received" ? "bg-emerald-500/12 text-emerald-400 border-emerald-800/50" : "bg-amber-500/10 text-amber-400 border-amber-800"}`}>{o.status}</span></td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-3">
                      {o.status === "Dispatched" && <button onClick={() => setReceiving(o)} className="text-[12px] font-medium text-emerald-400 hover:underline">Receive…</button>}
                      <button onClick={() => voidOrder(o.id, o.docNumber)} title="Void" className="text-stone-600 hover:text-rose-400"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {orders && orders.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-stone-500">No job work orders yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DispatchDrawer({ vendors, items, onClose, onDone }: { vendors: any[]; items: any[]; onClose: () => void; onDone: () => void }) {
  const [vendorId, setVendorId] = useState("");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pendingMsg, setPendingMsg] = useState("");

  async function submit() {
    setBusy(true); setErr("");
    const vendor = vendors.find(v => v.id === vendorId);
    const r = await fetch(`/api/inventory/jobwork`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId: vendorId || null, vendorLabel: vendor?.name ?? null, sentItemId: itemId, sentQty: Number(qty), dispatchDate: date, notes: notes || null }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(d.error || "Failed to dispatch"); return; }
    if (d.pending) { setPendingMsg("This dispatch exceeds your org's approval rules and has been submitted for approval — nothing has posted yet. See Approvals."); return; }
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative h-full w-full sm:w-[440px] bg-stone-950 border-l border-stone-800 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-800">
          <h2 className="text-sm font-semibold text-stone-100">Send to job worker</h2>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-200"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {err && <div className="text-[12px] text-rose-400 bg-rose-950/30 border border-rose-900 rounded-lg px-3 py-2">{err}</div>}
          {pendingMsg && <div className="text-[12px] text-amber-400 bg-amber-950/30 border border-amber-900 rounded-lg px-3 py-2">{pendingMsg}</div>}
          <div><label className={labelCls}>Job worker (vendor)</label>
            <select value={vendorId} onChange={e => setVendorId(e.target.value)} className={inputCls}>
              <option value="">Select…</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div><label className={labelCls}>Item being sent</label>
            <select value={itemId} onChange={e => setItemId(e.target.value)} className={inputCls}>
              <option value="">Select…</option>
              {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div><label className={labelCls}>Quantity</label>
            <input type="number" value={qty} onChange={e => setQty(e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Dispatch date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Notes</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} className={inputCls} /></div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-stone-800">
          {pendingMsg ? (
            <button onClick={onDone} className="px-4 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-sm font-semibold">Done</button>
          ) : (
            <>
              <button onClick={onClose} className="text-[13px] text-stone-400 hover:text-stone-200 px-3 py-2">Cancel</button>
              <button onClick={submit} disabled={busy || !vendorId || !itemId || !qty} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-2">
                {busy ? <Loader size={14} className="animate-spin" /> : <Check size={15} />} Dispatch
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ReceiveDrawer({ order, items, onClose, onDone }: { order: any; items: any[]; onClose: () => void; onDone: () => void }) {
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("");
  const [fee, setFee] = useState("0");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setBusy(true); setErr("");
    const r = await fetch(`/api/inventory/jobwork/${order.id}/receive`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receivedItemId: itemId, receivedQty: Number(qty), processingFeeAmount: Number(fee) || 0, receiveDate: date }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(d.error || "Failed to post receipt"); return; }
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative h-full w-full sm:w-[440px] bg-stone-950 border-l border-stone-800 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-800">
          <h2 className="text-sm font-semibold text-stone-100">Receive from {order.vendorLabel}</h2>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-200"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {err && <div className="text-[12px] text-rose-400 bg-rose-950/30 border border-rose-900 rounded-lg px-3 py-2">{err}</div>}
          <p className="text-[12px] text-stone-500">Sent: {Number(order.sentQty)} {order.sentItem?.name} · carried cost {money(Number(order.sentAmount))}</p>
          <div><label className={labelCls}>Item received back</label>
            <select value={itemId} onChange={e => setItemId(e.target.value)} className={inputCls}>
              <option value="">Select…</option>
              {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div><label className={labelCls}>Quantity received</label>
            <input type="number" value={qty} onChange={e => setQty(e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Processing charge (job worker's fee)</label>
            <input type="number" value={fee} onChange={e => setFee(e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Receive date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} /></div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-stone-800">
          <button onClick={onClose} className="text-[13px] text-stone-400 hover:text-stone-200 px-3 py-2">Cancel</button>
          <button onClick={submit} disabled={busy || !itemId || !qty} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-2">
            {busy ? <Loader size={14} className="animate-spin" /> : <Check size={15} />} Post receipt
          </button>
        </div>
      </div>
    </div>
  );
}
