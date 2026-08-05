"use client";

import { useState, useRef, useMemo, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { EntityPicker } from "../_components/entity-picker";
import { UploadCloud, FileSpreadsheet, Download, ArrowLeft, CheckCircle2, XCircle, Loader2, AlertCircle } from "lucide-react";

interface RefInfo {
  columns: { column: string; kind: string }[];
  options: Record<string, string[]>;
  connected: boolean;
}

type Step = "pick" | "map" | "running" | "result";

interface Progress { status: string; processed: number; total: number; successCount: number; errorCount: number; }

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

function UploadInner() {
  const preset = useSearchParams().get("entity");
  const [step, setStep] = useState<Step>("pick");
  const [entityId, setEntityId] = useState<string | null>(preset);
  const [entityLabel, setEntityLabel] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [refInfo, setRefInfo] = useState<RefInfo | null>(null);
  // overrides: { canonicalColumn: { originalValue: chosenQboValue } }
  const [overrides, setOverrides] = useState<Record<string, Record<string, string>>>({});
  const [progress, setProgress] = useState<Progress | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pollTimer = useRef<any>(null);
  useEffect(() => () => { if (pollTimer.current) clearTimeout(pollTimer.current); }, []);

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
      setOverrides({});
      setStep("map");
      // Load valid QBO reference values for the dropdowns (non-blocking).
      fetch(`/api/batch/refs?entity=${entityId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d) setRefInfo(d); })
        .catch(() => {});
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
          overrides,
          rawRows: preview.rawRows,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setProgress({ status: "queued", processed: 0, total: data.total ?? preview.documentCount, successCount: 0, errorCount: 0 });
      setStep("running");
      poll(data.jobId);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
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
          if (j.status === "done" || j.status === "failed") {
            setResult({ total: j.totalRows, successCount: j.successCount, errorCount: j.errorCount, results: j.results || [] });
            setStep("result");
            return;
          }
        } else if (++misses > 10) {
          setError("Lost track of the job — check Job History for the result."); return;
        }
      } catch { if (++misses > 10) { setError("Connection lost — check Job History for the result."); return; } }
      pollTimer.current = setTimeout(tick, 1500);
    };
    tick();
  }

  function reset() {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    setStep("pick"); setEntityId(preset); setPreview(null); setMapping({}); setResult(null); setError(null);
    setRefInfo(null); setOverrides({}); setProgress(null);
  }

  // Which reference columns have values that don't match a QBO record → need a dropdown.
  const refReview = useMemo(() => {
    if (!preview || !refInfo?.connected) return [];
    const out: { column: string; kind: string; options: string[]; unmatched: string[]; matched: number }[] = [];
    for (const rc of refInfo.columns) {
      const fileHeader = mapping[rc.column];
      if (!fileHeader) continue;
      const opts = refInfo.options[rc.kind] || [];
      const optSet = new Set(opts.map((o) => o.trim().toLowerCase()));
      const distinct = new Set<string>();
      for (const row of preview.rawRows) {
        const v = row[fileHeader];
        if (v != null && String(v).trim() !== "") distinct.add(String(v).trim());
      }
      if (distinct.size === 0) continue;
      const unmatched: string[] = [];
      let matched = 0;
      for (const v of distinct) {
        if (optSet.has(v.toLowerCase())) matched++;
        else unmatched.push(v);
      }
      out.push({ column: rc.column, kind: rc.kind, options: opts, unmatched, matched });
    }
    return out;
  }, [preview, refInfo, mapping]);

  const totalUnmatched = refReview.reduce((s, r) => s + r.unmatched.length, 0);
  const unresolved = refReview.reduce(
    (s, r) => s + r.unmatched.filter((v) => !overrides[r.column]?.[v]).length, 0
  );

  function setOverride(column: string, original: string, chosen: string) {
    setOverrides((o) => {
      const next = { ...o, [column]: { ...(o[column] || {}) } };
      if (chosen) next[column][original] = chosen;
      else delete next[column][original];
      return next;
    });
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
          <UploadCloud size={18} className="text-amber-400" />
        </div>
        <h1 className="text-xl font-semibold text-stone-100">Import</h1>
      </div>
      <p className="text-sm text-stone-400 mb-6 ml-12">Import transactions and lists from a spreadsheet into QuickBooks.</p>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error}</div>
      )}

      {/* STEP 1 — pick entity + file */}
      {step === "pick" && (
        <div className="space-y-6">
          {!preset && (
            <div>
              <div className="text-sm font-medium text-stone-300 mb-3">1. Choose what to import</div>
              <EntityPicker
                capability="upload"
                selected={entityId}
                onSelect={(id) => { setEntityId(id); }}
              />
            </div>
          )}

          {entityId && (
            <div>
              <div className="text-sm font-medium text-stone-300 mb-3">2. Upload your file</div>
              <div className="flex items-center gap-3 mb-3">
                <a
                  href={`/api/batch/template?entity=${entityId}`}
                  className="inline-flex items-center gap-1.5 text-[13px] text-amber-400 hover:text-amber-300 font-medium"
                >
                  <Download size={14} /> {entityId === "estimateinvoice" ? "Download accepted estimates" : "Download template"}
                </a>
                <span className="text-[12px] text-stone-500">
                  {entityId === "estimateinvoice"
                    ? "One row per estimate line. Fill the amber Qty/Amount to Invoice columns (the blue Remaining shows what’s left), then upload."
                    : "Includes a “Sample” sheet with your last 10 records for reference."}
                </span>
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

          {/* Reference confirmation — values that must exist in QuickBooks */}
          {refInfo && !refInfo.connected && (
            <div className="px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[13px]">
              QuickBooks isn’t connected, so reference values can’t be validated before import.
            </div>
          )}
          {refReview.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="text-sm font-medium text-stone-300">Confirm references</div>
                {totalUnmatched === 0 ? (
                  <span className="inline-flex items-center gap-1 text-[12px] text-emerald-400"><CheckCircle2 size={13} /> all values match QuickBooks</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[12px] text-amber-400"><AlertCircle size={13} /> {unresolved} value{unresolved === 1 ? "" : "s"} need a match</span>
                )}
              </div>

              {/* datalists — one per reference kind, shared across inputs */}
              {[...new Set(refReview.map((r) => r.kind))].map((kind) => (
                <datalist key={kind} id={`dl-${kind}`}>
                  {(refInfo?.options[kind] || []).map((o) => <option key={o} value={o} />)}
                </datalist>
              ))}

              <div className="space-y-3">
                {refReview.filter((r) => r.unmatched.length > 0).map((r) => (
                  <div key={r.column} className="border border-stone-800 rounded-lg p-3">
                    <div className="text-[13px] text-stone-300 mb-2">
                      <span className="font-medium">{r.column}</span>
                      <span className="text-stone-500"> · {r.kind} · {r.matched} matched, {r.unmatched.length} to confirm</span>
                    </div>
                    <div className="space-y-1.5">
                      {r.unmatched.map((val) => {
                        const chosen = overrides[r.column]?.[val] || "";
                        return (
                          <div key={val} className="flex items-center gap-2 text-[13px]">
                            <span className="text-rose-300 min-w-[160px] truncate" title={val}>{val}</span>
                            <span className="text-stone-600">→</span>
                            <input
                              list={`dl-${r.kind}`}
                              value={chosen}
                              onChange={(e) => setOverride(r.column, val, e.target.value)}
                              placeholder={`Choose a QuickBooks ${r.kind.toLowerCase()}…`}
                              className={`h-8 px-2 text-[12px] rounded border bg-stone-800/60 text-stone-200 focus:outline-none flex-1 min-w-[220px] ${chosen ? "border-emerald-600/60" : "border-amber-600/50"}`}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              {totalUnmatched > 0 && (
                <p className="text-[12px] text-stone-500 mt-2">
                  Unmatched values that you don’t map will fail on import and show in the results — you can fix and re-import those rows.
                </p>
              )}
            </div>
          )}

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

      {/* STEP 2.5 — running (background job progress) */}
      {step === "running" && progress && (
        <div className="space-y-4 max-w-lg">
          <div className="flex items-center gap-2 text-sm text-stone-300">
            <Loader2 size={15} className="animate-spin text-amber-400" />
            {progress.status === "queued" ? "Queued — starting…" : "Importing to QuickBooks…"}
          </div>
          <div className="h-2 rounded-full bg-stone-800 overflow-hidden">
            <div
              className="h-full bg-amber-500 transition-all duration-500"
              style={{ width: `${progress.total ? Math.round((progress.processed / progress.total) * 100) : 0}%` }}
            />
          </div>
          <div className="text-[12px] text-stone-500 tabular-nums">
            {progress.processed} / {progress.total} processed · <span className="text-emerald-400">{progress.successCount} ok</span>
            {progress.errorCount > 0 && <> · <span className="text-rose-400">{progress.errorCount} failed</span></>}
          </div>
          <p className="text-[12px] text-stone-500">This runs in the background — you can leave this page and check Job History anytime.</p>
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

export default function BatchUploadPage() {
  return <Suspense fallback={<div className="p-6 text-sm text-stone-500">Loading…</div>}><UploadInner /></Suspense>;
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
