"use client";

/**
 * Production module — schedule & monitor Manufacturing Orders. A status board
 * (Draft → Scheduled → Released → In Progress → Completed) with KPIs, a New-MO
 * drawer, and an MO detail drawer showing material availability, status
 * transitions and the "Complete build" action (which runs the production build).
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Workflow, X, Loader, Check, Trash2, AlertTriangle, CircleDot } from "lucide-react";
import { Field, Section, SelectField, controlInset, th } from "@/components/form-kit";

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
  const [salesOrders, setSalesOrders] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() { setRows(await fetch(`/api/production/mos`).then(r => r.json()).catch(() => [])); }
  useEffect(() => {
    load();
    fetch(`/api/inventory/boms`).then(r => r.json()).then(r => setBoms(Array.isArray(r) ? r : [])).catch(() => {});
    fetch(`/api/inventory/items`).then(r => r.json()).then(r => setItems(Array.isArray(r) ? r : [])).catch(() => {});
    fetch(`/api/trade-documents/sales-orders`).then(r => r.json()).then(r => setSalesOrders(Array.isArray(r) ? r.filter((o: any) => o.status !== "Closed") : [])).catch(() => {});
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

      {showNew && <NewMoDrawer boms={boms} items={items} salesOrders={salesOrders} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />}
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

function NewMoDrawer({ boms, items, salesOrders, onClose, onCreated }: { boms: any[]; items: any[]; salesOrders: any[]; onClose: () => void; onCreated: () => void }) {
  const [bomId, setBomId] = useState("");
  const [bom, setBom] = useState<any>(null);          // { outputItem, outputs:[{skuId, item, qty(unitContent)}] }
  const [packQty, setPackQty] = useState<Record<string, string>>({});  // skuId -> qty
  const [meta, setMeta] = useState<Record<string, string>>({ scheduledDate: new Date().toISOString().slice(0, 10), dueDate: "", priority: "Normal", notes: "", status: "Scheduled", salesOrderId: "" });
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
  const setM = (k: string, v: string) => setMeta(p => ({ ...p, [k]: v }));

  async function onBom(id: string) {
    setBomId(id); setBom(null); setPackQty({});
    if (!id) return;
    const d = await fetch(`/api/inventory/boms/${id}`).then(r => r.json()).catch(() => null);
    if (d?.bom) setBom(d);
  }
  const baseUom = bom?.outputItem?.baseUom || "";
  const outs = bom?.outputs ?? [];
  const baseTotal = useMemo(() => outs.reduce((s: number, o: any) => s + (Number(packQty[o.skuId]) || 0) * Number(o.qty), 0), [outs, packQty]);

  async function save() {
    if (!bomId || !bom) { setErr("Choose a BOM."); return; }
    const outputs = outs.map((o: any) => ({ skuId: o.skuId, qty: Number(packQty[o.skuId]) || 0 })).filter((o: any) => o.qty > 0);
    if (!outputs.length) { setErr("Enter a quantity for at least one output pack."); return; }
    setSaving(true); setErr("");
    const r = await fetch(`/api/production/mos`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bomId, outputItemId: bom.bom.outputItemId, outputs, ...meta }) });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not create MO."); return; }
    onCreated();
  }

  return (
    <Drawer title="New manufacturing order" onClose={onClose}>
      <div className="space-y-6">
        <Section title="Order">
          <Field label="Recipe (BOM)" required>
            <SelectField inset value={bomId} onChange={e => onBom(e.target.value)}>
              <option value="">Select a BOM…</option>
              {boms.map(b => <option key={b.id} value={b.id}>{b.code ? `${b.code} · ` : ""}{b.outputItemName || b.name}</option>)}
            </SelectField>
          </Field>

          {bom && (
            <Field label="Output packs — qty to produce">
              {outs.length === 0 ? <p className="text-[12px] text-amber-400">This BOM has no output packs — add them on the BOM first.</p> : (
                <div className="rounded-lg border border-stone-800 divide-y divide-stone-800/60">
                  {outs.map((o: any) => (
                    <div key={o.skuId} className="flex items-center gap-3 px-3 py-2 hover:bg-stone-950/40">
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] text-stone-100 truncate">{o.item?.name ?? "Pack"}</div>
                        <div className="text-[11px] text-stone-500">{Number(o.qty)} {baseUom}/pack</div>
                      </div>
                      <input type="number" value={packQty[o.skuId] ?? ""} onChange={e => setPackQty(p => ({ ...p, [o.skuId]: e.target.value }))} placeholder="0" className={`${controlInset} !h-8 w-24 text-right tabular-nums`} />
                      <span className="text-[11px] text-stone-500 w-16">packs</span>
                    </div>
                  ))}
                </div>
              )}
              {baseTotal > 0 && <p className="text-[11px] text-stone-400 mt-1.5">→ produces <span className="text-stone-200 font-medium">{baseTotal.toLocaleString()} {baseUom}</span> of {bom.outputItem?.name} in total.</p>}
            </Field>
          )}
        </Section>

        <Section title="Schedule">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Field label="Priority">
              <SelectField inset value={meta.priority} onChange={e => setM("priority", e.target.value)}><option>Low</option><option>Normal</option><option>High</option></SelectField>
            </Field>
            <Field label="Status">
              <SelectField inset value={meta.status} onChange={e => setM("status", e.target.value)}><option>Draft</option><option>Scheduled</option></SelectField>
            </Field>
            <Field label="Scheduled date">
              <input type="date" className={controlInset} value={meta.scheduledDate} onChange={e => setM("scheduledDate", e.target.value)} />
            </Field>
            <Field label="Due date">
              <input type="date" className={controlInset} value={meta.dueDate} onChange={e => setM("dueDate", e.target.value)} />
            </Field>
            <Field label="For Sales Order" className="col-span-2" hint="Optional — links this MO to a customer order's Production Tracker">
              <SelectField inset value={meta.salesOrderId} onChange={e => setM("salesOrderId", e.target.value)}>
                <option value="">None</option>
                {salesOrders.map((o: any) => <option key={o.id} value={o.id}>{o.docNumber} — {o.partyLabel}</option>)}
              </SelectField>
            </Field>
            <Field label="Notes" className="col-span-2">
              <textarea className={`${controlInset} !h-auto py-2`} rows={2} value={meta.notes} onChange={e => setM("notes", e.target.value)} />
            </Field>
          </div>
        </Section>
        {err && <p className="text-[12px] text-rose-400">{err}</p>}
      </div>
      <DrawerFooter saving={saving} onClose={onClose} onSave={save} saveLabel="Create MO" />
    </Drawer>
  );
}

function MoDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [info, setInfo] = useState("");
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
    setBusy(true); setErr(""); setInfo("");
    const r = await fetch(`/api/production/mos/${id}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(d?.error || "Could not complete."); return; }
    if (d.pending) { setInfo("This build exceeds your org's approval threshold and has been submitted for approval — nothing has posted yet, and this MO stays open until it's approved. See Approvals."); load(); onChanged(); return; }
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

          {/* Output packs */}
          {(d.outputs ?? []).length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-500 mb-2">Output packs</div>
              <div className="rounded-lg border border-stone-800 divide-y divide-stone-800/50">
                {d.outputs.map((o: any) => (
                  <div key={o.id} className="flex items-center justify-between px-3 py-1.5 text-[12px]">
                    <span className="text-stone-200">{o.skuName || "Pack"}</span>
                    <span className="text-stone-400 tabular-nums">{qtyFmt(o.qty)} packs · {qtyFmt(o.qty * o.unitContent)} {d.outputItem?.baseUom || ""}</span>
                  </div>
                ))}
              </div>
              {d.materials?.baseTotal > 0 && <p className="text-[11px] text-stone-500 mt-1">Total base to produce: {qtyFmt(d.materials.baseTotal)} {d.outputItem?.baseUom || ""}</p>}
            </div>
          )}

          {/* Materials, split ingredients vs packaging */}
          {(["ingredient", "packaging"] as const).map(kind => {
            const rows = (d.materials?.lines ?? []).filter((l: any) => l.kind === kind);
            if (!rows.length) return null;
            return (
              <div key={kind}>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-500 mb-2">{kind === "ingredient" ? "Ingredients required" : "Packaging required"}</div>
                <div className="rounded-lg border border-stone-800 overflow-hidden">
                  <table className="w-full text-[12px]">
                    <thead><tr className="border-b border-stone-800"><th className={th}>Material</th><th className={`${th} text-right`}>Required</th><th className={`${th} text-right`}>On hand</th><th className={`${th} text-right`}>Status</th></tr></thead>
                    <tbody>
                      {rows.map((l: any) => (
                        <tr key={l.itemId} className="border-b border-stone-800/50 hover:bg-stone-950/40">
                          <td className="px-3 py-1.5 text-stone-200">{l.name}</td>
                          <td className="px-3 py-1.5 text-right text-stone-300 tabular-nums">{qtyFmt(l.required)} {l.baseUom}</td>
                          <td className="px-3 py-1.5 text-right text-stone-400 tabular-nums">{qtyFmt(l.onHand)}</td>
                          <td className="px-3 py-1.5 text-right">{l.ok ? <span className="text-emerald-400 inline-flex items-center gap-1"><CircleDot size={11} /> OK</span> : <span className="text-rose-400 inline-flex items-center gap-1"><AlertTriangle size={11} /> short {qtyFmt(l.short)}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
          {(d.materials?.lines ?? []).length === 0 && <p className="text-[12px] text-stone-500">No materials planned (the BOM has no ingredients/packaging yet).</p>}
          {d.materials?.anyShort && <p className="text-[11px] text-amber-400">Some materials are short — receive/produce them before completing, or the shortfall will be costed at fallback and drive stock negative.</p>}

          {mo.notes && <div className="text-[12px] text-stone-400"><span className="text-stone-500">Notes: </span>{mo.notes}</div>}
          {err && <p className="text-[12px] text-rose-400">{err}</p>}
          {info && <p className="text-[12px] text-amber-400 bg-amber-950/30 border border-amber-900 rounded-lg px-3 py-2">{info}</p>}

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
