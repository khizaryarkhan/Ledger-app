"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { EntityPicker, useBatchEntities } from "../_components/entity-picker";
import { DownloadCloud, Loader2, ArrowLeft } from "lucide-react";

function DownloadInner() {
  const preset = useSearchParams().get("entity");
  const { entities } = useBatchEntities();
  const [entityId, setEntityId] = useState<string | null>(preset);
  const [dateType, setDateType] = useState("transaction");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [format, setFormat] = useState("xlsx");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const meta = entities.find((e) => e.id === entityId);

  async function run() {
    if (!entityId) return;
    setBusy(true); setError(null); setDone(null);
    try {
      const res = await fetch("/api/batch/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity: entityId, dateType, from: from || undefined, to: to || undefined, format }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Export failed");
      }
      const count = res.headers.get("X-Row-Count");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${entityId}-export.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      setDone(`Exported ${count ?? "?"} record${count === "1" ? "" : "s"}.`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 max-w-5xl">
      {preset && (
        <Link href={`/batch/e/${preset}`} className="inline-flex items-center gap-1.5 text-[13px] text-stone-400 hover:text-stone-200 mb-4">
          <ArrowLeft size={14} /> Back
        </Link>
      )}
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center">
          <DownloadCloud size={18} className="text-amber-400" />
        </div>
        <h1 className="text-xl font-semibold text-stone-100">Export</h1>
      </div>
      <p className="text-sm text-stone-400 mb-6 ml-12">Export QuickBooks data to a spreadsheet. Exports include Id and SyncToken columns so you can edit and re-import via Update.</p>

      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error}</div>}
      {done && <div className="mb-4 px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm">{done}</div>}

      {!preset && <div className="text-sm font-medium text-stone-300 mb-3">1. Choose what to export</div>}
      {!preset && <EntityPicker capability="download" selected={entityId} onSelect={setEntityId} />}

      {entityId && (
        <div className="mt-6 space-y-4 max-w-lg">
          <div className="text-sm font-medium text-stone-300">2. Filter{meta && !meta.hasDateFilter ? " (this entity has no date filter)" : ""}</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date type">
              <select value={dateType} onChange={(e) => setDateType(e.target.value)} disabled={!meta?.hasDateFilter} className={selCls}>
                <option value="transaction">Transaction date</option>
                <option value="created">Created date</option>
                <option value="updated">Last updated date</option>
              </select>
            </Field>
            <Field label="Format">
              <select value={format} onChange={(e) => setFormat(e.target.value)} className={selCls}>
                <option value="xlsx">Excel (.xlsx)</option>
                <option value="csv">CSV (.csv)</option>
              </select>
            </Field>
            <Field label="From">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={!meta?.hasDateFilter} className={selCls} />
            </Field>
            <Field label="To">
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} disabled={!meta?.hasDateFilter} className={selCls} />
            </Field>
          </div>

          <button
            onClick={run}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <DownloadCloud size={15} />}
            Export {meta?.label}
          </button>
        </div>
      )}
    </div>
  );
}

export default function BatchDownloadPage() {
  return <Suspense fallback={<div className="p-6 text-sm text-stone-500">Loading…</div>}><DownloadInner /></Suspense>;
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
