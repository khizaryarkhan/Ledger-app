"use client";

/**
 * Approvals inbox — maker-checker for gated inventory postings (Job Work
 * dispatch, Production, Goods Receipt, Shipment). A request here has NOT
 * touched inventory or the GL yet — approving re-runs the original posting;
 * rejecting discards it. The requester can't approve their own request.
 */

import { useEffect, useState } from "react";
import { ShieldCheck, Check, X, RefreshCw, Sliders } from "lucide-react";
import { fmt } from "@/lib/format";

const money = fmt.num2;

const LABELS: Record<string, string> = {
  jobwork_dispatch: "Job Work dispatch",
  production_build: "Production build",
  goods_receipt: "Goods Receipt",
  shipment: "Shipment",
};

type ThresholdRow = { entityType: string; thresholdAmount: number | null; alwaysRequire: boolean };

function ThresholdSettings() {
  const [rows, setRows] = useState<ThresholdRow[] | null>(null);
  const [savingType, setSavingType] = useState<string | null>(null);

  async function load() {
    const r = await fetch(`/api/settings/approval-thresholds`).then(x => x.json()).catch(() => []);
    setRows(Array.isArray(r) ? r : []);
  }
  useEffect(() => { load(); }, []);

  function patch(entityType: string, p: Partial<ThresholdRow>) {
    setRows(rs => rs!.map(r => r.entityType === entityType ? { ...r, ...p } : r));
  }

  async function save(row: ThresholdRow) {
    setSavingType(row.entityType);
    const r = await fetch(`/api/settings/approval-thresholds`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityType: row.entityType, thresholdAmount: row.thresholdAmount, alwaysRequire: row.alwaysRequire }),
    });
    const d = await r.json().catch(() => ({}));
    setSavingType(null);
    if (!r.ok) alert(d.error || "Could not save.");
  }

  return (
    <div className="mt-8">
      <div className="flex items-center gap-2 mb-1">
        <Sliders size={15} className="text-stone-500" />
        <h2 className="text-sm font-semibold text-stone-200">Approval thresholds</h2>
      </div>
      <p className="text-[12.5px] text-stone-500 mb-3">
        "Always require" gates every transaction of that type regardless of value — the recommended setting for Job Work dispatch,
        since material leaves custody with no offsetting document. For the others, only postings above the amount are gated.
        Admin only.
      </p>
      <div className="rounded-xl bg-stone-900 border border-stone-800 divide-y divide-stone-800">
        {rows === null && <div className="px-4 py-6 text-center text-stone-500 text-sm">Loading…</div>}
        {(rows ?? []).map(row => (
          <div key={row.entityType} className="px-4 py-3 flex items-center gap-4">
            <div className="w-40 shrink-0 text-[13px] text-stone-200">{LABELS[row.entityType] ?? row.entityType}</div>
            <label className="flex items-center gap-1.5 text-[12.5px] text-stone-400 shrink-0">
              <input type="checkbox" checked={row.alwaysRequire} onChange={e => patch(row.entityType, { alwaysRequire: e.target.checked })} />
              Always require
            </label>
            <div className="flex items-center gap-1.5 text-[12.5px] text-stone-500">
              <span>or above</span>
              <input
                type="number" step="0.01" placeholder="no threshold"
                value={row.thresholdAmount ?? ""}
                disabled={row.alwaysRequire}
                onChange={e => patch(row.entityType, { thresholdAmount: e.target.value === "" ? null : Number(e.target.value) })}
                className="w-32 bg-stone-950 border border-stone-700 rounded-lg px-2.5 py-1 text-[12.5px] text-stone-100 disabled:opacity-40"
              />
            </div>
            <button onClick={() => save(row)} disabled={savingType === row.entityType} className="ml-auto text-[12px] font-medium bg-stone-800 hover:bg-stone-700 text-stone-200 rounded-lg px-3 py-1.5 disabled:opacity-50">
              {savingType === row.entityType ? "Saving…" : "Save"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ApprovalsConsole() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  async function load() {
    const r = await fetch(`/api/approvals`).then(x => x.json()).catch(() => []);
    setRows(Array.isArray(r) ? r : []);
  }
  useEffect(() => { load(); }, []);

  async function approve(id: string) {
    setBusyId(id);
    const r = await fetch(`/api/approvals/${id}/approve`, { method: "POST" });
    const d = await r.json().catch(() => ({}));
    setBusyId(null);
    if (!r.ok) { alert(d.error || "Could not approve."); return; }
    load();
  }
  async function reject(id: string) {
    if (!reason.trim()) return;
    setBusyId(id);
    const r = await fetch(`/api/approvals/${id}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
    const d = await r.json().catch(() => ({}));
    setBusyId(null); setRejecting(null); setReason("");
    if (!r.ok) { alert(d.error || "Could not reject."); return; }
    load();
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center"><ShieldCheck size={18} className="text-amber-400" /></div>
          <h1 className="text-xl font-semibold text-stone-100">Approvals</h1>
        </div>
        <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={rows === null ? "animate-spin" : ""} /></button>
      </div>
      <p className="text-sm text-stone-400 mb-5 ml-12">Nothing here has posted yet — approving runs it for real; rejecting discards it. You can't approve your own request.</p>

      <div className="rounded-xl bg-stone-900 border border-stone-800 divide-y divide-stone-800">
        {rows === null && <div className="px-4 py-8 text-center text-stone-500 text-sm">Loading…</div>}
        {rows && rows.length === 0 && <div className="px-4 py-8 text-center text-stone-500 text-sm">No pending approvals.</div>}
        {(rows ?? []).map(r => (
          <div key={r.id} className="px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px] font-medium text-stone-200">{LABELS[r.entityType] ?? r.entityType}</div>
                <div className="text-[12px] text-stone-500">Requested by {r.requestedByName ?? "—"} · {new Date(r.createdAt).toLocaleString()}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="tabular-nums text-stone-200 font-medium">{money(Number(r.amount))}</span>
                <button onClick={() => approve(r.id)} disabled={busyId === r.id} className="inline-flex items-center gap-1 text-[12.5px] font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-3 py-1.5 disabled:opacity-50"><Check size={13} /> Approve</button>
                <button onClick={() => setRejecting(rejecting === r.id ? null : r.id)} disabled={busyId === r.id} className="inline-flex items-center gap-1 text-[12.5px] font-medium bg-stone-800 hover:bg-stone-700 text-rose-400 rounded-lg px-3 py-1.5 disabled:opacity-50"><X size={13} /> Reject</button>
              </div>
            </div>
            {rejecting === r.id && (
              <div className="mt-2 flex items-center gap-2">
                <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason for rejecting…" className="flex-1 bg-stone-950 border border-stone-700 rounded-lg px-3 py-1.5 text-[12.5px] text-stone-100 focus:outline-none focus:border-rose-600" />
                <button onClick={() => reject(r.id)} disabled={!reason.trim() || busyId === r.id} className="text-[12.5px] font-medium bg-rose-600 hover:bg-rose-700 text-white rounded-lg px-3 py-1.5 disabled:opacity-50">Confirm reject</button>
              </div>
            )}
          </div>
        ))}
      </div>

      <ThresholdSettings />
    </div>
  );
}
