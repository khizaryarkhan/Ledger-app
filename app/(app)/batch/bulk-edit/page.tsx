"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { EntityPicker } from "../_components/entity-picker";
import { Tags, Loader2, CheckCircle2, XCircle, ArrowLeft, Search, AlertTriangle } from "lucide-react";

type Ref = { id: string; name: string };
type CFDef = { definitionId: string; name: string };
type Meta = {
  supported: boolean; connected: boolean; classPerLine: boolean;
  classes: Ref[]; locations: Ref[]; customers: Ref[];
  customFields: CFDef[]; supportsEmail: boolean;
  statuses: string[]; label: string;
};
type Row = {
  id: string; docNumber: string | null; customer: string | null; txnDate: string | null;
  total: number | null; className: string | null; location: string | null;
  linkedInvoices: number; status: string | null;
};

function BulkEditInner() {
  const preset = useSearchParams().get("entity");
  const [entityId, setEntityId] = useState<string | null>(preset);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // filters
  const [customerId, setCustomerId] = useState("");
  const [custQuery, setCustQuery] = useState("");   // searchable customer/project picker
  const [custOpen, setCustOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");

  // records
  const [rows, setRows] = useState<Row[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [truncated, setTruncated] = useState(false);

  // values to set
  const [setClassId, setSetClassId] = useState("");
  const [setLocationId, setSetLocationId] = useState("");
  const [setEmail, setSetEmail] = useState("");
  const [cfValues, setCfValues] = useState<Record<string, string>>({});

  // apply
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<{ status: string; processed: number; total: number; successCount: number; errorCount: number } | null>(null);
  const [result, setResult] = useState<any>(null);
  const pollTimer = useRef<any>(null);
  useEffect(() => () => { if (pollTimer.current) clearTimeout(pollTimer.current); }, []);

  useEffect(() => {
    if (!entityId) { setMeta(null); return; }
    setMetaLoading(true); setError(null); setMeta(null); setRows(null); setSelected(new Set());
    setCustomerId(""); setCustQuery(""); setSetClassId(""); setSetLocationId(""); setSetEmail(""); setCfValues({});
    fetch(`/api/batch/bulk-edit/meta?entity=${encodeURIComponent(entityId)}`)
      .then((r) => r.json())
      .then((d) => setMeta(d))
      .catch(() => setError("Couldn't load this entity's Class/Location lists."))
      .finally(() => setMetaLoading(false));
  }, [entityId]);

  async function search() {
    if (!entityId) return;
    setSearching(true); setError(null); setResult(null); setProgress(null);
    try {
      const res = await fetch("/api/batch/bulk-edit/search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity: entityId, customerId: customerId || undefined, from: from || undefined, to: to || undefined, status: status || undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Search failed");
      setRows(d.rows); setTruncated(!!d.truncated);
      setSelected(new Set(d.rows.map((r: Row) => r.id))); // preselect all
    } catch (e: any) { setError(e.message); } finally { setSearching(false); }
  }

  function toggle(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    if (!rows) return;
    setSelected((s) => s.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)));
  }

  const cfPayload = () => (meta?.customFields || [])
    .filter((cf) => (cfValues[cf.definitionId] ?? "").trim() !== "")
    .map((cf) => ({ definitionId: cf.definitionId, name: cf.name, value: cfValues[cf.definitionId].trim() }));

  async function apply() {
    if (!entityId || selected.size === 0) return;
    const cfs = cfPayload();
    if (!setClassId && !setLocationId && !setEmail.trim() && cfs.length === 0) {
      setError("Pick at least one field to set (Class, Location, Email or a custom field).");
      return;
    }
    setApplying(true); setError(null);
    try {
      const res = await fetch("/api/batch/bulk-edit/apply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity: entityId, ids: [...selected], setClassId: setClassId || undefined, setLocationId: setLocationId || undefined, setEmail: setEmail.trim() || undefined, customFields: cfs }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Update failed");
      setProgress({ status: "running", processed: 0, total: d.total, successCount: 0, errorCount: 0 });
      poll(d.jobId);
    } catch (e: any) { setError(e.message); } finally { setApplying(false); }
  }

  function poll(jobId: string) {
    let misses = 0;
    const tick = async () => {
      try {
        const r = await fetch(`/api/batch/jobs/${jobId}`);
        const j = await r.json();
        if (r.ok) {
          misses = 0;
          setProgress({ status: j.status, processed: j.processed, total: j.totalRows, successCount: j.successCount, errorCount: j.errorCount });
          if (j.status === "done" || j.status === "failed") { setResult(j); return; }
        } else if (++misses > 10) { setError("Lost track of the job — check Job History."); return; }
      } catch { if (++misses > 10) { setError("Connection lost — check Job History."); return; } }
      pollTimer.current = setTimeout(tick, 1200);
    };
    tick();
  }

  const perLineWarning = meta?.classPerLine && entityId === "estimate";
  const hasCf = Object.values(cfValues).some((v) => v && v.trim() !== "");
  const canApply = selected.size > 0 && (!!setClassId || !!setLocationId || !!setEmail.trim() || hasCf) && !applying && !progress;

  return (
    <div className="p-6 max-w-6xl">
      {preset && (
        <Link href={`/batch/e/${preset}`} className="inline-flex items-center gap-1.5 text-[13px] text-stone-400 hover:text-stone-200 mb-4">
          <ArrowLeft size={14} /> Back
        </Link>
      )}
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-sky-500/15 flex items-center justify-center"><Tags size={18} className="text-sky-400" /></div>
        <h1 className="text-xl font-semibold text-stone-100">Bulk edit fields</h1>
      </div>
      <p className="text-sm text-stone-400 mb-6 ml-12">Set <b>Class</b>, <b>Location</b>, <b>Email</b> or <b>custom fields</b> on many records at once — safely. This changes only those fields and never touches lines or links.</p>

      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error}</div>}

      {!preset && (
        <div className="mb-6">
          <div className="text-sm font-medium text-stone-300 mb-3">1. Choose what to edit</div>
          <EntityPicker capability="modify" selected={entityId} onSelect={setEntityId} />
        </div>
      )}

      {metaLoading && <div className="text-sm text-stone-500 py-6">Loading Class / Location lists…</div>}

      {meta && !meta.connected && <div className="text-sm text-amber-400 py-4">QuickBooks isn't connected for this organisation.</div>}
      {meta && meta.connected && meta.classes.length === 0 && meta.locations.length === 0 && (
        <div className="text-sm text-stone-400 py-4">This company has no Class or Location lists set up, so there's nothing to bulk-edit here.</div>
      )}

      {meta && meta.connected && (meta.classes.length > 0 || meta.locations.length > 0) && (
        <div className="space-y-6">
          {/* Filters */}
          <div>
            <div className="text-sm font-medium text-stone-300 mb-2">{preset ? "1" : "2"}. Find records</div>
            <div className="flex flex-wrap items-end gap-3">
              {meta.customers.length > 0 && (
                <div className="relative text-[12px] text-stone-400">Customer / Project
                  <input
                    value={custQuery}
                    onChange={(e) => { setCustQuery(e.target.value); setCustOpen(true); setCustomerId(""); }}
                    onFocus={() => setCustOpen(true)}
                    onBlur={() => setTimeout(() => setCustOpen(false), 150)}
                    placeholder="Type to search…"
                    className="mt-1 block w-64 bg-stone-900 border border-stone-700 rounded-lg px-2 py-1.5 text-sm text-stone-100"
                  />
                  {custOpen && (
                    <div className="absolute z-20 mt-1 w-64 max-h-60 overflow-y-auto bg-stone-900 border border-stone-700 rounded-lg shadow-xl">
                      <button onMouseDown={() => { setCustomerId(""); setCustQuery(""); setCustOpen(false); }} className="block w-full text-left px-3 py-1.5 text-sm text-stone-400 hover:bg-stone-800">Any customer</button>
                      {meta.customers
                        .filter((c) => c.name.toLowerCase().includes(custQuery.trim().toLowerCase()))
                        .slice(0, 50)
                        .map((c) => (
                          <button key={c.id} onMouseDown={() => { setCustomerId(c.id); setCustQuery(c.name); setCustOpen(false); }}
                            className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-stone-800 ${customerId === c.id ? "text-sky-300" : "text-stone-200"}`}>{c.name}</button>
                        ))}
                      {meta.customers.filter((c) => c.name.toLowerCase().includes(custQuery.trim().toLowerCase())).length === 0 && (
                        <div className="px-3 py-2 text-sm text-stone-500">No match</div>
                      )}
                    </div>
                  )}
                </div>
              )}
              <label className="text-[12px] text-stone-400">From
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block bg-stone-900 border border-stone-700 rounded-lg px-2 py-1.5 text-sm text-stone-100" />
              </label>
              <label className="text-[12px] text-stone-400">To
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block bg-stone-900 border border-stone-700 rounded-lg px-2 py-1.5 text-sm text-stone-100" />
              </label>
              {meta.statuses.length > 0 && (
                <label className="text-[12px] text-stone-400">Status
                  <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 block bg-stone-900 border border-stone-700 rounded-lg px-2 py-1.5 text-sm text-stone-100">
                    <option value="">Any</option>
                    {meta.statuses.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
              )}
              <button onClick={search} disabled={searching} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-100 text-sm font-medium disabled:opacity-50">
                {searching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Load records
              </button>
            </div>
          </div>

          {/* Records */}
          {rows && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[13px] text-stone-400">{rows.length} record{rows.length === 1 ? "" : "s"} found · <span className="text-stone-200">{selected.size} selected</span>{truncated && <span className="text-amber-400"> · showing first 1000</span>}</div>
                <button onClick={toggleAll} className="text-[12px] text-sky-400 hover:text-sky-300">{selected.size === rows.length ? "Deselect all" : "Select all"}</button>
              </div>
              <div className="border border-stone-800 rounded-lg overflow-hidden max-h-[340px] overflow-y-auto">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 bg-stone-900 text-[11px] uppercase tracking-wider text-stone-500">
                    <tr className="border-b border-stone-800">
                      <th className="w-8 px-2 py-2"></th>
                      <th className="text-left px-3 py-2">No.</th>
                      <th className="text-left px-3 py-2">Customer</th>
                      <th className="text-left px-3 py-2">Date</th>
                      <th className="text-right px-3 py-2">Total</th>
                      <th className="text-left px-3 py-2">Class</th>
                      <th className="text-left px-3 py-2">Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b border-stone-800/60 hover:bg-stone-800/30">
                        <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                        <td className="px-3 py-1.5 text-stone-200">
                          {r.docNumber ?? r.id}
                          {r.linkedInvoices > 0 && <span title={`${r.linkedInvoices} linked invoice(s)`} className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400">🔗 {r.linkedInvoices}</span>}
                        </td>
                        <td className="px-3 py-1.5 text-stone-400">{r.customer ?? "—"}</td>
                        <td className="px-3 py-1.5 text-stone-400">{r.txnDate ?? "—"}</td>
                        <td className="px-3 py-1.5 text-right text-stone-400 tabular-nums">{r.total ?? "—"}</td>
                        <td className="px-3 py-1.5 text-stone-400">{r.className ?? "—"}</td>
                        <td className="px-3 py-1.5 text-stone-400">{r.location ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Set values */}
          {rows && rows.length > 0 && !result && (
            <div>
              <div className="text-sm font-medium text-stone-300 mb-2">{preset ? "2" : "3"}. Set new values</div>
              {perLineWarning && (
                <div className="mb-3 flex items-start gap-2 text-[12px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>Your company tracks Class <b>per line</b>. Estimates linked to an invoice (🔗) will be <b>skipped</b> when setting Class, because updating their lines would break the invoice link. Location is always safe.</span>
                </div>
              )}
              <div className="flex flex-wrap items-end gap-3">
                {meta.classes.length > 0 && (
                  <label className="text-[12px] text-stone-400">Set Class to
                    <select value={setClassId} onChange={(e) => setSetClassId(e.target.value)} className="mt-1 block w-56 bg-stone-900 border border-stone-700 rounded-lg px-2 py-1.5 text-sm text-stone-100">
                      <option value="">— leave unchanged —</option>
                      {meta.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>
                )}
                {meta.locations.length > 0 && (
                  <label className="text-[12px] text-stone-400">Set Location to
                    <select value={setLocationId} onChange={(e) => setSetLocationId(e.target.value)} className="mt-1 block w-56 bg-stone-900 border border-stone-700 rounded-lg px-2 py-1.5 text-sm text-stone-100">
                      <option value="">— leave unchanged —</option>
                      {meta.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </label>
                )}
                {meta.supportsEmail && (
                  <label className="text-[12px] text-stone-400">Set Email to
                    <input type="email" value={setEmail} onChange={(e) => setSetEmail(e.target.value)} placeholder="name@company.com"
                      className="mt-1 block w-56 bg-stone-900 border border-stone-700 rounded-lg px-2 py-1.5 text-sm text-stone-100" />
                  </label>
                )}
                {meta.customFields.map((cf) => (
                  <label key={cf.definitionId} className="text-[12px] text-stone-400">Set {cf.name} to
                    <input value={cfValues[cf.definitionId] ?? ""} onChange={(e) => setCfValues((v) => ({ ...v, [cf.definitionId]: e.target.value }))} placeholder="— leave unchanged —"
                      className="mt-1 block w-56 bg-stone-900 border border-stone-700 rounded-lg px-2 py-1.5 text-sm text-stone-100" />
                  </label>
                ))}
                <button onClick={apply} disabled={!canApply} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium disabled:opacity-50">
                  {applying || progress ? <Loader2 size={15} className="animate-spin" /> : <Tags size={15} />} Apply to {selected.size} record{selected.size === 1 ? "" : "s"}
                </button>
              </div>
            </div>
          )}

          {/* Progress */}
          {progress && !result && (
            <div className="max-w-lg space-y-2">
              <div className="flex items-center gap-2 text-sm text-stone-300"><Loader2 size={15} className="animate-spin text-sky-400" /> Updating QuickBooks…</div>
              <div className="h-2 rounded-full bg-stone-800 overflow-hidden"><div className="h-full bg-sky-500 transition-all duration-500" style={{ width: `${progress.total ? Math.round((progress.processed / progress.total) * 100) : 0}%` }} /></div>
              <div className="text-[12px] text-stone-500 tabular-nums">{progress.processed} / {progress.total} · <span className="text-emerald-400">{progress.successCount} ok</span>{progress.errorCount > 0 && <> · <span className="text-rose-400">{progress.errorCount} failed</span></>}</div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="flex items-center gap-3 px-5 py-3 rounded-lg bg-stone-900 border border-stone-800"><CheckCircle2 size={18} className="text-emerald-400" /><div><div className="text-2xl font-semibold text-stone-100 tabular-nums">{result.successCount}</div><div className="text-[12px] text-stone-500">Updated</div></div></div>
                <div className="flex items-center gap-3 px-5 py-3 rounded-lg bg-stone-900 border border-stone-800"><XCircle size={18} className="text-rose-400" /><div><div className="text-2xl font-semibold text-stone-100 tabular-nums">{result.errorCount}</div><div className="text-[12px] text-stone-500">Skipped / failed</div></div></div>
              </div>
              {result.errorCount > 0 && result.results && (
                <div className="border border-stone-800 rounded-lg overflow-hidden max-h-[300px] overflow-y-auto">
                  <table className="w-full text-[13px]"><thead className="sticky top-0 bg-stone-900"><tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800"><th className="text-left px-4 py-2 w-16">Row</th><th className="text-left px-4 py-2">Reason</th></tr></thead>
                    <tbody>{result.results.filter((r: any) => !r.ok).map((r: any) => <tr key={r.row} className="border-b border-stone-800/60"><td className="px-4 py-1.5 text-stone-400">{r.row}</td><td className="px-4 py-1.5 text-rose-300">{r.error}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
              <button onClick={() => { setResult(null); setProgress(null); search(); }} className="px-4 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-sm font-medium">Reload & edit more</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function BatchBulkEditPage() {
  return <Suspense fallback={<div className="p-6 text-sm text-stone-500">Loading…</div>}><BulkEditInner /></Suspense>;
}
