"use client";

import { useEffect, useState, useCallback } from "react";
import { Layers, Plus, Trash2, Loader2, Sparkles, ChevronRight } from "lucide-react";

interface Value { id: string; name: string; code: string | null; parentId: string | null; active: boolean; }
interface Dimension { id: string; name: string; slug: string; description: string | null; active: boolean; values: Value[]; }

const card = "border border-stone-800 rounded-xl bg-stone-900/40";
const input = "h-9 px-3 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-100 focus:border-blue-500 focus:outline-none";
const btn = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium";

export default function ReportingStudioPage() {
  const [dims, setDims] = useState<Dimension[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newDim, setNewDim] = useState("");
  const [busy, setBusy] = useState(false);
  const [valueDraft, setValueDraft] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/reporting/dimensions")
      .then((r) => r.json())
      .then((d) => { if (d.error) throw new Error(d.error); setDims(d.dimensions || []); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function addDimension(name: string, values?: string[]) {
    if (!name.trim()) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/reporting/dimensions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, values }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setNewDim(""); load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function seedDefaults() {
    setBusy(true); setError(null);
    try {
      await addDimension("Profit Center", ["Workplace", "Construction", "Furniture", "Corporate"]);
      await addDimension("Region", ["London", "South East", "Midlands", "North"]);
    } finally { setBusy(false); }
  }

  async function delDimension(id: string) {
    if (!confirm("Delete this dimension and all its values and rules?")) return;
    await fetch(`/api/reporting/dimensions/${id}`, { method: "DELETE" });
    load();
  }

  async function addValue(dimId: string) {
    const name = (valueDraft[dimId] || "").trim();
    if (!name) return;
    await fetch("/api/reporting/values", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dimensionId: dimId, name }),
    });
    setValueDraft((v) => ({ ...v, [dimId]: "" }));
    load();
  }

  async function delValue(id: string) {
    await fetch(`/api/reporting/values/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-blue-500/15 flex items-center justify-center"><Layers size={18} className="text-blue-400" /></div>
        <h1 className="text-xl font-semibold text-stone-100">Reporting Studio</h1>
      </div>
      <p className="text-sm text-stone-400 mb-5 ml-12">
        Define your management-reporting structure. Dimensions (e.g. Profit Center, Region) and their values sit
        <em> on top of</em> QuickBooks — classification rules map QBO activity into them without changing anything in QBO.
      </p>

      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error}</div>}

      {/* Add a dimension */}
      <div className={`${card} p-4 mb-5`}>
        <div className="flex items-center gap-2">
          <input value={newDim} onChange={(e) => setNewDim(e.target.value)} placeholder="New dimension name (e.g. Business Unit)"
            className={`${input} flex-1`} onKeyDown={(e) => e.key === "Enter" && addDimension(newDim)} />
          <button onClick={() => addDimension(newDim)} disabled={busy || !newDim.trim()} className={`${btn} bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40`}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Add dimension
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-stone-500 py-12">Loading…</div>
      ) : dims.length === 0 ? (
        <div className={`${card} p-10 text-center`}>
          <p className="text-stone-300 mb-1">No reporting dimensions yet.</p>
          <p className="text-sm text-stone-500 mb-4">Start with a common setup, then tailor it.</p>
          <button onClick={seedDefaults} disabled={busy} className={`${btn} bg-blue-600 hover:bg-blue-700 text-white mx-auto disabled:opacity-40`}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Create Profit Center + Region
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {dims.map((d) => (
            <div key={d.id} className={`${card} p-4`}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-stone-100 font-medium">{d.name}</div>
                  <div className="text-[11px] text-stone-500 font-mono">{d.slug}</div>
                </div>
                <button onClick={() => delDimension(d.id)} className="text-stone-500 hover:text-rose-400 p-1" title="Delete dimension"><Trash2 size={15} /></button>
              </div>

              <div className="flex flex-wrap gap-1.5 mb-3">
                {d.values.length === 0 && <span className="text-[12px] text-stone-600">No values yet.</span>}
                {d.values.map((v) => (
                  <span key={v.id} className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full border border-stone-700 bg-stone-800/60 text-[12px] text-stone-200">
                    {v.parentId && <ChevronRight size={11} className="text-stone-600" />}{v.name}
                    <button onClick={() => delValue(v.id)} className="text-stone-500 hover:text-rose-400"><Trash2 size={12} /></button>
                  </span>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <input value={valueDraft[d.id] || ""} onChange={(e) => setValueDraft((s) => ({ ...s, [d.id]: e.target.value }))}
                  placeholder="Add a value…" className={`${input} w-56`} onKeyDown={(e) => e.key === "Enter" && addValue(d.id)} />
                <button onClick={() => addValue(d.id)} className={`${btn} bg-stone-800 hover:bg-stone-700 text-stone-200`}><Plus size={14} /> Add value</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[12px] text-stone-600 mt-6">
        Next: classification rules (map QBO Class / Account / Customer → these values), then P&L by dimension and the Unallocated review.
      </p>
    </div>
  );
}
