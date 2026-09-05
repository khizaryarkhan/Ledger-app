"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useBatchEntities } from "../../_components/entity-picker";
import {
  ArrowLeft, UploadCloud, DownloadCloud, PencilRuler, Trash2, ArrowRight, Tags,
} from "lucide-react";

interface Action {
  cap: "upload" | "download" | "delete" | "modify";
  href: string;
  icon: any;
  title: string;
  body: string;
  danger?: boolean;
}

export default function EntityWorkspace() {
  const entityId = useParams().entityId as string;
  const { entities, loading } = useBatchEntities();
  const entity = entities.find((e) => e.id === entityId);

  if (loading) return <div className="p-6 text-sm text-stone-500">Loading…</div>;
  if (!entity) return (
    <div className="p-6">
      <Link href="/batch" className="inline-flex items-center gap-1.5 text-[13px] text-stone-400 hover:text-stone-200 mb-4"><ArrowLeft size={14} /> Data Studio</Link>
      <p className="text-sm text-stone-400">Unknown entity.</p>
    </div>
  );

  const actions: Action[] = [];
  if (entity.supports.upload) actions.push({
    cap: "upload", href: `/batch/upload?entity=${entity.id}`,
    icon: UploadCloud,
    title: "Import",
    body: `Bring ${entity.label.toLowerCase()} into QuickBooks from a spreadsheet.`,
  });
  if (entity.supports.download) actions.push({
    cap: "download", href: `/batch/download?entity=${entity.id}`, icon: DownloadCloud,
    title: "Export", body: `Download your ${entity.label.toLowerCase()} to a spreadsheet.`,
  });
  if (entity.supports.modify) actions.push({
    cap: "modify", href: `/batch/modify?entity=${entity.id}`, icon: PencilRuler,
    title: "Update", body: `Edit existing ${entity.label.toLowerCase()} in bulk — download, change, re-upload.`,
  });
  if (entity.supports.modify && entity.group === "customer") actions.push({
    cap: "modify", href: `/batch/bulk-edit?entity=${entity.id}`, icon: Tags,
    title: "Bulk edit fields", body: `Set Class, Location, Email or custom fields on many ${entity.label.toLowerCase()} at once — safely, without rebuilding lines or breaking links.`,
  });
  if (entity.supports.delete) actions.push({
    cap: "delete", href: `/batch/delete?entity=${entity.id}`, icon: Trash2,
    title: "Delete", body: `Find and remove ${entity.label.toLowerCase()} in bulk.`, danger: true,
  });

  return (
    <div className="p-6 max-w-4xl">
      <Link href="/batch" className="inline-flex items-center gap-1.5 text-[13px] text-stone-400 hover:text-stone-200 mb-4">
        <ArrowLeft size={14} /> Data Studio
      </Link>

      <h1 className="text-2xl font-semibold text-stone-100">{entity.label}</h1>
      <p className="text-sm text-stone-400 mt-1 mb-6">Choose what you'd like to do.</p>

      {actions.length === 0 ? (
        <div className="px-4 py-3 rounded-lg bg-stone-900 border border-stone-800 text-sm text-stone-400">
          {entity.note || "This isn't available through the QuickBooks API."}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {actions.map((a) => {
            const Icon = a.icon;
            return (
              <Link
                key={a.href}
                href={a.href}
                className="group rounded-xl border border-stone-800 bg-stone-900 p-4 hover:border-amber-500/40 transition-colors"
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${a.danger ? "bg-rose-500/15" : "bg-amber-500/15"}`}>
                    <Icon size={18} className={a.danger ? "text-rose-400" : "text-amber-400"} />
                  </div>
                  <span className="text-[15px] font-medium text-stone-100">{a.title}</span>
                  <ArrowRight size={15} className="ml-auto text-stone-600 group-hover:text-amber-400 group-hover:translate-x-0.5 transition-all" />
                </div>
                <p className="text-[13px] text-stone-400 leading-relaxed">{a.body}</p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
