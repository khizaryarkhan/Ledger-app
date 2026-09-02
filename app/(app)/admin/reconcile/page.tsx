"use client";

/**
 * Ledger Health — runs the accounting-foundation reconciliation
 * (lib/accounting/reconcile.ts) against the live database and shows, per org,
 * whether the books actually hold together: entries balance, control accounts
 * agree with their subledgers, nothing is posted-but-invisible or
 * off-ledger, and the derived paid cache agrees with the settlement graph.
 */

import { useState, useEffect, useCallback } from "react";
import { Loader, ShieldCheck, RefreshCw, CheckCircle2, XCircle, MinusCircle, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui";

type Check = { key: string; label: string; status: "pass" | "fail" | "skipped"; detail: string };
type OrgResult = { orgId: string; orgName: string; usesNativeLedger: boolean; checks: Check[]; failures: number };

const ICON = {
  pass:    <CheckCircle2 size={14} className="text-emerald-400 shrink-0 mt-0.5" />,
  fail:    <XCircle size={14} className="text-rose-400 shrink-0 mt-0.5" />,
  skipped: <MinusCircle size={14} className="text-stone-600 shrink-0 mt-0.5" />,
};

export default function ReconcilePage() {
  const [orgs, setOrgs]       = useState<OrgResult[]>([]);
  const [totals, setTotals]   = useState<{ orgs: number; failing: number; failures: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const r = await fetch("/api/admin/reconcile");
      const d = await r.json();
      if (!r.ok) { setErr(d.error || `Failed (${r.status})`); return; }
      setOrgs(d.orgs ?? []);
      setTotals(d.totals ?? null);
    } catch (e: any) {
      setErr(e?.message || "Network error");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-base font-semibold text-white flex items-center gap-2">
            <ShieldCheck size={17} className="text-emerald-400" /> Ledger Health
          </h1>
          <p className="text-xs text-stone-500 mt-0.5 max-w-2xl">
            Does every org's ledger hold together? Entries must balance, the A/R and A/P control accounts
            must agree with their subledgers, no document may be posted-but-invisible or off-ledger, and
            the derived paid cache must agree with the settlement links graph.
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 h-8 px-3 text-xs font-medium rounded-lg border border-stone-700 bg-stone-800/50 text-stone-300 hover:bg-stone-700 hover:text-white disabled:opacity-40 transition-all shrink-0">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Re-run
        </button>
      </div>

      {err && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-sm text-rose-300">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {err}
        </div>
      )}

      {totals && (
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-xl border border-stone-800 bg-stone-900/50">
            <div className="text-[11px] text-stone-500">Organisations</div>
            <p className="text-xl font-semibold text-white">{totals.orgs}</p>
          </div>
          <div className={`p-3 rounded-xl border ${totals.failing > 0 ? "border-rose-500/30 bg-rose-500/5" : "border-stone-800 bg-stone-900/50"}`}>
            <div className="text-[11px] text-stone-500">With failures</div>
            <p className={`text-xl font-semibold ${totals.failing > 0 ? "text-rose-300" : "text-white"}`}>{totals.failing}</p>
          </div>
          <div className={`p-3 rounded-xl border ${totals.failures > 0 ? "border-rose-500/30 bg-rose-500/5" : "border-stone-800 bg-stone-900/50"}`}>
            <div className="text-[11px] text-stone-500">Total failures</div>
            <p className={`text-xl font-semibold ${totals.failures > 0 ? "text-rose-300" : "text-white"}`}>{totals.failures}</p>
          </div>
        </div>
      )}

      {loading && orgs.length === 0 ? (
        <div className="p-6"><Loader size={20} className="animate-spin text-stone-500" /></div>
      ) : (
        <div className="space-y-3">
          {orgs.map(o => (
            <Card key={o.orgId} padding="none">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-800">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[13px] font-semibold text-white truncate">{o.orgName}</span>
                  {!o.usesNativeLedger && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-stone-800 text-stone-500 shrink-0">no native ledger</span>
                  )}
                </div>
                <span className={`text-[11px] font-medium shrink-0 ${o.failures > 0 ? "text-rose-400" : "text-emerald-400"}`}>
                  {o.failures > 0 ? `${o.failures} failing` : "all clear"}
                </span>
              </div>
              <div className="divide-y divide-stone-800/50">
                {o.checks.map(c => (
                  <div key={c.key} className="flex items-start gap-2.5 px-4 py-2">
                    {ICON[c.status]}
                    <div className="min-w-0">
                      <div className={`text-[12.5px] ${c.status === "fail" ? "text-stone-100" : "text-stone-400"}`}>{c.label}</div>
                      <div className={`text-[11px] mt-0.5 ${c.status === "fail" ? "text-rose-300" : "text-stone-600"}`}>{c.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
