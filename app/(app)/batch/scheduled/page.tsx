"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useBatchEntities } from "../_components/entity-picker";
import { Clock, Plus, Play, Trash2, Loader2, CheckCircle2, Link2 } from "lucide-react";

interface Schedule {
  id: string; entityId: string; name: string; spreadsheetId: string;
  sheetRange: string; cadence: string; active: boolean; lastRunAt: string | null;
}

const selCls = "h-9 px-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-200 focus:border-amber-500 focus:outline-none";

function ScheduledInner() {
  const banner = useSearchParams().get("sheets");
  const { entities } = useBatchEntities();
  const importable = entities.filter((e) => e.supports.upload);

  const [connected, setConnected] = useState<boolean | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // form state
  const [name, setName] = useState("");
  const [entityId, setEntityId] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetRange, setSheetRange] = useState("Sheet1");
  const [cadence, setCadence] = useState("daily");

  const load = useCallback(() => {
    fetch("/api/google-sheets").then((r) => r.json()).then((d) => { setConnected(!!d.connected); setEmail(d.email); }).catch(() => setConnected(false));
    fetch("/api/batch/scheduled").then((r) => r.json()).then((d) => setSchedules(d.schedules || [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/batch/scheduled", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, name, sheetUrl, sheetRange, cadence }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Couldn't create schedule");
      setShowForm(false); setName(""); setEntityId(""); setSheetUrl(""); setSheetRange("Sheet1"); setCadence("daily");
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function runNow(id: string) { await fetch(`/api/batch/scheduled/${id}/run`, { method: "POST" }); alert("Import queued — check Job History."); }
  async function toggle(s: Schedule) { await fetch(`/api/batch/scheduled/${s.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !s.active }) }); load(); }
  async function remove(id: string) { if (!confirm("Delete this schedule?")) return; await fetch(`/api/batch/scheduled/${id}`, { method: "DELETE" }); load(); }

  const entityLabel = (id: string) => entities.find((e) => e.id === id)?.label ?? id;

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center"><Clock size={18} className="text-amber-400" /></div>
        <h1 className="text-xl font-semibold text-stone-100">Scheduled Imports</h1>
      </div>
      <p className="text-sm text-stone-400 mb-6 ml-12">Keep a Google Sheet in sync with QuickBooks — it re-imports on a schedule.</p>

      {banner === "connected" && <div className="mb-4 px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm">Google Sheets connected.</div>}
      {banner === "error" && <div className="mb-4 px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">Couldn't connect Google Sheets. Try again.</div>}
      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error}</div>}

      {/* Connection */}
      <div className="mb-6 flex items-center justify-between rounded-lg border border-stone-800 bg-stone-900 px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <Link2 size={15} className={connected ? "text-emerald-400" : "text-stone-500"} />
          {connected === null ? <span className="text-stone-500">Checking Google Sheets…</span>
            : connected ? <span className="text-stone-300">Google Sheets connected <span className="text-stone-500">· {email}</span></span>
            : <span className="text-stone-400">Google Sheets not connected</span>}
        </div>
        {connected ? (
          <button onClick={async () => { await fetch("/api/google-sheets/disconnect", { method: "POST" }); load(); }} className="text-[13px] text-stone-400 hover:text-rose-300">Disconnect</button>
        ) : (
          <a href="/api/google-sheets/connect" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[13px] font-medium">Connect Google Sheets</a>
        )}
      </div>

      {/* Create */}
      {connected && (
        <div className="mb-6">
          {!showForm ? (
            <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-100 text-sm font-medium"><Plus size={15} /> New scheduled import</button>
          ) : (
            <div className="rounded-lg border border-stone-800 bg-stone-900 p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block"><span className="text-[11px] uppercase tracking-wider text-stone-500 block mb-1">Name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Monthly invoices" className={`${selCls} w-full`} /></label>
                <label className="block"><span className="text-[11px] uppercase tracking-wider text-stone-500 block mb-1">Import as</span>
                  <select value={entityId} onChange={(e) => setEntityId(e.target.value)} className={`${selCls} w-full`}>
                    <option value="">Choose entity…</option>
                    {importable.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
                  </select></label>
                <label className="block sm:col-span-2"><span className="text-[11px] uppercase tracking-wider text-stone-500 block mb-1">Google Sheet URL</span>
                  <input value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" className={`${selCls} w-full`} /></label>
                <label className="block"><span className="text-[11px] uppercase tracking-wider text-stone-500 block mb-1">Tab / range</span>
                  <input value={sheetRange} onChange={(e) => setSheetRange(e.target.value)} placeholder="Sheet1" className={`${selCls} w-full`} /></label>
                <label className="block"><span className="text-[11px] uppercase tracking-wider text-stone-500 block mb-1">Runs</span>
                  <select value={cadence} onChange={(e) => setCadence(e.target.value)} className={`${selCls} w-full`}>
                    <option value="hourly">Hourly</option><option value="daily">Daily</option><option value="weekly">Weekly</option>
                  </select></label>
              </div>
              <p className="text-[12px] text-stone-500">The sheet's column headers should match the import template's columns (they're auto-mapped each run).</p>
              <div className="flex gap-2">
                <button onClick={create} disabled={busy || !name || !entityId || !sheetUrl} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium disabled:opacity-40">
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Create schedule
                </button>
                <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-sm">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* List */}
      <div className="border border-stone-800 rounded-lg overflow-hidden">
        <table className="w-full text-[13px]">
          <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
            <th className="text-left px-4 py-2.5 font-semibold">Name</th>
            <th className="text-left px-4 py-2.5 font-semibold">Entity</th>
            <th className="text-left px-4 py-2.5 font-semibold">Runs</th>
            <th className="text-left px-4 py-2.5 font-semibold">Last run</th>
            <th className="text-right px-4 py-2.5 font-semibold"></th>
          </tr></thead>
          <tbody>
            {schedules.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-stone-500">No scheduled imports yet.</td></tr>}
            {schedules.map((s) => (
              <tr key={s.id} className="border-b border-stone-800/60">
                <td className="px-4 py-2 text-stone-200">{s.name}{!s.active && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-stone-800 text-stone-500">paused</span>}</td>
                <td className="px-4 py-2 text-stone-400">{entityLabel(s.entityId)}</td>
                <td className="px-4 py-2 text-stone-400 capitalize">{s.cadence}</td>
                <td className="px-4 py-2 text-stone-500">{s.lastRunAt ? new Date(s.lastRunAt).toLocaleString("en-IE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                <td className="px-4 py-2 text-right">
                  <div className="inline-flex items-center gap-3">
                    <button onClick={() => runNow(s.id)} title="Run now" className="text-stone-400 hover:text-amber-300"><Play size={14} /></button>
                    <button onClick={() => toggle(s)} className="text-[12px] text-stone-400 hover:text-stone-200">{s.active ? "Pause" : "Resume"}</button>
                    <button onClick={() => remove(s.id)} title="Delete" className="text-stone-400 hover:text-rose-300"><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ScheduledImportsPage() {
  return <Suspense fallback={<div className="p-6 text-sm text-stone-500">Loading…</div>}><ScheduledInner /></Suspense>;
}
