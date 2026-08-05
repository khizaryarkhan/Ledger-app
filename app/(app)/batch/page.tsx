"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useBatchEntities } from "./_components/entity-picker";
import { Search, Database, ArrowRight, Receipt, Users, Package, BookOpen, Layers } from "lucide-react";

// A small, stable icon per entity group.
const GROUP_ICON: Record<string, any> = {
  customer: Receipt,
  vendor: Package,
  other: BookOpen,
  list: Users,
};

const CAP_LABEL: { key: "upload" | "download" | "delete" | "modify"; label: string }[] = [
  { key: "upload", label: "Import" },
  { key: "download", label: "Export" },
  { key: "modify", label: "Update" },
  { key: "delete", label: "Delete" },
];

export default function DataStudioHome() {
  const { entities, groups, provider, loading } = useBatchEntities();
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return entities;
    return entities.filter((e) => e.label.toLowerCase().includes(query));
  }, [entities, q]);

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center">
          <Database size={20} className="text-amber-400" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-stone-100">Data Studio</h1>
            {provider && (
              <span className="text-[11px] px-2 py-0.5 rounded-full border border-stone-700 text-stone-400">
                {provider === "xero" ? "Xero" : "QuickBooks"}
              </span>
            )}
          </div>
          <p className="text-sm text-stone-400">
            Work with your {provider === "xero" ? "Xero" : "QuickBooks"} data — pick something to
            {provider === "xero" ? " export" : " import, export, update, or clean up"}.
          </p>
        </div>
      </div>

      <div className="relative mt-5 mb-6 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search customers, invoices, bills…"
          className="h-10 w-full pl-9 pr-3 text-sm rounded-lg border border-stone-700 bg-stone-900 text-stone-200 focus:border-amber-500 focus:outline-none"
        />
      </div>

      {loading ? (
        <div className="text-sm text-stone-500 py-12">Loading…</div>
      ) : (
        <div className="space-y-8">
          {groups.map((g) => {
            const items = filtered.filter((e) => e.group === g.key);
            if (items.length === 0) return null;
            const Icon = GROUP_ICON[g.key] ?? Layers;
            return (
              <div key={g.key}>
                <div className="flex items-center gap-2 mb-3">
                  <Icon size={15} className="text-stone-500" />
                  <span className="text-[12px] font-semibold text-stone-400 uppercase tracking-wider">{g.label}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {items.map((e) => {
                    const caps = CAP_LABEL.filter((c) => e.supports[c.key]);
                    const usable = caps.length > 0;
                    return (
                      <Link
                        key={e.id}
                        href={usable ? `/batch/e/${e.id}` : "#"}
                        aria-disabled={!usable}
                        className={`group rounded-xl border p-4 transition-colors ${
                          usable
                            ? "border-stone-800 bg-stone-900 hover:border-amber-500/40"
                            : "border-stone-800/50 bg-stone-900/40 pointer-events-none opacity-50"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[15px] font-medium text-stone-100">{e.label}</span>
                          {usable && <ArrowRight size={15} className="text-stone-600 group-hover:text-amber-400 group-hover:translate-x-0.5 transition-all" />}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {usable ? caps.map((c) => (
                            <span key={c.key} className="text-[11px] px-1.5 py-0.5 rounded bg-stone-800 text-stone-400">{c.label}</span>
                          )) : (
                            <span className="text-[11px] text-stone-600">{e.note || "Not available via QuickBooks API"}</span>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-sm text-stone-500 py-12 text-center">No matches for “{q}”.</div>
          )}
        </div>
      )}
    </div>
  );
}
