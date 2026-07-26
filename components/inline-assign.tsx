"use client";

/**
 * InlineAssign — a compact, save-on-change dropdown for editing a single
 * field (Rep / Region) directly in a table row, without opening the bulk
 * Reclassify modal. Reads as a badge when set, a faint "—" when empty.
 */
export type AssignGroup = { label: string; items: { id: string; name: string }[] };

export function InlineAssign({
  value, onChange, groups, empty = "—", tone = "blue", title, busy = false,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  groups: AssignGroup[];
  empty?: string;
  tone?: "blue" | "stone";
  title?: string;
  busy?: boolean;
}) {
  const has = !!value;
  const set = tone === "blue"
    ? "bg-blue-500/15 text-blue-400 hover:border-blue-500/40"
    : "bg-stone-800 text-stone-300 hover:border-stone-500";
  return (
    <select
      title={title}
      value={value ?? ""}
      disabled={busy}
      onClick={e => e.stopPropagation()}
      onChange={e => onChange(e.target.value || null)}
      className={`text-[11px] font-medium rounded px-1.5 py-0.5 max-w-[150px] cursor-pointer border border-transparent transition-colors focus:outline-none focus:border-emerald-500 disabled:opacity-50 ${has ? set : "bg-transparent text-stone-500 hover:border-stone-600"}`}
    >
      <option value="">{empty}</option>
      {groups.map(g => g.items.length > 0 && (
        g.label
          ? <optgroup key={g.label} label={g.label}>{g.items.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}</optgroup>
          : g.items.map(it => <option key={it.id} value={it.id}>{it.name}</option>)
      ))}
    </select>
  );
}
