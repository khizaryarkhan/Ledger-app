"use client";

import { useState, useMemo, useRef } from "react";
import { FileInput, Loader2, Search, CheckCircle2, XCircle, DownloadCloud, FileSpreadsheet } from "lucide-react";

interface Est {
  id: string; docNumber: string; customer: string; date: string;
  total: number | null; status: string; invoiced: boolean;
}

const selCls = "h-9 px-2 w-full text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-200 focus:border-amber-500 focus:outline-none";

export default function BatchConvertPage() {
  const [mode, setMode] = useState<"byline" | "whole">("byline");
  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center">
          <FileInput size={18} className="text-amber-400" />
        </div>
        <h1 className="text-xl font-semibold text-stone-100">Estimate → Invoice</h1>
      </div>
      <p className="text-sm text-stone-400 mb-5 ml-12">Create invoices from estimates. Each invoice is linked to its estimate in QuickBooks.</p>

      <div className="inline-flex rounded-lg border border-stone-700 overflow-hidden mb-6">
        <button onClick={() => setMode("byline")} className={`px-4 py-2 text-[13px] font-medium ${mode === "byline" ? "bg-amber-500/15 text-amber-300" : "text-stone-400 hover:bg-stone-800"}`}>
          By line (progress billing)
        </button>
        <div className="w-px bg-stone-700" />
        <button onClick={() => setMode("whole")} className={`px-4 py-2 text-[13px] font-medium ${mode === "whole" ? "bg-amber-500/15 text-amber-300" : "text-stone-400 hover:bg-stone-800"}`}>
          Whole estimate
        </button>
      </div>

      {mode === "byline" ? <ByLine /> : <WholeEstimate />}
    </div>
  );
}

// ── Mode A: progress billing by line (export → fill → import) ─────────────────

function ByLine() {
  const [status, setStatus] = useState("Accepted");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function download() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/batch/convert/estimates/export", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, from: from || undefined, to: to || undefined }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Export failed"); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "estimates-to-invoice.xlsx"; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function upload(file: File) {
    setBusy(true); setError(null); setResult(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/batch/convert/estimates/invoice", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setResult(data);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      {error && <div className="px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error}</div>}

      <div>
        <div className="text-sm font-medium text-stone-300 mb-2">1. Download estimates to invoice</div>
        <div className="grid grid-cols-3 gap-3 max-w-lg mb-3">
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={selCls}>
              <option value="Accepted">Accepted</option>
              <option value="Pending">Pending</option>
              <option value="Any">Any</option>
            </select>
          </Field>
          <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={selCls} /></Field>
          <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={selCls} /></Field>
        </div>
        <button onClick={download} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-100 text-sm font-medium disabled:opacity-50">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <DownloadCloud size={15} />} Download estimate lines
        </button>
        <p className="text-[12px] text-stone-500 mt-1.5">One row per estimate line. Fill the amber <span className="text-amber-400">Qty to Invoice</span> / <span className="text-amber-400">Amount to Invoice</span> columns — leave a line blank to skip it. The blue <span className="text-sky-400">Remaining</span> column shows how much of each line is still to bill (guards against double-billing across rounds).</p>
      </div>

      <div>
        <div className="text-sm font-medium text-stone-300 mb-2">2. Upload the filled file</div>
        <button onClick={() => fileRef.current?.click()} disabled={busy} className="w-full border-2 border-dashed border-stone-700 hover:border-amber-500/50 rounded-xl py-10 flex flex-col items-center justify-center gap-2 transition-colors disabled:opacity-50">
          {busy ? <Loader2 size={26} className="text-amber-400 animate-spin" /> : <FileSpreadsheet size={26} className="text-stone-500" />}
          <span className="text-sm text-stone-300 font-medium">Click to upload your filled file</span>
          <span className="text-[12px] text-stone-500">Only lines with a quantity/amount are invoiced.</span>
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
      </div>

      {result && (
        <div className="flex gap-4">
          <Tile icon={<CheckCircle2 size={18} className="text-emerald-400" />} value={result.successCount} label="Invoices created" />
          <Tile icon={<XCircle size={18} className="text-rose-400" />} value={result.errorCount} label="Skipped / failed" />
          {result.errorCount > 0 && (
            <div className="flex-1 border border-stone-800 rounded-lg overflow-hidden max-h-[220px] overflow-y-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-stone-900"><tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800"><th className="text-left px-4 py-2">Estimate</th><th className="text-left px-4 py-2">Reason</th></tr></thead>
                <tbody>{result.results.filter((r: any) => !r.ok).map((r: any, i: number) => <tr key={i} className="border-b border-stone-800/60"><td className="px-4 py-1.5 text-stone-300">{r.estimate}</td><td className="px-4 py-1.5 text-rose-300">{r.error}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Mode B: whole-estimate one-click convert ──────────────────────────────────

function WholeEstimate() {
  const [dateType, setDateType] = useState("transaction");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [rows, setRows] = useState<Est[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  async function search() {
    setBusy(true); setError(null); setResult(null); setRows(null); setSelected(new Set());
    try {
      const res = await fetch("/api/batch/convert/estimates/search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateType, from: from || undefined, to: to || undefined, status: status || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      setRows(data.rows);
      setSelected(new Set(data.rows.filter((r: Est) => !r.invoiced).map((r: Est) => r.id)));
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function convert() {
    if (!rows) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/batch/convert/estimates/commit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], invoiceDate: invoiceDate || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Conversion failed");
      setResult(data); setRows(null);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  function toggle(id: string) { setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }

  const visible = useMemo(() => {
    if (!rows) return [];
    const q = filter.toLowerCase();
    return q ? rows.filter((r) => `${r.docNumber} ${r.customer}`.toLowerCase().includes(q)) : rows;
  }, [rows, filter]);

  return (
    <div className="space-y-4">
      {error && <div className="px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error}</div>}
      {result && (
        <div className="flex gap-4">
          <Tile icon={<CheckCircle2 size={18} className="text-emerald-400" />} value={result.successCount} label="Invoices created" />
          <Tile icon={<XCircle size={18} className="text-rose-400" />} value={result.errorCount} label="Failed" />
        </div>
      )}

      <div className="text-sm font-medium text-stone-300">Find estimates</div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 max-w-3xl">
        <Field label="Date type">
          <select value={dateType} onChange={(e) => setDateType(e.target.value)} className={selCls}>
            <option value="transaction">Transaction date</option>
            <option value="created">Created date</option>
            <option value="updated">Last updated</option>
          </select>
        </Field>
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={selCls} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={selCls} /></Field>
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={selCls}>
            <option value="">Any</option>
            <option value="Pending">Pending</option>
            <option value="Accepted">Accepted</option>
            <option value="Closed">Closed</option>
            <option value="Rejected">Rejected</option>
          </select>
        </Field>
        <Field label="Invoice date"><input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className={selCls} /></Field>
      </div>
      <button onClick={search} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-100 text-sm font-medium disabled:opacity-50">
        {busy && !rows ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Search estimates
      </button>

      {rows && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by number or customer…" className={`${selCls} max-w-xs`} />
            <div className="flex items-center gap-3">
              <span className="text-sm text-stone-400">{selected.size} selected</span>
              <button disabled={selected.size === 0 || busy} onClick={convert} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium disabled:opacity-40">
                {busy ? <Loader2 size={15} className="animate-spin" /> : <FileInput size={15} />} Create {selected.size} invoice{selected.size === 1 ? "" : "s"}
              </button>
            </div>
          </div>
          <div className="border border-stone-800 rounded-lg overflow-hidden max-h-[420px] overflow-y-auto">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-stone-900">
                <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                  <th className="px-3 py-2 w-8"></th>
                  <th className="text-left px-4 py-2 font-semibold">Estimate</th>
                  <th className="text-left px-4 py-2 font-semibold">Customer</th>
                  <th className="text-left px-4 py-2 font-semibold">Date</th>
                  <th className="text-left px-4 py-2 font-semibold">Status</th>
                  <th className="text-right px-4 py-2 font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} className="border-b border-stone-800/60 hover:bg-stone-800/30 cursor-pointer" onClick={() => toggle(r.id)}>
                    <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="rounded border-stone-600 bg-stone-800 text-amber-500 focus:ring-0" />
                    </td>
                    <td className="px-4 py-1.5 text-stone-200">
                      {r.docNumber}
                      {r.invoiced && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-stone-800 text-stone-400">already invoiced</span>}
                    </td>
                    <td className="px-4 py-1.5 text-stone-400">{r.customer}</td>
                    <td className="px-4 py-1.5 text-stone-400 tabular-nums">{r.date}</td>
                    <td className="px-4 py-1.5 text-stone-400">{r.status}</td>
                    <td className="px-4 py-1.5 text-right text-stone-300 tabular-nums">{r.total != null ? r.total.toLocaleString() : "—"}</td>
                  </tr>
                ))}
                {visible.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-500">No estimates matched.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-[12px] text-stone-500">Creates one invoice for the full estimate. For partial billing, use “By line”.</p>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-stone-500 block mb-1">{label}</span>
      {children}
    </label>
  );
}

function Tile({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="flex items-center gap-3 px-5 py-3 rounded-lg bg-stone-900 border border-stone-800">
      {icon}
      <div><div className="text-2xl font-semibold text-stone-100 tabular-nums">{value}</div><div className="text-[12px] text-stone-500">{label}</div></div>
    </div>
  );
}
