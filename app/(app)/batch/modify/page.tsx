"use client";

import { useState, useRef } from "react";
import { EntityPicker, useBatchEntities } from "../_components/entity-picker";
import { PencilRuler, DownloadCloud, FileSpreadsheet, Loader2, CheckCircle2, XCircle, ArrowLeft } from "lucide-react";

type Step = "pick" | "map" | "result";

export default function BatchModifyPage() {
  const { entities } = useBatchEntities();
  const [step, setStep] = useState<Step>("pick");
  const [entityId, setEntityId] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const meta = entities.find((e) => e.id === entityId);

  async function downloadForEdit() {
    if (!entityId) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/batch/download", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity: entityId, format: "xlsx" }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Download failed"); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${entityId}-to-edit.xlsx`; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function handleFile(file: File) {
    if (!entityId) return;
    setBusy(true); setError(null);
    try {
      const fd = new FormData(); fd.append("entity", entityId); fd.append("file", file);
      const res = await fetch("/api/batch/upload/preview", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to read file");
      if (!data.fileHeaders.some((h: string) => /^id$/i.test(h.trim()))) {
        throw new Error("This file has no 'Id' column. Download the records first, edit them, then re-upload.");
      }
      setPreview(data); setMapping(data.mapping); setStep("map");
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function commit() {
    if (!preview || !entityId) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/batch/upload/commit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity: entityId, operation: "modify", fileName: preview.fileName, mapping, rawRows: preview.rawRows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      setResult(data); setStep("result");
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  function reset() { setStep("pick"); setEntityId(null); setPreview(null); setResult(null); setError(null); }

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center">
          <PencilRuler size={18} className="text-amber-400" />
        </div>
        <h1 className="text-xl font-semibold text-stone-100">Modify</h1>
      </div>
      <p className="text-sm text-stone-400 mb-6 ml-12">Download records, edit them offline, then re-import to update them in QuickBooks.</p>

      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error}</div>}

      {step === "pick" && (
        <div className="space-y-6">
          <div>
            <div className="text-sm font-medium text-stone-300 mb-3">1. Choose what to modify</div>
            <EntityPicker capability="modify" selected={entityId} onSelect={setEntityId} />
          </div>

          {entityId && (
            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium text-stone-300 mb-2">2. Download the current records</div>
                <button onClick={downloadForEdit} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-100 text-sm font-medium disabled:opacity-50">
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <DownloadCloud size={15} />} Download {meta?.label} to edit
                </button>
                <p className="text-[12px] text-stone-500 mt-1.5">The file includes Id and SyncToken columns — keep those intact when you edit.</p>
              </div>

              <div>
                <div className="text-sm font-medium text-stone-300 mb-2">3. Upload the edited file</div>
                <button onClick={() => fileRef.current?.click()} disabled={busy} className="w-full border-2 border-dashed border-stone-700 hover:border-amber-500/50 rounded-xl py-10 flex flex-col items-center justify-center gap-2 transition-colors disabled:opacity-50">
                  {busy ? <Loader2 size={26} className="text-amber-400 animate-spin" /> : <FileSpreadsheet size={26} className="text-stone-500" />}
                  <span className="text-sm text-stone-300 font-medium">Click to upload your edited file</span>
                </button>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
              </div>
            </div>
          )}
        </div>
      )}

      {step === "map" && preview && (
        <div className="space-y-5">
          <button onClick={() => setStep("pick")} className="inline-flex items-center gap-1.5 text-[13px] text-stone-400 hover:text-stone-200"><ArrowLeft size={14} /> Back</button>
          <div className="text-sm text-stone-300">{preview.documentCount} record{preview.documentCount === 1 ? "" : "s"} ready to update from <span className="text-stone-100 font-medium">{preview.fileName}</span></div>
          <button onClick={commit} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium disabled:opacity-50">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <PencilRuler size={15} />} Update {preview.documentCount} record{preview.documentCount === 1 ? "" : "s"} in QuickBooks
          </button>
        </div>
      )}

      {step === "result" && result && (
        <div className="space-y-5">
          <div className="flex gap-4">
            <div className="flex items-center gap-3 px-5 py-3 rounded-lg bg-stone-900 border border-stone-800">
              <CheckCircle2 size={18} className="text-emerald-400" />
              <div><div className="text-2xl font-semibold text-stone-100 tabular-nums">{result.successCount}</div><div className="text-[12px] text-stone-500">Updated</div></div>
            </div>
            <div className="flex items-center gap-3 px-5 py-3 rounded-lg bg-stone-900 border border-stone-800">
              <XCircle size={18} className="text-rose-400" />
              <div><div className="text-2xl font-semibold text-stone-100 tabular-nums">{result.errorCount}</div><div className="text-[12px] text-stone-500">Failed</div></div>
            </div>
          </div>
          {result.errorCount > 0 && (
            <div className="border border-stone-800 rounded-lg overflow-hidden max-h-[320px] overflow-y-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-stone-900"><tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800"><th className="text-left px-4 py-2 w-16">Row</th><th className="text-left px-4 py-2">Reason</th></tr></thead>
                <tbody>{result.results.filter((r: any) => !r.ok).map((r: any) => <tr key={r.row} className="border-b border-stone-800/60"><td className="px-4 py-1.5 text-stone-400">{r.row}</td><td className="px-4 py-1.5 text-rose-300">{r.error}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          <button onClick={reset} className="px-4 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-sm font-medium">Modify more records</button>
        </div>
      )}
    </div>
  );
}
