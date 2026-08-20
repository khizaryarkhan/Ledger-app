"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { Hash, Check, Loader } from "lucide-react";

// Per-type transaction numbering (QBO model). Each type has its own series:
// a prefix, a next number, and zero-padding. Numbers are auto-assigned on the
// form but editable there; here you set the prefix, the next value, and width.
type Row = { type: string; label: string; prefix: string; nextNo: number; padding: number; preview: string };

function preview(prefix: string, nextNo: number, padding: number) {
  const digits = String(Math.max(0, Math.trunc(nextNo)));
  return `${prefix}${padding > 0 ? digits.padStart(padding, "0") : digits}`;
}

export function NumberingSettings() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [savingType, setSavingType] = useState<string | null>(null);
  const [savedType, setSavedType] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/numbering").then(r => r.json()).then(d => setRows(Array.isArray(d) ? d : [])).catch(() => setRows([]));
  }, []);

  function patch(type: string, p: Partial<Row>) {
    setRows(rs => rs!.map(r => r.type === type ? { ...r, ...p } : r));
  }

  async function save(row: Row) {
    setSavingType(row.type); setSavedType(null);
    try {
      const res = await fetch("/api/numbering", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: row.type, prefix: row.prefix, nextNo: Number(row.nextNo) || 1, padding: Number(row.padding) || 0 }),
      });
      if (res.ok) { setSavedType(row.type); setTimeout(() => setSavedType(null), 1800); }
    } finally { setSavingType(null); }
  }

  const inputCls = "bg-stone-950 border border-stone-700 rounded-lg px-2.5 py-1.5 text-sm text-stone-100";

  return (
    <Card className="mb-6 p-5">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-indigo-500/15 flex items-center justify-center"><Hash size={17} className="text-indigo-400" /></div>
        <div>
          <h2 className="text-base font-semibold text-white">Transaction numbers</h2>
          <p className="text-[12px] text-stone-400">Your own document number series — one per transaction type. Auto-assigned on each form and editable there.</p>
        </div>
      </div>

      {rows === null ? (
        <div className="py-6 text-center text-stone-500 text-sm">Loading…</div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[13px] min-w-[560px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                <th className="text-left py-2 pr-3">Type</th>
                <th className="text-left py-2 px-2">Prefix</th>
                <th className="text-left py-2 px-2">Next no.</th>
                <th className="text-left py-2 px-2">Digits</th>
                <th className="text-left py-2 px-2">Next looks like</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.type} className="border-b border-stone-800/60">
                  <td className="py-2 pr-3 text-stone-200 font-medium whitespace-nowrap">{r.label}</td>
                  <td className="py-2 px-2"><input value={r.prefix} onChange={e => patch(r.type, { prefix: e.target.value })} className={`${inputCls} w-24 font-mono`} /></td>
                  <td className="py-2 px-2"><input type="number" min={1} value={r.nextNo} onChange={e => patch(r.type, { nextNo: Number(e.target.value) })} className={`${inputCls} w-24`} /></td>
                  <td className="py-2 px-2"><input type="number" min={0} max={12} value={r.padding} onChange={e => patch(r.type, { padding: Number(e.target.value) })} className={`${inputCls} w-16`} /></td>
                  <td className="py-2 px-2 font-mono text-stone-300">{preview(r.prefix, r.nextNo, r.padding)}</td>
                  <td className="py-2 text-right">
                    <button onClick={() => save(r)} disabled={savingType === r.type}
                      className="inline-flex items-center gap-1.5 text-[12px] font-medium bg-stone-800 hover:bg-stone-700 text-stone-200 rounded-lg px-3 py-1.5 disabled:opacity-50">
                      {savingType === r.type ? <Loader size={13} className="animate-spin" /> : savedType === r.type ? <Check size={13} className="text-emerald-400" /> : null}
                      {savedType === r.type ? "Saved" : "Save"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-stone-500 mt-3">If someone types a higher number on a form, the series automatically continues from there — just like QuickBooks.</p>
        </div>
      )}
    </Card>
  );
}
