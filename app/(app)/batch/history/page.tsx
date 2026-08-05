"use client";

import { useEffect, useState, useCallback } from "react";
import { History, UploadCloud, DownloadCloud, Trash2, PencilRuler, FileInput, Undo2, Loader2 } from "lucide-react";

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

  const load = useCallback(() => {
    fetch("/api/batch/jobs")
      .then((r) => (r.ok ? r.json() : { jobs: [] }))
      .then((d) => setJobs(d.jobs || []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

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
      <p className="text-sm text-stone-400 mb-6 ml-12">Every run against your QuickBooks company. Imports can be reversed.</p>

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
              return (
                <tr key={j.id} className="border-b border-stone-800/60">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2 text-stone-200">{OP_ICON[j.operation]} {OP_LABEL[j.operation] || j.operation}</div>
                  </td>
                  <td className="px-4 py-2 text-stone-300">{j.entityLabel}</td>
                  <td className="px-4 py-2 text-right text-stone-400 tabular-nums">{j.totalRows}</td>
                  <td className="px-4 py-2 text-right text-emerald-400 tabular-nums">{j.successCount}</td>
                  <td className="px-4 py-2 text-right tabular-nums"><span className={j.errorCount > 0 ? "text-rose-400" : "text-stone-600"}>{j.errorCount}</span></td>
                  <td className="px-4 py-2 text-stone-500">
                    {running ? <span className="inline-flex items-center gap-1 text-amber-400"><Loader2 size={12} className="animate-spin" /> {j.status}</span>
                      : new Date(j.createdAt).toLocaleString("en-IE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-4 py-2 text-right">
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
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
