"use client";

import { useEffect, useState } from "react";

export interface BatchEntityMeta {
  id: string;
  label: string;
  group: string;
  supports: { upload: boolean; download: boolean; delete: boolean; modify: boolean };
  note: string | null;
  columns: string[];
  hasDateFilter: boolean;
  hasRefNumberFilter: boolean;
}

interface GroupMeta { key: string; label: string; }

export function useBatchEntities() {
  const [entities, setEntities] = useState<BatchEntityMeta[]>([]);
  const [groups, setGroups] = useState<GroupMeta[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/api/batch/entities")
      .then((r) => (r.ok ? r.json() : { entities: [], groups: [] }))
      .then((d) => { setEntities(d.entities || []); setGroups(d.groups || []); })
      .finally(() => setLoading(false));
  }, []);
  return { entities, groups, loading };
}

/**
 * Grid of entity cards grouped by section, filtered by which operation they support.
 */
export function EntityPicker({
  capability,
  selected,
  onSelect,
}: {
  capability: "upload" | "download" | "delete" | "modify";
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const { entities, groups, loading } = useBatchEntities();

  if (loading) return <div className="text-sm text-stone-500 py-8">Loading entities…</div>;

  return (
    <div className="space-y-6">
      {groups.map((g) => {
        const items = entities.filter((e) => e.group === g.key);
        if (items.length === 0) return null;
        return (
          <div key={g.key}>
            <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-2">{g.label}</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {items.map((e) => {
                const enabled = e.supports[capability];
                const isSel = selected === e.id;
                return (
                  <button
                    key={e.id}
                    disabled={!enabled}
                    onClick={() => enabled && onSelect(e.id)}
                    title={!enabled ? e.note || "Not available for this action" : e.label}
                    className={`text-left px-3 py-2.5 rounded-lg border text-[13px] font-medium transition-colors ${
                      isSel
                        ? "border-amber-500 bg-amber-500/10 text-amber-300"
                        : enabled
                        ? "border-stone-800 bg-stone-900 text-stone-200 hover:border-stone-600"
                        : "border-stone-800/60 bg-stone-900/40 text-stone-600 cursor-not-allowed"
                    }`}
                  >
                    {e.label}
                    {!enabled && <span className="block text-[10px] text-stone-600 mt-0.5">Not available</span>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
