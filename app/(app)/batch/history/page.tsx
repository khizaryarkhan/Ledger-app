"use client";

import { useEffect, useState, useCallback, Fragment } from "react";
import { History, UploadCloud, DownloadCloud, Trash2, PencilRuler, FileInput, Undo2, Loader2, ChevronRight, AlertTriangle, CheckCircle2, FileDown } from "lucide-react";

interface Job {
  id: string;
  operation: string;
  entityLabel: string;
  fileName: string | null;
  status: string;
  totalRows: number;
  successCount: number;
  errorCount: number;
  undoneAt: string | null;
  createdAt: string;
}

interface ResultRow { row: number; ok: boolean; qboId?: string; docNumber?: string; key?: string | null; error?: string; data?: any[]; }

interface Detail { loading: boolean; failed: ResultRow[]; hasFailedData: boolean; error?: string; }

const OP_ICON: Record<string, React.ReactNode> = {
  upload: <UploadCloud size={14} className="text-amber-400" />,
  download: <DownloadCloud size={14} className="text-amber-400" />,
  delete: <Trash2 size={14} className="text-rose-400" />,
  modify: <PencilRuler size={14} className="text-amber-400" />,
  convert: <FileInput size={14} className="text-amber-400" />,
  undo: <Undo2 size={14} className="text-stone-400" />,
};

const OP_LABEL: Record<string, string> = {
  upload: "Import", download: "Export", modify: "Update", delete: "Delete", undo: "Undo",
};

export default function BatchHistoryPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, Detail>>({});

  const load = useCallback(() => {
    fetch("/api/batch/jobs")
      .then((r) => (r.ok ? r.json() : { jobs: [] }))
      .then((d) => setJobs(d.jobs || []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadDetail = useCallback((id: string) => {
    setDetails((p) => ({ ...p, [id]: { loading: true, failed: [], hasFailedData: false } }));
    fetch(`/api/batch/jobs/${id}`)
      .then((r) => r.json())
      .then((d) => {
        const results: ResultRow[] = Array.isArray(d?.results) ? d.results : [];
        const failed = results.filter((r) => r.ok === false);
        const hasFailedData = failed.some((r) => Array.isArray(r.data) && r.data.length > 0);
        setDetails((p) => ({ ...p, [id]: { loading: false, failed, hasFailedData } }));
      })
      .catch(() => setDetails((p) => ({ ...p, [id]: { loading: false, failed: [], hasFailedData: false, error: "Couldn't load details" } })));
  }, []);

  function toggle(id: string) {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!details[id]) loadDetail(id);
  }

  async function undo(id: string) {
    if (!confirm("Reverse this import? This deletes the records it created in QuickBooks.")) return;
    setUndoing(id);
    try {
      const r = await fetch(`/api/batch/jobs/${id}/undo`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Undo failed");
      setTimeout(load, 1500); // undo job appears; original flips to Undone when it finishes
    } catch (e: any) {
      alert(e.message);
    } finally {
      setUndoing(null);
    }
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center">
          <History size={18} className="text-amber-400" />
        </div>
        <h1 className="text-xl font-semibold text-stone-100">Job History</h1>
      </div>
      <p className="text-sm text-stone-400 mb-6 ml-12">Every run against your QuickBooks company. Click a run to see what failed; download just the failed rows to fix and re-import without duplicating the ones that worked. Imports can also be reversed.</p>

      <div className="border border-stone-800 rounded-lg overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
              <th className="text-left px-4 py-2.5 font-semibold">Action</th>
              <th className="text-left px-4 py-2.5 font-semibold">Entity</th>
              <th className="text-right px-4 py-2.5 font-semibold">Rows</th>
              <th className="text-right px-4 py-2.5 font-semibold">OK</th>
              <th className="text-right px-4 py-2.5 font-semibold">Failed</th>
              <th className="text-left px-4 py-2.5 font-semibold">When</th>
              <th className="text-right px-4 py-2.5 font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
            {!loading && jobs.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-stone-500">No runs yet.</td></tr>}
            {jobs.map((j) => {
              const canUndo = j.operation === "upload" && j.status === "done" && j.successCount > 0 && !j.undoneAt;
              const running = j.status === "queued" || j.status === "running";
              const isOpen = expanded === j.id;
              const detail = details[j.id];
              const inspectable = !running; // finished jobs have results to show
              return (
                <Fragment key={j.id}>
                  <tr
                    className={`border-b border-stone-800/60 ${inspectable ? "cursor-pointer hover:bg-stone-900/50" : ""} ${isOpen ? "bg-stone-900/50" : ""}`}
                    onClick={() => inspectable && toggle(j.id)}
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2 text-stone-200">
                        {inspectable && <ChevronRight size={13} className={`text-stone-600 transition-transform ${isOpen ? "rotate-90" : ""}`} />}
                        {OP_ICON[j.operation]} {OP_LABEL[j.operation] || j.operation}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-stone-300">{j.entityLabel}</td>
                    <td className="px-4 py-2 text-right text-stone-400 tabular-nums">{j.totalRows}</td>
                    <td className="px-4 py-2 text-right text-emerald-400 tabular-nums">{j.successCount}</td>
                    <td className="px-4 py-2 text-right tabular-nums"><span className={j.errorCount > 0 ? "text-rose-400" : "text-stone-600"}>{j.errorCount}</span></td>
                    <td className="px-4 py-2 text-stone-500">
                      {running ? <span className="inline-flex items-center gap-1 text-amber-400"><Loader2 size={12} className="animate-spin" /> {j.status}</span>
                        : new Date(j.createdAt).toLocaleString("en-IE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-4 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      {j.undoneAt ? (
                        <span className="text-[11px] px-2 py-0.5 rounded bg-stone-800 text-stone-400">Undone</span>
                      ) : canUndo ? (
                        <button
                          onClick={() => undo(j.id)}
                          disabled={undoing === j.id}
                          className="inline-flex items-center gap-1 text-[12px] text-stone-400 hover:text-rose-300 disabled:opacity-50"
                        >
                          {undoing === j.id ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />} Undo
                        </button>
                      ) : null}
                    </td>
                  </tr>

                  {isOpen && (
                    <tr className="border-b border-stone-800/60 bg-stone-950/40">
                      <td colSpan={7} className="px-4 py-3">
                        {!detail || detail.loading ? (
                          <div className="text-[12px] text-stone-500 inline-flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Loading details…</div>
                        ) : detail.error ? (
                          <div className="text-[12px] text-rose-400">{detail.error}</div>
                        ) : detail.failed.length === 0 ? (
                          <div className="text-[12px] text-emerald-400 inline-flex items-center gap-2"><CheckCircle2 size={13} /> All {j.successCount} rows imported successfully — nothing failed.</div>
                        ) : (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                              <div className="text-[12px] text-stone-300 inline-flex items-center gap-2">
                                <AlertTriangle size={13} className="text-rose-400" />
                                <span><span className="font-semibold text-rose-300">{detail.failed.length}</span> row{detail.failed.length !== 1 ? "s" : ""} failed and {j.operation === "upload" ? "were not created" : "were not changed"}.</span>
                              </div>
                              {detail.hasFailedData ? (
                                <a
                                  href={`/api/batch/jobs/${j.id}/failed-rows`}
                                  className="inline-flex items-center gap-1.5 text-[12px] font-medium text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/15 ring-1 ring-amber-500/30 rounded-md px-2.5 py-1.5 transition"
                                >
                                  <FileDown size={13} /> Download failed rows (.xlsx)
                                </a>
                              ) : (
                                <span className="text-[11px] text-stone-500">Re-download unavailable (job predates failed-row capture) — re-run the import to enable it.</span>
                              )}
                            </div>

                            <div className="rounded-lg border border-stone-800 overflow-hidden">
                              <div className="max-h-72 overflow-y-auto">
                                <table className="w-full text-[12px]">
                                  <thead className="sticky top-0 bg-stone-900">
                                    <tr className="text-[10px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                                      <th className="text-left px-3 py-2 font-semibold w-16">Row</th>
                                      <th className="text-left px-3 py-2 font-semibold w-48">Record</th>
                                      <th className="text-left px-3 py-2 font-semibold">Why it failed</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {detail.failed.map((f, i) => (
                                      <tr key={i} className="border-b border-stone-800/50 last:border-0">
                                        <td className="px-3 py-1.5 text-stone-500 tabular-nums">{f.row}</td>
                                        <td className="px-3 py-1.5 text-stone-300 truncate">{f.key || "—"}</td>
                                        <td className="px-3 py-1.5 text-rose-300">{f.error || "Failed"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>

                            <p className="text-[11px] text-stone-500">
                              Fix the errors in the downloaded file and re-import just that file — the rows that already succeeded won&apos;t be created again.
                              {canUndo && " Or use Undo above to reverse the whole import and start over."}
                            </p>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
