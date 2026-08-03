"use client";

import { useState, useRef } from "react";
import { EntityPicker } from "../_components/entity-picker";
import { UploadCloud, FileSpreadsheet, Download, ArrowLeft, CheckCircle2, XCircle, Loader2 } from "lucide-react";

type Step = "pick" | "map" | "result";

interface Preview {
  entity: { id: string; label: string; columns: string[]; docKey: string | null };
  fileName: string;
  fileHeaders: string[];
  mapping: Record<string, string>;
  unmappedColumns: string[];
  totalRows: number;
  documentCount: number;
  previewRows: Record<string, any>[];
  rawRows: Record<string, any>[];
}

interface CommitResult {
  total: number;
  successCount: number;
  errorCount: number;
  results: { row: number; ok: boolean; qboId?: string; docNumber?: string; error?: string }[];
}

export default function BatchUploadPage() {
  const [step, setStep] = useState<Step>("pick");
  const [entityId, setEntityId] = useState<string | null>(null);
  const [entityLabel, setEntityLabel] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!entityId) return;
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("entity", entityId);
      fd.append("file", file);
      const res = await fetch("/api/batch/upload/preview", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to read file");
      setPreview(data);
      setMapping(data.mapping);
      setStep("map");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!preview || !entityId) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/batch/upload/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity: entityId,
          operation: "upload",
          fileName: preview.fileName,
          mapping,
          rawRows: preview.rawRows,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setResult(data);
      setStep("result");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStep("pick"); setEntityId(null); setPreview(null); setMapping({}); setResult(null); setError(null);
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center">
          <UploadCloud size={18} className="text-amber-400" />
        </div>
        <h1 className="text-xl font-semibold text-stone-100">Bulk Upload</h1>
      </div>
      <p className="text-sm text-stone-400 mb-6 ml-12">Import transactions and lists from a spreadsheet into QuickBooks.</p>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error}</div>
      )}

      {/* STEP 1 — pick entity + file */}
      {step === "pick" && (
        <div className="space-y-6">
          <div>
            <div className="text-sm font-medium text-stone-300 mb-3">1. Choose what to import</div>
            <EntityPicker
              capability="upload"
              selected={entityId}
              onSelect={(id) => { setEntityId(id); }}
            />
          </div>

          {entityId && (
            <div>
              <div className="text-sm font-medium text-stone-300 mb-3">2. Upload your file</div>
              <div className="flex items-center gap-3 mb-3">
                <a
                  href={`/api/batch/template?entity=${entityId}`}
                  className="inline-flex items-center gap-1.5 text-[13px] text-amber-400 hover:text-amber-300 font-medium"
                >
                  <Download size={14} /> Download template
                </a>
                <span className="text-[12px] text-stone-500">Includes a “Sample” sheet with your last 10 records for reference.</span>
              </div>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="w-full border-2 border-dashed border-stone-700 hover:border-amber-500/50 rounded-xl py-12 flex flex-col items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                {busy ? <Loader2 size={28} className="text-amber-400 animate-spin" /> : <FileSpreadsheet size={28} className="text-stone-500" />}
                <span className="text-sm text-stone-300 font-medium">{busy ? "Reading file…" : "Click to choose an Excel or CSV file"}</span>
                <span className="text-[12px] text-stone-500">.xlsx, .xls, or .csv · up to 10 MB</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
              />
            </div>
          )}
        </div>
      )}

      {/* STEP 2 — map + preview */}
      {step === "map" && preview && (
        <div className="space-y-5">
          <button onClick={() => setStep("pick")} className="inline-flex items-center gap-1.5 text-[13px] text-stone-400 hover:text-stone-200">
            <ArrowLeft size={14} /> Back
          </button>

          <div className="flex flex-wrap gap-4 text-sm">
            <Stat label="File" value={preview.fileName} />
            <Stat label="Importing as" value={preview.entity.label} />
            <Stat label="Rows" value={String(preview.totalRows)} />
            <Stat label={preview.entity.docKey ? "Documents" : "Records"} value={String(preview.documentCount)} />
          </div>

          <div>
            <div className="text-sm font-medium text-stone-300 mb-2">Column mapping</div>
            <div className="border border-stone-800 rounded-lg overflow-hidden max-h-[360px] overflow-y-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-stone-900">
                  <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                    <th className="text-left px-4 py-2 font-semibold">QuickBooks field</th>
                    <th className="text-left px-4 py-2 font-semibold">Your column</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.entity.columns.map((col) => {
                    const c = col.trim();
                    return (
                      <tr key={c} className="border-b border-stone-800/60">
                        <td className="px-4 py-1.5 text-stone-300">{c}</td>
                        <td className="px-4 py-1.5">
                          <select
                            value={mapping[c] || ""}
                            onChange={(e) => setMapping((m) => ({ ...m, [c]: e.target.value }))}
                            className="h-7 px-2 text-[12px] rounded border border-stone-700 bg-stone-800/60 text-stone-200 focus:border-amber-500 focus:outline-none min-w-[180px]"
                          >
                            <option value="">— not mapped —</option>
                            {preview.fileHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={commit}
              disabled={busy}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium disabled:opacity-50"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <UploadCloud size={15} />}
              Import {preview.documentCount} {preview.entity.docKey ? "document" : "record"}{preview.documentCount !== 1 ? "s" : ""} to QuickBooks
            </button>
            <span className="text-[12px] text-stone-500">Records are created live in your connected QuickBooks company.</span>
          </div>
        </div>
      )}

      {/* STEP 3 — results */}
      {step === "result" && result && (
        <div className="space-y-5">
          <div className="flex gap-4">
            <ResultTile icon={<CheckCircle2 size={18} className="text-emerald-400" />} label="Created" value={result.successCount} />
            <ResultTile icon={<XCircle size={18} className="text-rose-400" />} label="Failed" value={result.errorCount} />
          </div>

          {result.errorCount > 0 && (
            <div>
              <div className="text-sm font-medium text-stone-300 mb-2">Errors</div>
              <div className="border border-stone-800 rounded-lg overflow-hidden max-h-[320px] overflow-y-auto">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 bg-stone-900">
                    <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                      <th className="text-left px-4 py-2 font-semibold w-16">Row</th>
                      <th className="text-left px-4 py-2 font-semibold">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.results.filter((r) => !r.ok).map((r) => (
                      <tr key={r.row} className="border-b border-stone-800/60">
                        <td className="px-4 py-1.5 text-stone-400 tabular-nums">{r.row}</td>
                        <td className="px-4 py-1.5 text-rose-300">{r.error}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <button onClick={reset} className="px-4 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-sm font-medium">
            Import another file
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-stone-500">{label}</div>
      <div className="text-stone-200 font-medium">{value}</div>
    </div>
  );
}

function ResultTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 px-5 py-3 rounded-lg bg-stone-900 border border-stone-800">
      {icon}
      <div>
        <div className="text-2xl font-semibold text-stone-100 tabular-nums">{value}</div>
        <div className="text-[12px] text-stone-500">{label}</div>
      </div>
    </div>
  );
}
