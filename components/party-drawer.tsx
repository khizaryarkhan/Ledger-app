"use client";

/**
 * Side drawer to create a Customer / Supplier / Employee in the Accounting
 * module. World-class, internationally-generic fields (State/Province/County,
 * Postal code, Country, Tax registration no.) so it serves users anywhere.
 */

import { useEffect, useState } from "react";
import { X, Loader, Check, AlertTriangle, Users, Building2, Contact } from "lucide-react";
import { CURRENCIES } from "@/lib/accounting/currencies";

type PartyType = "customers" | "suppliers" | "employees";
const META: Record<PartyType, { title: string; noun: string; icon: any }> = {
  customers: { title: "New customer", noun: "customer", icon: Users },
  suppliers: { title: "New supplier", noun: "supplier", icon: Building2 },
  employees: { title: "New employee", noun: "employee", icon: Contact },
};

const empty = {
  name: "", companyName: "", firstName: "", lastName: "",
  email: "", phone: "", mobile: "", website: "",
  addressStreet: "", addressLine2: "", addressCity: "", addressState: "", addressPostcode: "", country: "",
  taxNumber: "", paymentTerms: "30", notes: "", currency: "",
};

export function PartyDrawer({ type, editId, onClose, onCreated }: { type: PartyType; editId?: string | null; onClose: () => void; onCreated: () => void }) {
  const meta = META[type];
  const isPerson = type === "employees";
  const editing = !!editId;
  const [f, setF] = useState({ ...empty });
  const [home, setHome] = useState("");
  const [mc, setMc] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/org/settings").then(r => r.json()).then(o => {
      const h = o?.currency || ""; setHome(h); setMc(!!o?.multicurrencyEnabled);
      setF(prev => ({ ...prev, currency: prev.currency || h }));
    }).catch(() => {});
  }, []);
  // Edit mode: prefill from the existing record.
  useEffect(() => {
    if (!editId) return;
    fetch(`/api/parties/${type}/${editId}`).then(r => r.json()).then(d => {
      if (!d || d.error) return;
      setF(prev => ({
        ...prev,
        name: d.name ?? "", companyName: d.companyName ?? "", firstName: d.firstName ?? "", lastName: d.lastName ?? "",
        email: d.email ?? "", phone: d.phone ?? "", mobile: d.mobile ?? "", website: d.website ?? "",
        addressStreet: d.addressStreet ?? "", addressLine2: d.addressLine2 ?? "", addressCity: d.addressCity ?? "",
        addressState: d.addressState ?? "", addressPostcode: d.addressPostcode ?? "", country: d.country ?? "",
        taxNumber: d.taxNumber ?? "", paymentTerms: d.paymentTerms != null ? String(d.paymentTerms) : prev.paymentTerms,
        notes: d.notes ?? "", currency: d.currency ?? prev.currency,
      }));
    }).catch(() => {});
  }, [editId, type]);
  // Close on Escape.
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", on); return () => window.removeEventListener("keydown", on);
  }, [onClose]);

  const set = (k: keyof typeof empty, v: string) => setF(prev => ({ ...prev, [k]: v }));

  async function save() {
    if (!f.name.trim()) { setErr(isPerson ? "Employee name is required." : "Display name is required."); return; }
    setSaving(true); setErr("");
    try {
      const res = await fetch(editing ? `/api/parties/${type}/${editId}` : `/api/parties/${type}`, {
        method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || "Failed to save"); return; }
      onCreated();
    } finally { setSaving(false); }
  }

  const label = "block text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-1";
  const input = "w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-100 focus:border-stone-500 outline-none";
  const section = "text-[12px] font-semibold text-stone-300 uppercase tracking-wider pt-2";
  const Icon = meta.icon;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-[480px] h-full bg-stone-900 border-l border-stone-800 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-teal-500/15 flex items-center justify-center"><Icon size={17} className="text-teal-400" /></div>
            <h2 className="text-base font-semibold text-white">{editing ? `Edit ${meta.noun}` : meta.title}</h2>
          </div>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-200"><X size={18} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {err && <div className="text-[12px] text-rose-400 bg-rose-950/40 border border-rose-900 rounded-lg px-3 py-2 inline-flex items-center gap-2"><AlertTriangle size={13} /> {err}</div>}

          {mc && (
            <div>
              <label className={label}>Currency</label>
              <select value={f.currency} onChange={e => set("currency", e.target.value)} className={input}>
                {home && !CURRENCIES.some(c => c.code === home) && <option value={home}>{home} (home)</option>}
                {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}{c.code === home ? " (home)" : ""}</option>)}
              </select>
              <p className="text-[11px] text-amber-500/80 mt-1">Set the currency carefully — it can't be changed after the first transaction.</p>
            </div>
          )}

          <div>
            <label className={label}>{isPerson ? "Employee name *" : "Display name *"}</label>
            <input autoFocus value={f.name} onChange={e => set("name", e.target.value)} placeholder={isPerson ? "e.g. Ayesha Khan" : "The name shown on documents"} className={input} />
          </div>

          {!isPerson && (
            <>
              <div>
                <label className={label}>Company name</label>
                <input value={f.companyName} onChange={e => set("companyName", e.target.value)} className={input} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>First name</label><input value={f.firstName} onChange={e => set("firstName", e.target.value)} className={input} /></div>
                <div><label className={label}>Last name</label><input value={f.lastName} onChange={e => set("lastName", e.target.value)} className={input} /></div>
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Email</label><input type="email" value={f.email} onChange={e => set("email", e.target.value)} className={input} /></div>
            <div><label className={label}>Phone</label><input value={f.phone} onChange={e => set("phone", e.target.value)} className={input} /></div>
          </div>

          {!isPerson && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Mobile</label><input value={f.mobile} onChange={e => set("mobile", e.target.value)} className={input} /></div>
                <div><label className={label}>Website</label><input value={f.website} onChange={e => set("website", e.target.value)} className={input} /></div>
              </div>

              <div className={section}>Address</div>
              <div><label className={label}>Street address</label><input value={f.addressStreet} onChange={e => set("addressStreet", e.target.value)} className={input} /></div>
              <div><label className={label}>Address line 2</label><input value={f.addressLine2} onChange={e => set("addressLine2", e.target.value)} className={input} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>City / Town</label><input value={f.addressCity} onChange={e => set("addressCity", e.target.value)} className={input} /></div>
                <div><label className={label}>State / Province / County</label><input value={f.addressState} onChange={e => set("addressState", e.target.value)} className={input} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Postal / ZIP code</label><input value={f.addressPostcode} onChange={e => set("addressPostcode", e.target.value)} className={input} /></div>
                <div><label className={label}>Country</label><input value={f.country} onChange={e => set("country", e.target.value)} placeholder="e.g. Pakistan" className={input} /></div>
              </div>

              <div className={section}>Terms &amp; tax</div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Payment terms (days)</label><input type="number" min="0" value={f.paymentTerms} onChange={e => set("paymentTerms", e.target.value)} className={input} /></div>
                <div><label className={label}>Tax reg. no. (VAT/GST/NTN)</label><input value={f.taxNumber} onChange={e => set("taxNumber", e.target.value)} className={input} /></div>
              </div>
              <div><label className={label}>Notes</label><textarea value={f.notes} onChange={e => set("notes", e.target.value)} rows={2} className={input} /></div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-stone-800 shrink-0">
          <button onClick={onClose} className="text-[13px] text-stone-400 hover:text-stone-200 px-3 py-2">Cancel</button>
          <button onClick={save} disabled={saving || !f.name.trim()} className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50">
            {saving ? <Loader size={14} className="animate-spin" /> : <Check size={15} />} {editing ? "Save changes" : `Save ${meta.noun}`}
          </button>
        </div>
      </div>
    </div>
  );
}
