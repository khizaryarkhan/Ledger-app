"use client";

/**
 * Inline "+ Add new" quick-create drawer for the transaction forms. Any
 * dropdown (customer, supplier, product/service, account, tax, class, location,
 * bank) can create a missing record on the spot; on save it returns the new
 * record so the caller adds it to the list and selects it — no context switch.
 */

import { useEffect, useState } from "react";
import { X, Loader, Check } from "lucide-react";
import { CURRENCIES } from "@/lib/accounting/currencies";

export type QuickAddKind =
  | "customer" | "supplier" | "item"
  | "account-income" | "account-expense" | "account-bank"
  | "tax" | "class" | "location";

const META: Record<QuickAddKind, { title: string; noun: string }> = {
  customer: { title: "New customer", noun: "customer" },
  supplier: { title: "New supplier", noun: "supplier" },
  item: { title: "New product / service", noun: "item" },
  "account-income": { title: "New income account", noun: "account" },
  "account-expense": { title: "New expense account", noun: "account" },
  "account-bank": { title: "New bank account", noun: "account" },
  tax: { title: "New tax rate", noun: "tax rate" },
  class: { title: "New class", noun: "class" },
  location: { title: "New location", noun: "location" },
};

export function QuickAdd({ kind, home, accounts = [], taxes = [], onClose, onCreated }: {
  kind: QuickAddKind; home?: string; accounts?: any[]; taxes?: any[];
  onClose: () => void; onCreated: (row: any) => void;
}) {
  const meta = META[kind];
  const [f, setF] = useState<Record<string, string>>({ name: "", email: "", currency: home || "", rate: "", accountId: "", taxRateId: "", code: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", on); return () => window.removeEventListener("keydown", on);
  }, [onClose]);

  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));
  const incomeAccts = accounts.filter(a => a.classification === "Revenue" || a.type === "Income" || a.type === "Other Income");
  const expenseAccts = accounts.filter(a => a.classification === "Expense" || ["Expense", "Cost of Goods Sold", "Other Expense"].includes(a.type));

  async function save() {
    if (!f.name.trim()) { setErr("A name is required."); return; }
    setSaving(true); setErr("");
    try {
      let url = "", body: any = {};
      if (kind === "customer" || kind === "supplier") {
        url = `/api/parties/${kind === "customer" ? "customers" : "suppliers"}`;
        body = { name: f.name, email: f.email || undefined, currency: f.currency || undefined };
      } else if (kind === "item") {
        url = "/api/accounting/items";
        body = { name: f.name, itemType: "Service", unitPrice: f.rate ? Number(f.rate) : undefined, incomeAccountId: f.accountId || undefined, taxRateId: f.taxRateId || undefined };
      } else if (kind.startsWith("account")) {
        url = "/api/accounting/accounts";
        const type = kind === "account-income" ? "Income" : kind === "account-expense" ? "Expense" : "Bank";
        body = { name: f.name, type, code: f.code || undefined };
      } else if (kind === "tax") {
        url = "/api/accounting/tax-rates";
        body = { name: f.name, rate: Number(f.rate) || 0 };
      } else { // class / location
        url = "/api/accounting/dimensions";
        body = { name: f.name, dimensionType: kind === "class" ? "Class" : "Location" };
      }
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || "Couldn't create"); return; }
      onCreated(d);
    } finally { setSaving(false); }
  }

  const label = "block text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-1";
  const input = "w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-100 focus:border-stone-500 outline-none";

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-[420px] h-full bg-stone-900 border-l border-stone-800 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800 shrink-0">
          <h2 className="text-base font-semibold text-white">{meta.title}</h2>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-200"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {err && <div className="text-[12px] text-rose-400">{err}</div>}
          <div><label className={label}>{kind === "customer" || kind === "supplier" ? "Display name *" : kind === "item" ? "Item name *" : "Name *"}</label>
            <input autoFocus value={f.name} onChange={e => set("name", e.target.value)} className={input} /></div>

          {(kind === "customer" || kind === "supplier") && (
            <>
              <div><label className={label}>Email</label><input value={f.email} onChange={e => set("email", e.target.value)} className={input} /></div>
              {home && <div><label className={label}>Currency</label>
                <select value={f.currency} onChange={e => set("currency", e.target.value)} className={input}>
                  {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
                </select></div>}
            </>
          )}
          {kind === "item" && (
            <>
              <div><label className={label}>Income account</label>
                <select value={f.accountId} onChange={e => set("accountId", e.target.value)} className={input}>
                  <option value="">— choose —</option>
                  {(incomeAccts.length ? incomeAccts : accounts).map(a => <option key={a.id} value={a.id}>{a.code ? `${a.code} · ` : ""}{a.name}</option>)}
                </select></div>
              <div><label className={label}>Sales price / rate</label><input type="number" step="0.01" value={f.rate} onChange={e => set("rate", e.target.value)} className={input} /></div>
              <div><label className={label}>Tax</label>
                <select value={f.taxRateId} onChange={e => set("taxRateId", e.target.value)} className={input}>
                  <option value="">No tax</option>
                  {taxes.map(t => <option key={t.id} value={t.id}>{t.name} ({Number(t.rate)}%)</option>)}
                </select></div>
            </>
          )}
          {kind.startsWith("account") && (
            <div><label className={label}>Account number (optional)</label><input value={f.code} onChange={e => set("code", e.target.value)} placeholder="e.g. 4100" className={input} /></div>
          )}
          {kind === "tax" && (
            <div><label className={label}>Rate % *</label><input type="number" step="0.01" value={f.rate} onChange={e => set("rate", e.target.value)} className={input} /></div>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-stone-800 shrink-0">
          <button onClick={onClose} className="text-[13px] text-stone-400 hover:text-stone-200 px-3 py-2">Cancel</button>
          <button onClick={save} disabled={saving || !f.name.trim()} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50">
            {saving ? <Loader size={14} className="animate-spin" /> : <Check size={15} />} Add {meta.noun}
          </button>
        </div>
      </div>
    </div>
  );
}
