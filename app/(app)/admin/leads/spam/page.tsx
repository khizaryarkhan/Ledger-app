"use client";

import { useEffect, useState, useCallback } from "react";
import { ShieldAlert, Loader2, CheckCircle2 } from "lucide-react";

interface Lead { id: string; fullName: string; email: string; phone: string | null; companyName: string | null; message: string | null; country: string | null; score: number; createdAt: string; }

export default function SpamCleanupPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [scanned, setScanned] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    setLoading(true); setMsg(null);
    fetch("/api/admin/leads/spam").then((r) => r.json())
      .then((d) => { setLeads(d.leads || []); setScanned(d.scanned || 0); setSel(new Set((d.leads || []).map((l: Lead) => l.id))); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const ids = [...sel];

  async function act(action: "reject" | "delete") {
    if (ids.length === 0) return;
    if (action === "delete" && !confirm(`Permanently delete ${ids.length} spam lead(s) and purge their empty accounts? This can't be undone.`)) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/leads/spam", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, action }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setMsg(action === "delete" ? `Deleted ${d.deleted} lead(s), purged ${d.accountsPurged} empty account(s).` : `Rejected ${d.rejected} lead(s).`);
      load();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center"><ShieldAlert size={18} className="text-amber-400" /></div>
        <h1 className="text-xl font-semibold text-stone-100">Spam cleanup</h1>
      </div>
      <p className="text-sm text-stone-400 mb-4 ml-12">Landing-page leads flagged as likely bot spam (gibberish names, letters-in-phone, gmail dot-trick emails). Review, then reject (safe) or delete. New spam is already blocked at the form.</p>

      {msg && <div className="mb-4 px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm inline-flex items-center gap-2"><CheckCircle2 size={15} /> {msg}</div>}

      {loading ? (
        <div className="text-sm text-stone-500 py-12">Scanning {scanned || ""} leads…</div>
      ) : leads.length === 0 ? (
        <div className="text-center py-12 text-stone-400">No spam-looking leads found. 🎉 <span className="text-stone-600">(scanned {scanned})</span></div>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-[13px] text-stone-400">{leads.length} flagged · {ids.length} selected</span>
            <div className="ml-auto flex gap-2">
              <button onClick={() => act("reject")} disabled={busy || ids.length === 0} className="px-3 py-1.5 rounded-lg text-sm bg-stone-700 hover:bg-stone-600 text-white disabled:opacity-40">{busy ? <Loader2 size={14} className="animate-spin" /> : "Reject selected"}</button>
              <button onClick={() => act("delete")} disabled={busy || ids.length === 0} className="px-3 py-1.5 rounded-lg text-sm bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-40">Delete selected</button>
            </div>
          </div>
          <div className="border border-stone-800 rounded-lg overflow-x-auto">
            <table className="w-full text-[13px] min-w-[800px]">
              <thead className="bg-stone-950 text-[11px] uppercase tracking-wider text-stone-500">
                <tr className="border-b border-stone-800">
                  <th className="px-3 py-2 w-8"><input type="checkbox" className="accent-blue-500" checked={leads.every((l) => sel.has(l.id))} onChange={(e) => setSel(e.target.checked ? new Set(leads.map((l) => l.id)) : new Set())} /></th>
                  <th className="text-left px-3 py-2 font-semibold">Name</th>
                  <th className="text-left px-3 py-2 font-semibold">Email</th>
                  <th className="text-left px-3 py-2 font-semibold">Phone</th>
                  <th className="text-left px-3 py-2 font-semibold">Message</th>
                  <th className="text-right px-3 py-2 font-semibold">Score</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id} className={`border-t border-stone-800/40 ${sel.has(l.id) ? "bg-amber-500/5" : ""}`}>
                    <td className="px-3 py-1.5"><input type="checkbox" className="accent-blue-500" checked={sel.has(l.id)} onChange={() => toggle(l.id)} /></td>
                    <td className="px-3 py-1.5 text-stone-300 truncate max-w-[160px]">{l.fullName}</td>
                    <td className="px-3 py-1.5 text-stone-400 truncate max-w-[200px]">{l.email}</td>
                    <td className="px-3 py-1.5 text-stone-500 truncate max-w-[140px]">{l.phone}</td>
                    <td className="px-3 py-1.5 text-stone-500 truncate max-w-[180px]">{l.message}</td>
                    <td className="px-3 py-1.5 text-right"><span className={`text-[11px] px-1.5 py-0.5 rounded ${l.score >= 4 ? "bg-rose-500/15 text-rose-300" : "bg-amber-500/15 text-amber-300"}`}>{l.score}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-stone-600 mt-2">Score ≥ 4 = high confidence (auto-blocked at the form now). Score 3 = borderline — review before deleting.</p>
        </>
      )}
    </div>
  );
}
