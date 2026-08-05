"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { EntityPicker, useBatchEntities } from "../_components/entity-picker";
import { Trash2, Loader2, Search, AlertTriangle, ArrowLeft } from "lucide-react";

interface Match { id: string; syncToken: string; docNumber: string; date: string; name: string; amount: number | null; }

function DeleteInner() {
  const preset = useSearchParams().get("entity");
  const { entities } = useBatchEntities();
  const [entityId, setEntityId] = useState<string | null>(preset);
  const [dateType, setDateType] = useState("transaction");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [refNumber, setRefNumber] = useState("");
  const [rows, setRows] = useState<Match[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<{ successCount: number; errorCount: number } | null>(null);

  const meta = entities.find((e) => e.id === entityId);

  async function search() {
    if (!entityId) return;
    setBusy(true); setError(null); setResult(null); setRows(null); setSelected(new Set());
    try {
      const res = await fetch("/api/batch/delete/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity: entityId, dateType, from: from || undefined, to: to || undefined, refNumber: refNumber || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      setRows(data.rows);
      setSelected(new Set(data.rows.map((r: Match) => r.id)));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!entityId || !rows) return;
    setBusy(true); setError(null);
    try {
      const targets = rows.filter((r) => selected.has(r.id)).map((r) => ({ id: r.id, syncToken: r.syncToken }));
      const res = await fetch("/api/batch/delete/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity: entityId, targets }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      setResult(data);
      setRows(null);
      setConfirm(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  return (
    <div className="p-6 max-w-5xl">
      {preset && (
        <Link href={`/batch/e/${preset}`} className="inline-flex items-center gap-1.5 text-[13px] text-stone-400 hover:text-stone-200 mb-4">
          <ArrowLeft size={14} /> Back
        </Link>
      )}
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-rose-500/15 flex items-center justify-center">
          <Trash2 size={18} className="text-rose-400" />
        </div>
        <h1 className="text-xl font-semibold text-stone-100">Delete</h1>
      </div>
      <p className="text-sm text-stone-400 mb-6 ml-12">Find and remove QuickBooks records in bulk. Deletions are permanent in QuickBooks.</p>

      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error}</div>}
      {result && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm">
          Deleted {result.successCount} record{result.successCount === 1 ? "" : "s"}{result.errorCount > 0 ? `, ${result.errorCount} failed` : ""}.
        </div>
      )}

      {!preset && <div className="text-sm font-medium text-stone-300 mb-3">1. Choose what to delete</div>}
      {!preset && <EntityPicker capability="delete" selected={entityId} onSelect={(id) => { setEntityId(id); setRows(null); setResult(null); }} />}

      {entityId && (
        <div className="mt-6 space-y-4">
          <div className="text-sm font-medium text-stone-300">2. Filter</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl">
            <Field label="Date type">
              <select value={dateType} onChange={(e) => setDateType(e.target.value)} disabled={!meta?.hasDateFilter} className={selCls}>
                <option value="transaction">Transaction date</option>
                <option value="created">Created date</option>
                <option value="updated">Last updated date</option>
              </select>
            </Field>
            <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={!meta?.hasDateFilter} className={selCls} /></Field>
            <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} disabled={!meta?.hasDateFilter} className={selCls} /></Field>
            <Field label="Reference no"><input value={refNumber} onChange={(e) => setRefNumber(e.target.value)} placeholder="optional" className={selCls} /></Field>
          </div>
          <button onClick={search} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-100 text-sm font-medium disabled:opacity-50">
            {busy && !rows ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Search
          </button>
        </div>
      )}

      {rows && (
        <div className="mt-6 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-stone-300">{rows.length} match{rows.length === 1 ? "" : "es"} · {selected.size} selected</div>
            <button
              disabled={selected.size === 0 || busy}
              onClick={() => setConfirm(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium disabled:opacity-40"
            >
              <Trash2 size={15} /> Delete {selected.size} selected
            </button>
          </div>
          <div className="border border-stone-800 rounded-lg overflow-hidden max-h-[420px] overflow-y-auto">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-stone-900">
                <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                  <th className="px-3 py-2 w-8"></th>
                  <th className="text-left px-4 py-2 font-semibold">Reference</th>
                  <th className="text-left px-4 py-2 font-semibold">Date</th>
                  <th className="text-left px-4 py-2 font-semibold">Name</th>
                  <th className="text-right px-4 py-2 font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-stone-800/60 hover:bg-stone-800/30 cursor-pointer" onClick={() => toggle(r.id)}>
                    <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="rounded border-stone-600 bg-stone-800 text-rose-500 focus:ring-0" />
                    </td>
                    <td className="px-4 py-1.5 text-stone-200">{r.docNumber}</td>
                    <td className="px-4 py-1.5 text-stone-400 tabular-nums">{r.date}</td>
                    <td className="px-4 py-1.5 text-stone-400">{r.name}</td>
                    <td className="px-4 py-1.5 text-right text-stone-300 tabular-nums">{r.amount != null ? r.amount.toLocaleString() : "—"}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-stone-500">No records matched.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setConfirm(false)}>
          <div className="bg-stone-900 border border-stone-700 rounded-xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <AlertTriangle size={22} className="text-rose-400" />
              <h3 className="text-lg font-semibold text-stone-100">Delete {selected.size} record{selected.size === 1 ? "" : "s"}?</h3>
            </div>
            <p className="text-sm text-stone-400 mb-5">This permanently removes the selected {meta?.label.toLowerCase()} from QuickBooks. This cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirm(false)} className="px-4 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-sm font-medium">Cancel</button>
              <button onClick={commit} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium disabled:opacity-50">
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Delete permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BatchDeletePage() {
  return <Suspense fallback={<div className="p-6 text-sm text-stone-500">Loading…</div>}><DeleteInner /></Suspense>;
}

const selCls = "h-9 px-2 w-full text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-200 focus:border-amber-500 focus:outline-none disabled:opacity-40";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-stone-500 block mb-1">{label}</span>
      {children}
    </label>
  );
}
