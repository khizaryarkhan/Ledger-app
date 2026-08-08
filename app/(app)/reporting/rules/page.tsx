"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { GitBranch, Plus, Trash2, Loader2, X } from "lucide-react";
import { ATTRIBUTE_META, OPERATORS_BY_TYPE, attrMeta, describeConditions } from "@/lib/reporting/attributes-meta";

interface Value { id: string; name: string; dimensionId: string; }
interface Dimension { id: string; name: string; slug: string; values: Value[]; }
interface Rule { id: string; dimensionId: string; targetValueId: string | null; name: string | null; description: string | null; priority: number; conditions: any; active: boolean; }

interface LeafDraft { attribute: string; operator: string; value: string; from: string; to: string; }

const input = "h-9 px-2.5 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-100 focus:border-blue-500 focus:outline-none";
const btn = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium";
const card = "border border-stone-800 rounded-xl bg-stone-900/40";

const NO_VALUE = new Set(["blank", "notBlank"]);
const LIST_OP = new Set(["in", "notIn"]);
const RANGE_OP = new Set(["between", "dateBetween"]);

export default function ReportingRulesPage() {
  const [dims, setDims] = useState<Dimension[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // draft rule
  const [dimensionId, setDimensionId] = useState("");
  const [targetValueId, setTargetValueId] = useState("");
  const [priority, setPriority] = useState(100);
  const [op, setOp] = useState<"AND" | "OR">("AND");
  const [description, setDescription] = useState("");
  const [leaves, setLeaves] = useState<LeafDraft[]>([{ attribute: "className", operator: "eq", value: "", from: "", to: "" }]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dr, rr] = await Promise.all([
        fetch("/api/reporting/dimensions").then((r) => r.json()),
        fetch("/api/reporting/rules").then((r) => r.json()),
      ]);
      if (dr.error) throw new Error(dr.error);
      setDims(dr.dimensions || []);
      setRules(rr.rules || []);
      if (!dimensionId && dr.dimensions?.[0]) setDimensionId(dr.dimensions[0].id);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);

  const dimById = useMemo(() => new Map(dims.map((d) => [d.id, d])), [dims]);
  const valById = useMemo(() => new Map(dims.flatMap((d) => d.values).map((v) => [v.id, v])), [dims]);
  const targetValues = dimById.get(dimensionId)?.values ?? [];

  function setLeaf(i: number, patch: Partial<LeafDraft>) {
    setLeaves((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function buildConditions() {
    const conds = leaves.map((l) => {
      const meta = attrMeta(l.attribute);
      const isNum = meta?.type === "number";
      const base: any = { attribute: l.attribute, operator: l.operator };
      if (NO_VALUE.has(l.operator)) return base;
      if (LIST_OP.has(l.operator)) {
        base.values = l.value.split(",").map((s) => s.trim()).filter(Boolean).map((s) => (isNum ? Number(s) : s));
      } else if (RANGE_OP.has(l.operator)) {
        base.from = isNum ? Number(l.from) : l.from;
        base.to = isNum ? Number(l.to) : l.to;
      } else {
        base.value = isNum ? Number(l.value) : l.value;
      }
      return base;
    });
    return { op, conditions: conds };
  }

  async function saveRule() {
    if (!dimensionId || !targetValueId) { setError("Pick a dimension and a target value."); return; }
    setSaving(true); setError(null);
    try {
      const r = await fetch("/api/reporting/rules", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dimensionId, targetValueId, priority, description, conditions: buildConditions() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setDescription(""); setLeaves([{ attribute: "className", operator: "eq", value: "", from: "", to: "" }]);
      load();
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  }

  async function delRule(id: string) {
    await fetch(`/api/reporting/rules/${id}`, { method: "DELETE" });
    load();
  }

  const rulesByDim = useMemo(() => {
    const m = new Map<string, Rule[]>();
    for (const r of rules) { const a = m.get(r.dimensionId) ?? []; a.push(r); m.set(r.dimensionId, a); }
    return m;
  }, [rules]);

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-blue-500/15 flex items-center justify-center"><GitBranch size={18} className="text-blue-400" /></div>
        <h1 className="text-xl font-semibold text-stone-100">Classification Rules</h1>
      </div>
      <p className="text-sm text-stone-400 mb-5 ml-12">
        Map QBO activity into your dimensions. Higher-priority and more-specific rules win; anything no rule matches stays <em>Unallocated</em> (never guessed).
      </p>

      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error}</div>}

      {/* Builder */}
      <div className={`${card} p-4 mb-6`}>
        <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-3">New rule</div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-stone-400 text-sm">Set</span>
          <select value={dimensionId} onChange={(e) => { setDimensionId(e.target.value); setTargetValueId(""); }} className={input}>
            {dims.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <span className="text-stone-400 text-sm">=</span>
          <select value={targetValueId} onChange={(e) => setTargetValueId(e.target.value)} className={input}>
            <option value="">— value —</option>
            {targetValues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <span className="text-stone-400 text-sm ml-3">Priority</span>
          <input type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value))} className={`${input} w-20`} />
        </div>

        <div className="flex items-center gap-2 mb-2">
          <span className="text-stone-400 text-sm">IF</span>
          <select value={op} onChange={(e) => setOp(e.target.value as any)} className={input}>
            <option value="AND">ALL of (AND)</option>
            <option value="OR">ANY of (OR)</option>
          </select>
        </div>

        <div className="space-y-2 mb-3">
          {leaves.map((l, i) => {
            const meta = attrMeta(l.attribute);
            const ops = OPERATORS_BY_TYPE[meta?.type ?? "string"];
            return (
              <div key={i} className="flex flex-wrap items-center gap-2 pl-4">
                <select value={l.attribute} onChange={(e) => { const t = attrMeta(e.target.value)?.type ?? "string"; setLeaf(i, { attribute: e.target.value, operator: OPERATORS_BY_TYPE[t][0].op }); }} className={input}>
                  {Object.entries(groupBy(ATTRIBUTE_META, (a) => a.group)).map(([g, items]) => (
                    <optgroup key={g} label={g}>{items.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</optgroup>
                  ))}
                </select>
                <select value={l.operator} onChange={(e) => setLeaf(i, { operator: e.target.value })} className={input}>
                  {ops.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
                </select>
                {!NO_VALUE.has(l.operator) && !RANGE_OP.has(l.operator) && (
                  <input value={l.value} onChange={(e) => setLeaf(i, { value: e.target.value })}
                    placeholder={LIST_OP.has(l.operator) ? "a, b, c" : "value"} className={`${input} w-48`} />
                )}
                {RANGE_OP.has(l.operator) && (
                  <>
                    <input value={l.from} onChange={(e) => setLeaf(i, { from: e.target.value })} placeholder="from" className={`${input} w-28`} />
                    <input value={l.to} onChange={(e) => setLeaf(i, { to: e.target.value })} placeholder="to" className={`${input} w-28`} />
                  </>
                )}
                {leaves.length > 1 && <button onClick={() => setLeaves((ls) => ls.filter((_, idx) => idx !== i))} className="text-stone-500 hover:text-rose-400"><X size={15} /></button>}
              </div>
            );
          })}
          <button onClick={() => setLeaves((ls) => [...ls, { attribute: "accountName", operator: "eq", value: "", from: "", to: "" }])}
            className="ml-4 text-[12px] text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"><Plus size={13} /> add condition</button>
        </div>

        <div className="flex items-center gap-2">
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" className={`${input} flex-1`} />
          <button onClick={saveRule} disabled={saving} className={`${btn} bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40`}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Save rule
          </button>
        </div>
      </div>

      {/* Existing rules */}
      {loading ? (
        <div className="text-sm text-stone-500 py-8">Loading…</div>
      ) : rules.length === 0 ? (
        <div className="text-sm text-stone-500 py-8 text-center">No rules yet. Build your first one above.</div>
      ) : (
        <div className="space-y-5">
          {dims.filter((d) => rulesByDim.get(d.id)?.length).map((d) => (
            <div key={d.id}>
              <div className="text-stone-300 font-medium mb-2">{d.name}</div>
              <div className={`${card} divide-y divide-stone-800`}>
                {(rulesByDim.get(d.id) ?? []).map((r) => (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                    <span className="text-[11px] text-stone-500 tabular-nums w-8">P{r.priority}</span>
                    <span className="text-stone-400">IF</span>
                    <span className="text-stone-200 flex-1">{describeConditions(r.conditions)}</span>
                    <span className="text-stone-500">→</span>
                    <span className="text-blue-300 font-medium">{valById.get(r.targetValueId ?? "")?.name ?? "—"}</span>
                    <button onClick={() => delRule(r.id)} className="text-stone-500 hover:text-rose-400"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function groupBy<T>(arr: T[], key: (t: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const it of arr) { (out[key(it)] ??= []).push(it); }
  return out;
}
