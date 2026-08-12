"use client";

import { useEffect, useState, useCallback } from "react";
import { SlidersHorizontal, Plus, Trash2, Loader2, X } from "lucide-react";

interface Def { id: string; entity: string; fieldKey: string; label: string; fieldType: string; options: string[] | null; required: boolean; sortOrder: number; active: boolean; }

const ENTITIES = [{ key: "account", label: "Accounts" }, { key: "lead", label: "Leads / Deals" }, { key: "contact", label: "Contacts" }];
const TYPES = ["text", "textarea", "number", "money", "date", "select", "multiselect", "boolean", "url", "email", "phone"];
const HAS_OPTIONS = (t: string) => t === "select" || t === "multiselect";

const input = "h-9 px-2.5 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-100 focus:border-blue-500 focus:outline-none";
const btn = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium";
const card = "border border-stone-800 rounded-xl bg-stone-900/40";

export default function CustomFieldsPage() {
  const [entity, setEntity] = useState("account");
  const [defs, setDefs] = useState<Def[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState("text");
  const [required, setRequired] = useState(false);
  const [optionsText, setOptionsText] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/custom-fields").then((r) => r.json())
      .then((d) => { if (d.error) throw new Error(d.error); setDefs(d.defs || []); })
      .catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!label.trim()) return;
    setSaving(true); setError(null);
    try {
      const r = await fetch("/api/admin/custom-fields", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity, label, fieldType, required, options: HAS_OPTIONS(fieldType) ? optionsText.split(",").map((s) => s.trim()).filter(Boolean) : undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setLabel(""); setOptionsText(""); setRequired(false); setFieldType("text"); load();
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  }

  async function del(id: string) {
    if (!confirm("Delete this field and all its stored values?")) return;
    await fetch(`/api/admin/custom-fields/${id}`, { method: "DELETE" }); load();
  }

  const forEntity = defs.filter((d) => d.entity === entity);

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-blue-500/15 flex items-center justify-center"><SlidersHorizontal size={18} className="text-blue-400" /></div>
        <h1 className="text-xl font-semibold text-stone-100">Custom Fields</h1>
      </div>
      <p className="text-sm text-stone-400 mb-5 ml-12">Add your own properties to accounts, leads/deals and contacts — they appear on each record and in filters. No code, no deploy.</p>

      <div className="flex gap-1.5 mb-4">
        {ENTITIES.map((e) => (
          <button key={e.key} onClick={() => setEntity(e.key)}
            className={`px-3 py-1.5 rounded-lg text-sm ${entity === e.key ? "bg-blue-600 text-white" : "bg-stone-800/60 text-stone-300 hover:bg-stone-800"}`}>
            {e.label} <span className="text-[11px] opacity-70">{defs.filter((d) => d.entity === e.key).length}</span>
          </button>
        ))}
      </div>

      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error}</div>}

      <div className={`${card} p-4 mb-5`}>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[11px] text-stone-400">Field name<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Annual Contract Value" className={`${input} block mt-0.5 w-56`} /></label>
          <label className="text-[11px] text-stone-400">Type
            <select value={fieldType} onChange={(e) => setFieldType(e.target.value)} className={`${input} block mt-0.5`}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          </label>
          {HAS_OPTIONS(fieldType) && <label className="text-[11px] text-stone-400">Options (comma-sep)<input value={optionsText} onChange={(e) => setOptionsText(e.target.value)} placeholder="A, B, C" className={`${input} block mt-0.5 w-56`} /></label>}
          <label className="flex items-center gap-1.5 text-[12px] text-stone-300 h-9"><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="accent-blue-500" /> Required</label>
          <button onClick={add} disabled={saving || !label.trim()} className={`${btn} bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40`}>{saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Add field</button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-stone-500 py-8">Loading…</div>
      ) : forEntity.length === 0 ? (
        <div className="text-sm text-stone-500 py-8 text-center">No custom fields on {ENTITIES.find((e) => e.key === entity)?.label} yet.</div>
      ) : (
        <div className={`${card} divide-y divide-stone-800`}>
          {forEntity.map((d) => (
            <div key={d.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
              <span className="text-stone-100 font-medium">{d.label}</span>
              <span className="text-[11px] text-stone-500 font-mono">{d.fieldKey}</span>
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-stone-800 text-stone-400">{d.fieldType}</span>
              {d.required && <span className="text-[11px] text-amber-400">required</span>}
              {d.options?.length ? <span className="text-[11px] text-stone-500 truncate">{d.options.join(" · ")}</span> : null}
              <button onClick={() => del(d.id)} className="ml-auto text-stone-500 hover:text-rose-400"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
