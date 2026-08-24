"use client";

/**
 * Production module — schedule & monitor Manufacturing Orders. A status board
 * (Draft → Scheduled → Released → In Progress → Completed) with KPIs, a New-MO
 * drawer, and an MO detail drawer showing material availability, status
 * transitions and the "Complete build" action (which runs the production build).
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Workflow, X, Loader, Check, Trash2, AlertTriangle, CircleDot } from "lucide-react";

const inputCls = "bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-100 w-full focus:outline-none focus:border-emerald-600";
const labelCls = "block text-[11px] font-medium uppercase tracking-wide text-stone-500 mb-1";
const qtyFmt = (n: any) => Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 });

const COLUMNS = [
  { key: "Draft", label: "Draft", tone: "text-stone-400" },
  { key: "Scheduled", label: "Scheduled", tone: "text-sky-400" },
  { key: "Released", label: "Released", tone: "text-violet-400" },
  { key: "InProgress", label: "In Progress", tone: "text-amber-400" },
  { key: "Completed", label: "Completed", tone: "text-emerald-400" },
] as const;

export function MoConsole() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [boms, setBoms] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() { setRows(await fetch(`/api/production/mos`).then(r => r.json()).catch(() => [])); }
  useEffect(() => {
    load();
    fetch(`/api/inventory/boms`).then(r => r.json()).then(r => setBoms(Array.isArray(r) ? r : [])).catch(() => {});
    fetch(`/api/inventory/items`).then(r => r.json()).then(r => setItems(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);
  useEffect(() => { if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1") setShowNew(true); }, []);

  const list = rows ?? [];
  const weekAhead = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); }, []);
  const kpis = useMemo(() => {
    const open = list.filter(m => !["Completed", "Cancelled"].includes(m.status));
    const soon = open.filter(m => m.scheduledDate && m.scheduledDate <= weekAhead);
    const wip = list.filter(m => m.status === "InProgress");
    const month = new Date().toISOString().slice(0, 7);
    const doneThisMonth = list.filter(m => m.status === "Completed" && (m.updatedAt ?? "").slice(0, 7) === month);
    return { open: open.length, soon: soon.length, wip: wip.length, done: doneThisMonth.length };
  }, [list, weekAhead]);

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-orange-500/15 flex items-center justify-center"><Workflow size={18} className="text-orange-400" /></div>
          <h1 className="text-xl font-semibold text-stone-100">Production Schedule</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={rows === null ? "animate-spin" : ""} /></button>
          <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-2 hover:bg-emerald-700"><Plus size={14} /> New MO</button>
        </div>
      </div>
      <p className="text-sm text-stone-400 mb-5 ml-12">Plan and monitor manufacturing orders. Completing an MO runs the build — consuming materials and producing the finished item.</p>

      <div className="grid grid-cols-4 gap-2 mb-5">
        {[["Open MOs", kpis.open, "text-stone-100"], ["Scheduled ≤7 days", kpis.soon, "text-sky-400"], ["In progress", kpis.wip, "text-amber-400"], ["Completed this month", kpis.done, "text-emerald-400"]].map(([l, v, c]) => (
          <div key={l as string} className="rounded-xl border border-stone-800 bg-stone-900 p-3">
            <div className="text-[10px] uppercase tracking-wide text-stone-500">{l}</div>
            <div className={`text-[18px] font-semibold ${c}`}>{v as number}</div>
          </div>
        ))}
      </div>

      {showNew && <NewMoDrawer boms={boms} items={items} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />}
      {openId && <MoDrawer id={openId} onClose={() => setOpenId(null)} onChanged={load} />}

      {rows === null ? <p className="text-sm text-stone-500">Loading…</p> : list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-800 p-10 text-center text-stone-500 text-sm">No manufacturing orders yet — plan one with New MO.</div>
      ) : (
        <div className="grid grid-cols-5 gap-3">
          {COLUMNS.map(col => {
            const cards = list.filter(m => m.status === col.key);
            return (
              <div key={col.key}>
                <div className={`text-[11px] font-semibold uppercase tracking-wide mb-2 ${col.tone}`}>{col.label} <span className="text-stone-600">{cards.length}</span></div>
                <div className="space-y-2">
                  {cards.map(m => (
                    <button key={m.id} onClick={() => setOpenId(m.id)} className="w-full text-left rounded-lg border border-stone-800 bg-stone-900 hover:border-stone-600 p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] text-stone-400">{m.moNo}</span>
                        {m.priority === "High" && <span className="text-[9px] text-rose-400 font-medium">HIGH</span>}
                      </div>
                      <div className="text-[13px] font-medium text-stone-100 mt-0.5 leading-tight">{m.outputItem?.name ?? "—"}</div>
                      <div className="text-[11px] text-stone-500 mt-0.5">{qtyFmt(m.qty)} {m.outputItem?.baseUom || ""}{m.scheduledDate ? ` · ${m.scheduledDate}` : ""}</div>
                    </button>
                  ))}
                  {cards.length === 0 && <div className="text-[11px] text-stone-600 px-1">—</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NewMoDrawer({ boms, items, onClose, onCreated }: { boms: any[]; items: any[]; onClose: () => void; onCreated: () => void }) {
  const producible = items.filter(i => i.productType === "FinishedProduct" || i.productType === "WorkInProgress");
  const [f, setF] = useState<Record<string, string>>({ bomId: "", outputItemId: "", outputSkuId: "", qty: "", scheduledDate: new Date().toISOString().slice(0, 10), dueDate: "", priority: "Normal", notes: "", status: "Scheduled" });
  const [skus, setSkus] = useState<any[]>([]);
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  async function onBom(id: string) {
    set("bomId", id);
    if (!id) return;
    const d = await fetch(`/api/inventory/boms/${id}`).then(r => r.json()).catch(() => null);
    if (d?.bom) { if (d.bom.outputItemId) set("outputItemId", d.bom.outputItemId); if (d.bom.outputSkuId) set("outputSkuId", d.bom.outputSkuId); }
  }
  useEffect(() => { if (!f.outputItemId) { setSkus([]); return; } fetch(`/api/inventory/items/${f.outputItemId}`).then(r => r.json()).then(d => setSkus(d?.skus ?? [])).catch(() => setSkus([])); }, [f.outputItemId]);

  async function save() {
    if (!f.outputItemId) { setErr("Choose the item to produce."); return; }
    if (!(Number(f.qty) > 0)) { setErr("Enter a quantity."); return; }
    setSaving(true); setErr("");
    const r = await fetch(`/api/production/mos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, qty: Number(f.qty) }) });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not create MO."); return; }
    onCreated();
  }

  return (
    <Drawer title="New manufacturing order" onClose={onClose}>
      <div className="space-y-4">
        <div><label className={labelCls}>From BOM</label>
          <select className={inputCls} value={f.bomId} onChange={e => onBom(e.target.value)}>
            <option value="">No BOM — pick output directly</option>
            {boms.map(b => <option key={b.id} value={b.id}>{b.code ? `${b.code} · ` : ""}{b.outputItemName || b.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Output item</label>
            <select className={inputCls} value={f.outputItemId} onChange={e => { set("outputItemId", e.target.value); set("outputSkuId", ""); }}>
              <option value="">Select…</option>
              {producible.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div><label className={labelCls}>Packaging (SKU)</label>
            <select className={inputCls} value={f.outputSkuId} onChange={e => set("outputSkuId", e.target.value)}>
              <option value="">Base UoM</option>
              {skus.map(s => <option key={s.id} value={s.id}>{s.skuName || s.skuCode || s.id.slice(0, 8)}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className={labelCls}>Qty</label><input type="number" className={inputCls} value={f.qty} onChange={e => set("qty", e.target.value)} /></div>
          <div><label className={labelCls}>Priority</label><select className={inputCls} value={f.priority} onChange={e => set("priority", e.target.value)}><option>Low</option><option>Normal</option><option>High</option></select></div>
          <div><label className={labelCls}>Status</label><select className={inputCls} value={f.status} onChange={e => set("status", e.target.value)}><option>Draft</option><option>Scheduled</option></select></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Scheduled date</label><input type="date" className={inputCls} value={f.scheduledDate} onChange={e => set("scheduledDate", e.target.value)} /></div>
          <div><label className={labelCls}>Due date</label><input type="date" className={inputCls} value={f.dueDate} onChange={e => set("dueDate", e.target.value)} /></div>
        </div>
        <div><label className={labelCls}>Notes</label><textarea className={inputCls} rows={2} value={f.notes} onChange={e => set("notes", e.target.value)} /></div>
        {err && <p className="text-[12px] text-rose-400">{err}</p>}
      </div>
      <DrawerFooter saving={saving} onClose={onClose} onSave={save} saveLabel="Create MO" />
    </Drawer>
  );
}

function MoDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  async function load() { setD(await fetch(`/api/production/mos/${id}`).then(r => r.json()).catch(() => null)); }
  useEffect(() => { load(); }, [id]);

  const mo = d?.mo;
  const NEXT: Record<string, { to: string; label: string }[]> = {
    Draft: [{ to: "Scheduled", label: "Schedule" }, { to: "Cancelled", label: "Cancel" }],
    Scheduled: [{ to: "Released", label: "Release" }, { to: "Cancelled", label: "Cancel" }],
    Released: [{ to: "InProgress", label: "Start" }, { to: "Cancelled", label: "Cancel" }],
    InProgress: [{ to: "Released", label: "Back to released" }, { to: "Cancelled", label: "Cancel" }],
    Completed: [], Cancelled: [{ to: "Draft", label: "Reopen" }],
  };

  async function transition(to: string) {
    setBusy(true); setErr("");
    const r = await fetch(`/api/production/mos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: to }) });
    setBusy(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Failed."); return; }
    load(); onChanged();
  }
  async function complete() {
    if (!confirm("Complete this MO? It runs the build — consumes materials and produces the output, posting the ledger.")) return;
    setBusy(true); setErr("");
    const r = await fetch(`/api/production/mos/${id}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    setBusy(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not complete."); return; }
    load(); onChanged();
  }
  async function del() {
    if (!confirm("Delete this MO?")) return;
    const r = await fetch(`/api/production/mos/${id}`, { method: "DELETE" });
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not delete."); return; }
    onChanged(); onClose();
  }

  return (
    <Drawer title={mo ? `${mo.moNo} · ${d.outputItem?.name ?? ""}` : "Manufacturing order"} onClose={onClose}>
      {!d ? <p className="text-sm text-stone-500">Loading…</p> : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-[12px] text-stone-400">
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${mo.status === "Completed" ? "border-emerald-800/50 text-emerald-400 bg-emerald-500/10" : mo.status === "Cancelled" ? "border-stone-700 text-stone-500" : "border-sky-800/50 text-sky-400 bg-sky-500/10"}`}>{mo.status}</span>
            <span>{qtyFmt(mo.qty)} {d.outputItem?.baseUom || ""}</span>
            {mo.scheduledDate && <span>· scheduled {mo.scheduledDate}</span>}
            {mo.priority === "High" && <span className="text-rose-400">· HIGH</span>}
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-500 mb-2">Material availability</div>
            {d.materials.lines.length === 0 ? <p className="text-[12px] text-stone-500">No BOM inputs (attach a BOM to plan materials).</p> : (
              <div className="rounded-lg border border-stone-800 overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead><tr className="text-[10px] uppercase tracking-wide text-stone-500 border-b border-stone-800"><th className="text-left px-3 py-1.5">Material</th><th className="text-right px-3 py-1.5">Required</th><th className="text-right px-3 py-1.5">On hand</th><th className="text-right px-3 py-1.5">Status</th></tr></thead>
                  <tbody>
                    {d.materials.lines.map((l: any) => (
                      <tr key={l.itemId} className="border-b border-stone-800/50">
                        <td className="px-3 py-1.5 text-stone-200">{l.name}</td>
                        <td className="px-3 py-1.5 text-right text-stone-300 tabular-nums">{qtyFmt(l.required)} {l.baseUom}</td>
                        <td className="px-3 py-1.5 text-right text-stone-400 tabular-nums">{qtyFmt(l.onHand)}</td>
                        <td className="px-3 py-1.5 text-right">{l.ok ? <span className="text-emerald-400 inline-flex items-center gap-1"><CircleDot size={11} /> OK</span> : <span className="text-rose-400 inline-flex items-center gap-1"><AlertTriangle size={11} /> short {qtyFmt(l.short)}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {d.materials.anyShort && <p className="text-[11px] text-amber-400 mt-1">Some materials are short — receive/produce them before completing, or the shortfall will be costed at fallback and drive stock negative.</p>}
          </div>

          {mo.notes && <div className="text-[12px] text-stone-400"><span className="text-stone-500">Notes: </span>{mo.notes}</div>}
          {err && <p className="text-[12px] text-rose-400">{err}</p>}

          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-stone-800">
            {(NEXT[mo.status] ?? []).map(t => (
              <button key={t.to} onClick={() => transition(t.to)} disabled={busy} className="text-[12px] font-medium text-stone-200 bg-stone-800 hover:bg-stone-700 rounded-lg px-3 py-1.5 disabled:opacity-50">{t.label}</button>
            ))}
            {["Released", "InProgress"].includes(mo.status) && (
              <button onClick={complete} disabled={busy} className="flex items-center gap-1.5 text-[12px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-1.5 hover:bg-emerald-700 disabled:opacity-50">
                {busy ? <Loader size={13} className="animate-spin" /> : <Check size={13} />} Complete build
              </button>
            )}
            {mo.status !== "Completed" && !mo.productionRunId && (
              <button onClick={del} className="ml-auto p-1.5 rounded hover:bg-stone-800 text-stone-500 hover:text-rose-400" title="Delete MO"><Trash2 size={14} /></button>
            )}
            {mo.status === "Completed" && mo.productionRunId && <span className="ml-auto text-[11px] text-stone-500">Built ✓ — void from Quick Build to undo</span>}
          </div>
        </div>
      )}
    </Drawer>
  );
}

/* ----------------------------- Drawer shell ----------------------------- */

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const on = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", on); return () => window.removeEventListener("keydown", on); }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative bg-stone-900 border-l border-stone-800 h-full overflow-y-auto shadow-2xl w-full max-w-lg" onMouseDown={e => e.stopPropagation()}>
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
