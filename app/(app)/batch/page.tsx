"use client";

import Link from "next/link";
import { UploadCloud, DownloadCloud, Trash2, PencilRuler, ArrowRight, FileInput } from "lucide-react";

const CARDS = [
  {
    href: "/batch/upload",
    icon: UploadCloud,
    title: "Bulk Upload",
    body: "Import transactions and lists from Excel or CSV straight into QuickBooks. Smart column mapping, a full preview, and per-row results.",
    cta: "Start an import",
  },
  {
    href: "/batch/download",
    icon: DownloadCloud,
    title: "Download",
    body: "Export the QuickBooks data you need for reporting or editing. Filter by entity, date type, and range — delivered as a spreadsheet.",
    cta: "Export data",
  },
  {
    href: "/batch/modify",
    icon: PencilRuler,
    title: "Modify",
    body: "Update many QuickBooks records at once. Download the entity, edit the file offline, then re-import — changes apply across every row.",
    cta: "Modify records",
  },
  {
    href: "/batch/convert",
    icon: FileInput,
    title: "Estimate → Invoice",
    body: "Turn accepted estimates into invoices in bulk. Each new invoice is linked to its estimate in QuickBooks — something most import tools can't do.",
    cta: "Convert estimates",
  },
  {
    href: "/batch/delete",
    icon: Trash2,
    title: "Delete",
    body: "Clean up duplicates and errors. Search by entity and date, preview exactly what matches, then remove in bulk.",
    cta: "Clean up data",
    danger: true,
  },
];

export default function BatchOverview() {
  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-stone-100">Batch Functions</h1>
        <p className="text-sm text-stone-400 mt-1">
          Bulk create, export, update, and delete QuickBooks data — across every transaction type and list.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {CARDS.map((c) => {
          const Icon = c.icon;
          return (
            <Link
              key={c.href}
              href={c.href}
              className="group bg-stone-900 border border-stone-800 rounded-xl p-5 hover:border-amber-500/40 transition-colors flex flex-col"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${c.danger ? "bg-rose-500/15" : "bg-amber-500/15"}`}>
                  <Icon size={20} className={c.danger ? "text-rose-400" : "text-amber-400"} strokeWidth={1.9} />
                </div>
                <h2 className="text-base font-semibold text-stone-100">{c.title}</h2>
              </div>
              <p className="text-[13px] text-stone-400 leading-relaxed flex-1">{c.body}</p>
              <div className={`mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium ${c.danger ? "text-rose-400" : "text-amber-400"}`}>
                {c.cta}
                <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
              </div>
            </Link>
          );
        })}
      </div>

      <p className="mt-6 text-[12px] text-stone-500">
        Batch Functions work directly with your connected QuickBooks company. Changes are written to QuickBooks and
        reflected in Prime Accountax on the next sync.
      </p>
    </div>
  );
}
