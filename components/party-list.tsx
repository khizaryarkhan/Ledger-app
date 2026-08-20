"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Search, Lock, Users, Building2, Contact } from "lucide-react";
import { CURRENCIES } from "@/lib/accounting/currencies";

type PartyType = "customers" | "suppliers" | "employees";
const META: Record<PartyType, { title: string; singular: string; icon: any }> = {
  customers: { title: "Customers", singular: "customer", icon: Users },
  suppliers: { title: "Suppliers", singular: "supplier", icon: Building2 },
  employees: { title: "Employees", singular: "employee", icon: Contact },
};

function SourceBadge({ source }: { source: string }) {
  const map: Record<string, string> = {
    native: "bg-emerald-500/12 text-emerald-400 border-emerald-800/50",
    qbo: "bg-sky-500/12 text-sky-400 border-sky-800/50",
    xero: "bg-cyan-500/12 text-cyan-400 border-cyan-800/50",
  };
  const label: Record<string, string> = { native: "Native", qbo: "QuickBooks", xero: "Xero" };
  return <span className={`text-[10px] font-medium border rounded-full px-2 py-0.5 ${map[source] ?? map.native}`}>{label[source] ?? source}</span>;
}

export function PartyList({ type }: { type: PartyType }) {
  const meta = META[type];
  const [rows, setRows] = useState<any[] | null>(null);
  const [q, setQ] = useState("");
  const [src, setSrc] = useState("all");
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", currency: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    const r = await fetch(`/api/parties/${type}`).then(x => x.json()).catch(() => []);
    setRows(Array.isArray(r) ? r : []);
  }
  useEffect(() => { setRows(null); setQ(""); setSrc("all"); load(); }, [type]);

  async function create() {
    if (!form.name.trim()) return;
    setSaving(true); setErr("");
    try {
      const res = await fetch(`/api/parties/${type}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to create");
      setShowNew(false); setForm({ name: "", email: "", currency: "" }); await load();
    } catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  }

  const filtered = useMemo(() => {
    let list = rows ?? [];
    if (src !== "all") list = list.filter(r => r.source === src);
    const s = q.trim().toLowerCase();
    if (s) list = list.filter(r => (r.name || "").toLowerCase().includes(s) || (r.email || "").toLowerCase().includes(s));
    return list;
  }, [rows, q, src]);

  const Icon = meta.icon;
  const inputCls = "bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-100";

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-teal-500/15 flex items-center justify-center"><Icon size={18} className="text-teal-400" /></div>
          <h1 className="text-xl font-semibold text-stone-100">{meta.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={rows === null ? "animate-spin" : ""} /></button>
          <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-2 hover:bg-emerald-700">
            <Plus size={14} /> New {meta.singular}
          </button>
        </div>
      </div>
      <p className="text-sm text-stone-400 mb-5 ml-12">All {meta.title.toLowerCase()} — synced from QuickBooks/Xero (read-only) alongside those created here (native).</p>

      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-600" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or email…" className={`${inputCls} w-full pl-9`} />
        </div>
        <select value={src} onChange={e => setSrc(e.target.value)} className={inputCls}>
          <option value="all">All sources</option>
          <option value="native">Native</option>
          <option value="qbo">QuickBooks</option>
          <option value="xero">Xero</option>
        </select>
      </div>

      {showNew && (
        <div className="mb-4 p-4 rounded-xl bg-stone-900 border border-stone-800 flex flex-wrap items-end gap-3">
          {err && <div className="w-full text-[12px] text-rose-400">{err}</div>}
          <label className="text-[12px] text-stone-400">Name *<input autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={`${inputCls} mt-1 block w-56`} /></label>
          <label className="text-[12px] text-stone-400">Email<input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className={`${inputCls} mt-1 block w-56`} /></label>
          <label className="text-[12px] text-stone-400">Currency
            <select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} className={`${inputCls} mt-1 block w-32`}>
              <option value="">Home</option>
              {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </label>
          <button onClick={create} disabled={saving || !form.name.trim()} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50">{saving ? "Saving…" : `Add ${meta.singular}`}</button>
          <button onClick={() => { setShowNew(false); setErr(""); }} className="px-3 py-2 text-stone-400 hover:text-stone-200 text-sm">Cancel</button>
        </div>
      )}

      <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[560px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-4 py-2.5">Email</th>
                <th className="text-left px-4 py-2.5">Currency</th>
                <th className="text-left px-4 py-2.5">Source</th>
              </tr>
            </thead>
            <tbody>
              {rows === null && <tr><td colSpan={4} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
              {rows !== null && filtered.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-stone-500">Nothing here yet — add one with the New button, or sync from QuickBooks/Xero.</td></tr>}
              {filtered.map(r => (
                <tr key={r.id} className={`border-b border-stone-800/60 ${r.status === "Inactive" ? "opacity-45" : ""}`}>
                  <td className="px-4 py-2 text-stone-200 font-medium">{r.name}</td>
                  <td className="px-4 py-2 text-stone-400">{r.email || "—"}</td>
                  <td className="px-4 py-2 text-stone-400 font-mono text-[12px]">{r.currency || "—"}</td>
                  <td className="px-4 py-2">{r.source === "native" ? <SourceBadge source="native" /> : <span className="inline-flex items-center gap-1"><SourceBadge source={r.source} /><Lock size={11} className="text-stone-600" /></span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
