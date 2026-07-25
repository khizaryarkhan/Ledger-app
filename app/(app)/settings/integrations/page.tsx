"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useData } from "@/components/data-provider";
import { Card, Button, Badge } from "@/components/ui";
import {
  ChevronLeft, Link2, Unlink, RefreshCw, Check, AlertTriangle, Loader,
  CheckCircle, XCircle, Clock, Database,
} from "lucide-react";
import { fmt } from "@/lib/format";

// ─── Xero logo (inline SVG) ────────────────────────────────────────────────
function XeroLogo({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="4" fill="#13B5EA"/>
      <path d="M7.2 8.4L9.6 12L7.2 15.6H9L10.8 12.96L12.6 15.6H14.4L12 12L14.4 8.4H12.6L10.8 11.04L9 8.4H7.2Z" fill="white"/>
      <path d="M15.6 12C15.6 13.326 16.674 14.4 18 14.4V12.96C17.472 12.96 17.04 12.528 17.04 12C17.04 11.472 17.472 11.04 18 11.04V9.6C16.674 9.6 15.6 10.674 15.6 12Z" fill="white"/>
    </svg>
  );
}

export default function IntegrationsSettingsPage() {
  const { customers, invoices, refresh, toast } = useData() as any;
  const primaryCcy: string = invoices[0]?.currency ?? "USD";
  const searchParams = useSearchParams();

  // QBO
  const [qboStatus, setQboStatus] = useState<any>(null);
  const [syncHistory, setSyncHistory] = useState<any[]>([]);
  const [disconnecting, setDisconnecting] = useState(false);

  // ── Xero ─────────────────────────────────────────────────────────────────
  const [xeroStatus, setXeroStatus] = useState<any>(null);
  const [xeroHistory, setXeroHistory] = useState<any[]>([]);
  const [xeroDisconnecting, setXeroDisconnecting] = useState(false);
  const [xeroWebhookHealth, setXeroWebhookHealth] = useState<any>(null);

  // ── Sage Intacct ──────────────────────────────────────────────────────────
  const [sageStatus, setSageStatus] = useState<any>(null);
  const [sageHistory, setSageHistory] = useState<any[]>([]);
  const [sageDisconnecting, setSageDisconnecting] = useState(false);
  const [sageConnectOpen, setSageConnectOpen] = useState(false);
  const [sageConnecting, setSageConnecting] = useState(false);
  const [sageForm, setSageForm] = useState({ companyId: "", sageUserId: "", password: "", entityId: "" });
  const [sageConnectError, setSageConnectError] = useState<string | null>(null);
  const [sageInstructionsOpen, setSageInstructionsOpen] = useState(false);

  // ── Unified sync ──────────────────────────────────────────────────────────
  const [syncing, setSyncing] = useState(false);
  const [fullSyncing, setFullSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);

  const loadXeroWebhookHealth = () => {
    fetch("/api/xero/webhook-health")
      .then(r => r.ok ? r.json() : null)
      .then(setXeroWebhookHealth)
      .catch(() => {});
  };

  const refreshSyncHistories = () => {
    fetch("/api/qbo/history").then(r => r.json()).then(setSyncHistory).catch(() => {});
    fetch("/api/xero/history").then(r => r.json()).then(setXeroHistory).catch(() => {});
    fetch("/api/sage/history").then(r => r.json()).then(setSageHistory).catch(() => {});
  };

  // One sync request. For Full Sync we call this per provider+scope so each
  // slice gets its own time budget and no single request can time out.
  const postSync = async (body: any) => {
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    let data: any = null;
    try { data = await res.json(); } catch { /* non-JSON (e.g. 504 timeout) */ }
    return { res, data };
  };

  const handleSync = async (full = false) => {
    if (full) setFullSyncing(true); else setSyncing(true);
    setSyncResult(null);
    try {
      if (full) {
        // ── Chunked full sync: each provider's AR and AP as separate requests ──
        const providers = [
          qboStatus?.connected && "qbo",
          xeroStatus?.connected && "xero",
          sageStatus?.connected && "sage",
        ].filter(Boolean) as string[];

        const merged: any = {};
        let firstErr: string | null = null;
        for (const p of providers) {
          for (const sc of ["ar", "ap"] as const) {
            const { res, data } = await postSync({ full: true, provider: p, scope: sc });
            if (!res.ok) {
              const msg = (res.status === 504 || res.status === 502)
                ? `${p.toUpperCase()} ${sc.toUpperCase()} timed out`
                : (data?.error || `${p.toUpperCase()} ${sc.toUpperCase()} failed (HTTP ${res.status})`);
              firstErr = firstErr || msg;
              continue;
            }
            const slice = data?.synced?.[p];
            if (slice) {
              merged[p] = merged[p] || { ar: null, ap: null };
              if (slice.ar != null) merged[p].ar = slice.ar;
              if (slice.ap != null) merged[p].ap = slice.ap;
              if (slice.error) { firstErr = firstErr || slice.error; merged[p].error = slice.error; }
            }
            setSyncResult({ ...merged }); // progressive update so the user sees it fill in
          }
        }
        if (firstErr) toast(`Full sync issue: ${firstErr}`, "error");
        else toast("Full sync complete ✓");
        await refresh();
        refreshSyncHistories();
        return;
      }

      // ── Incremental sync: one request, all providers ──────────────────────
      const { res, data } = await postSync({ full: false });
      if (!res.ok) {
        if (res.status === 504 || res.status === 502) {
          toast("Sync timed out — try Full Sync, which runs in smaller chunks.", "error");
        } else {
          toast(data?.error || `Sync failed (HTTP ${res.status})`, "error");
        }
        return;
      }
      setSyncResult(data.synced);
      const provErr = data.synced?.qbo?.error || data.synced?.xero?.error || data.synced?.sage?.error;
      if (provErr) {
        toast(`Sync error: ${provErr}`, "error");
      } else {
        const qboDiff = data.synced?.qbo?.ar?.difference || 0;
        if (Math.abs(qboDiff) < 1) toast("Sync complete ✓");
        else toast(`Sync complete — €${Math.abs(qboDiff).toFixed(2)} QBO AR variance`, "info");
      }
      await refresh();
      refreshSyncHistories();
    } catch (e: any) {
      toast(`Sync failed: ${e?.message || "network error"}`, "error");
    } finally {
      if (full) setFullSyncing(false); else setSyncing(false);
    }
  };

  const handleXeroDisconnect = async () => {
    setXeroDisconnecting(true);
    try {
      await fetch("/api/xero/disconnect", { method: "POST" });
      setXeroStatus({ connected: false });
      setSyncResult(null);
      toast("Xero disconnected");
    } finally {
      setXeroDisconnecting(false);
    }
  };

  const handleSageConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setSageConnecting(true);
    setSageConnectError(null);
    try {
      const res = await fetch("/api/sage/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sageForm),
      });
      const data = await res.json();
      if (!res.ok) {
        setSageConnectError(data.error || "Connection failed");
      } else {
        setSageStatus({ connected: true, companyId: data.companyId, companyName: data.companyName });
        setSageConnectOpen(false);
        setSageForm({ companyId: "", sageUserId: "", password: "", entityId: "" });
        toast("Sage Intacct connected! Starting initial sync…");
        handleSync();
        fetch("/api/sage/history").then(r => r.json()).then(setSageHistory).catch(() => {});
      }
    } catch {
      setSageConnectError("Network error — please try again");
    } finally {
      setSageConnecting(false);
    }
  };

  const handleSageDisconnect = async () => {
    setSageDisconnecting(true);
    try {
      await fetch("/api/sage/disconnect", { method: "POST" });
      setSageStatus({ connected: false });
      setSyncResult(null);
      toast("Sage Intacct disconnected");
    } finally {
      setSageDisconnecting(false);
    }
  };

  // ── Backfill paid-at dates ─────────────────────────────────────────────────
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<{ backfilled: number; skipped: number } | null>(null);

  // Backfill inactive
  const [backfillingInactive, setBackfillingInactive] = useState(false);
  const [backfillInactiveResult, setBackfillInactiveResult] = useState<{ customersDeactivated: number; projectsDeactivated: number } | null>(null);
  const [fixingPaid, setFixingPaid] = useState(false);
  const [fixPaidResult, setFixPaidResult] = useState<{ corrected: number } | null>(null);

  // Webhook health
  const [webhookHealth, setWebhookHealth] = useState<any>(null);

  const loadWebhookHealth = () => {
    fetch("/api/qbo/webhook-health")
      .then(r => r.ok ? r.json() : null)
      .then(setWebhookHealth)
      .catch(() => {});
  };

  // QBO data verification
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<any>(null);

  const handleVerify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await fetch("/api/qbo/verify");
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || "Verification failed", "error");
      } else {
        setVerifyResult(data);
      }
    } catch {
      toast("Verification failed", "error");
    } finally {
      setVerifying(false);
    }
  };

  // AR amount verification
  const [verifyingAR, setVerifyingAR] = useState(false);
  const [arVerifyResult, setArVerifyResult] = useState<any>(null);

  const handleVerifyAR = async () => {
    setVerifyingAR(true);
    setArVerifyResult(null);
    try {
      const res = await fetch("/api/qbo/verify-ar");
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || "AR verification failed", "error");
      } else {
        setArVerifyResult(data);
      }
    } catch {
      toast("AR verification failed", "error");
    } finally {
      setVerifyingAR(false);
    }
  };

  useEffect(() => {
    fetch("/api/qbo/sync").then(r => r.json()).then(setQboStatus).catch(() => setQboStatus({ connected: false }));
    fetch("/api/qbo/history").then(r => r.json()).then(setSyncHistory).catch(() => {});
    loadWebhookHealth();
    fetch("/api/xero/sync").then(r => r.json()).then(setXeroStatus).catch(() => setXeroStatus({ connected: false }));
    fetch("/api/xero/history").then(r => r.json()).then(setXeroHistory).catch(() => {});
    loadXeroWebhookHealth();
    fetch("/api/sage/sync").then(r => r.json()).then(setSageStatus).catch(() => setSageStatus({ connected: false }));
    fetch("/api/sage/history").then(r => r.json()).then(setSageHistory).catch(() => {});
  }, []);

  useEffect(() => {
    const qbo = searchParams.get("qbo");
    if (qbo === "connected") {
      toast("QuickBooks connected! Starting initial sync…");
      fetch("/api/qbo/sync").then(r => r.json()).then(setQboStatus);
      handleSync();
    } else if (qbo === "error") {
      toast(`QBO error: ${searchParams.get("reason")}`, "error");
    }
    const xero = searchParams.get("xero");
    if (xero === "connected") {
      toast("Xero connected! Starting initial sync…");
      fetch("/api/xero/sync").then(r => r.json()).then(setXeroStatus);
      handleSync();
    } else if (xero === "error") {
      toast(`Xero error: ${searchParams.get("reason")}`, "error");
    }
  }, [searchParams]);

  const handleQboDisconnect = async () => {
    setDisconnecting(true);
    try {
      await fetch("/api/qbo/disconnect", { method: "POST" });
      setQboStatus({ connected: false });
      setSyncResult(null);
      toast("QuickBooks disconnected");
    } finally {
      setDisconnecting(false);
    }
  };

  const handleBackfill = async () => {
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const res = await fetch("/api/qbo/backfill-paid-at", { method: "POST" });
      const data = await res.json();
      if (!res.ok) toast(data.error || "Backfill failed", "error");
      else {
        setBackfillResult(data);
        toast(`Backfilled ${data.backfilled} invoice${data.backfilled !== 1 ? "s" : ""}`);
      }
    } catch {
      toast("Backfill failed", "error");
    } finally {
      setBackfilling(false);
    }
  };

  const handleBackfillInactive = async () => {
    setBackfillingInactive(true);
    setBackfillInactiveResult(null);
    try {
      const res = await fetch("/api/backfill-inactive", { method: "POST" });
      const data = await res.json();
      if (!res.ok) toast(data.error || "Backfill failed", "error");
      else {
        setBackfillInactiveResult(data);
        toast(`Marked ${data.customersDeactivated} customers and ${data.projectsDeactivated} projects inactive`);
        await refresh();
      }
    } catch {
      toast("Backfill failed", "error");
    } finally {
      setBackfillingInactive(false);
    }
  };

  const handleFixPaid = async () => {
    setFixingPaid(true);
    setFixPaidResult(null);
    try {
      const res = await fetch("/api/backfill-payment-status", { method: "POST" });
      const data = await res.json();
      if (!res.ok) toast(data.error || "Fix failed", "error");
      else {
        setFixPaidResult(data);
        toast(`Corrected ${data.corrected} invoice${data.corrected !== 1 ? "s" : ""} to Paid`);
        await refresh();
      }
    } catch {
      toast("Fix failed", "error");
    } finally {
      setFixingPaid(false);
    }
  };

  const isReconciled = syncResult && Math.abs(syncResult.difference || 0) < 1;

  return (
    <div className="p-6 max-w-[860px] mx-auto">
      {/* Back + header */}
      <div className="mb-6">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-[13px] text-stone-500 hover:text-stone-200 mb-3 transition-colors"
        >
          <ChevronLeft size={14} /> Settings
        </Link>
        <h1 className="text-2xl font-semibold text-white tracking-tight">Integrations</h1>
        <p className="text-sm text-stone-400 mt-1">Connect external services and manage data sync.</p>
      </div>

      {/* ── Unified Sync ── */}
      {(qboStatus?.connected || xeroStatus?.connected || sageStatus?.connected) && (
        <Card className="mb-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">Sync All</h3>
              <p className="text-[12px] text-stone-400 mt-0.5">
                Pulls Receivables (AR) and Payables (AP) from all connected integrations in one go.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => handleSync(true)} disabled={syncing || fullSyncing} title="Re-pulls ALL invoices, payments and credits from scratch (ignores the incremental boundary). Use after connecting or when reconciling.">
                {fullSyncing ? (
                  <span className="flex items-center gap-2">
                    <Loader size={14} className="animate-spin" />Full sync…
                  </span>
                ) : (
                  <span className="flex flex-col items-center leading-tight">
                    <span className="flex items-center gap-2"><RefreshCw size={14} />Full Sync</span>
                    <span className="text-[10px] font-normal text-stone-400">Takes time</span>
                  </span>
                )}
              </Button>
              <Button onClick={() => handleSync(false)} disabled={syncing || fullSyncing}>
                {syncing ? (
                  <span className="flex items-center gap-2">
                    <Loader size={14} className="animate-spin" />Syncing…
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <RefreshCw size={14} />Sync Now
                  </span>
                )}
              </Button>
            </div>
          </div>
          <p className="text-[11px] text-stone-500 mt-2">
            <span className="font-medium text-stone-400">Full Sync</span> re-pulls your entire history from QuickBooks, Xero and Sage (slower) so receivables fully reconcile. <span className="font-medium text-stone-400">Sync Now</span> pulls only what changed since the last sync.
          </p>

          {/* Combined sync result */}
          {syncResult && (
            <div className="mt-4 space-y-3">
              {syncResult.qbo && (
                <div className="bg-stone-800/40 ring-1 ring-stone-700 rounded-md p-3">
                  <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
                    QuickBooks — this sync
                  </div>
                  {syncResult.qbo.error ? (
                    <p className="text-sm text-rose-400">{syncResult.qbo.error}</p>
                  ) : (
                    <div className="grid grid-cols-4 gap-x-2 gap-y-3 text-center">
                      {[
                        { label: "Customers", value: syncResult.qbo.ar?.customers ?? 0 },
                        { label: "New invoices", value: syncResult.qbo.ar?.invoicesCreated ?? 0 },
                        { label: "Updated", value: syncResult.qbo.ar?.invoicesUpdated ?? 0 },
                        { label: "Auto-closed", value: syncResult.qbo.ar?.invoicesClosed ?? 0 },
                        { label: "Suppliers", value: syncResult.qbo.ap?.suppliers ?? 0 },
                        { label: "Bills", value: syncResult.qbo.ap?.bills ?? 0 },
                        { label: "Accounts", value: syncResult.qbo.ap?.accounts ?? 0 },
                        { label: "Items", value: syncResult.qbo.ap?.items ?? 0 },
                      ].map(({ label, value }) => (
                        <div key={label}>
                          <div className="text-xl font-semibold text-white">{value}</div>
                          <div className="text-[10px] text-stone-500">{label}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {syncResult.xero && (
                <div className="bg-stone-800/40 ring-1 ring-stone-700 rounded-md p-3">
                  <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
                    Xero — this sync
                  </div>
                  {syncResult.xero.error ? (
                    <p className="text-sm text-rose-400">{syncResult.xero.error}</p>
                  ) : (
                    <div className="grid grid-cols-4 gap-x-2 gap-y-3 text-center">
                      {[
                        { label: "Customers", value: syncResult.xero.ar?.customers ?? 0 },
                        { label: "New invoices", value: syncResult.xero.ar?.invoicesCreated ?? 0 },
                        { label: "Updated", value: syncResult.xero.ar?.invoicesUpdated ?? 0 },
                        { label: "Auto-closed", value: syncResult.xero.ar?.invoicesClosed ?? 0 },
                        { label: "Suppliers", value: syncResult.xero.ap?.suppliers ?? 0 },
                        { label: "Bills", value: syncResult.xero.ap?.bills ?? 0 },
                        { label: "Accounts", value: syncResult.xero.ap?.accounts ?? 0 },
                        { label: "Items", value: syncResult.xero.ap?.items ?? 0 },
                      ].map(({ label, value }) => (
                        <div key={label}>
                          <div className="text-xl font-semibold text-white">{value}</div>
                          <div className="text-[10px] text-stone-500">{label}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {syncResult.sage && (
                <div className="bg-stone-800/40 ring-1 ring-stone-700 rounded-md p-3">
                  <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
                    Sage Intacct — this sync
                  </div>
                  {syncResult.sage.error ? (
                    <p className="text-sm text-rose-400">{syncResult.sage.error}</p>
                  ) : (
                    <div className="grid grid-cols-4 gap-x-2 gap-y-3 text-center">
                      {[
                        { label: "Customers", value: syncResult.sage.ar?.customersCreated ?? 0 },
                        { label: "New invoices", value: syncResult.sage.ar?.invoicesCreated ?? 0 },
                        { label: "Updated", value: syncResult.sage.ar?.invoicesUpdated ?? 0 },
                        { label: "Auto-closed", value: syncResult.sage.ar?.invoicesClosed ?? 0 },
                        { label: "Suppliers", value: syncResult.sage.ap?.suppliersCreated ?? 0 },
                        { label: "New bills", value: syncResult.sage.ap?.billsCreated ?? 0 },
                        { label: "Bills updated", value: syncResult.sage.ap?.billsUpdated ?? 0 },
                        { label: "Credits", value: syncResult.sage.ar?.creditsCreated ?? 0 },
                      ].map(({ label, value }) => (
                        <div key={label}>
                          <div className="text-xl font-semibold text-white">{value}</div>
                          <div className="text-[10px] text-stone-500">{label}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* QuickBooks Online */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 mb-4">
          <Link2 size={16} className="text-stone-400" />
          <h3 className="text-sm font-semibold text-white">QuickBooks Online</h3>
          {qboStatus?.connected && <Badge variant="green" size="sm">Connected</Badge>}
        </div>

        {qboStatus === null ? (
          <div className="flex items-center gap-2 text-sm text-stone-500">
            <Loader size={14} className="animate-spin" /> Checking…
          </div>
        ) : qboStatus.connected ? (
          <div className="space-y-4">
            {/* Connected banner */}
            <div className="bg-emerald-500/10 ring-1 ring-emerald-500/30 rounded-md p-3 flex items-center gap-2">
              <Check size={15} className="text-emerald-400" />
              <div>
                <div className="text-sm font-medium text-emerald-400">
                  Connected to {qboStatus.companyName}
                </div>
                <div className="text-[11px] text-emerald-500/80 mt-0.5">Realm ID: {qboStatus.realmId}</div>
              </div>
            </div>

            <div className="text-sm text-stone-400">
              Sync pulls all open invoices (Balance &gt; 0) and unapplied credits from QBO. Invoices paid in
              QBO auto-close in Ledger. Your collection notes, stages and tasks are never overwritten.
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="secondary" size="sm" onClick={handleBackfill} disabled={backfilling || syncing}>
                {backfilling ? (
                  <span className="flex items-center gap-2">
                    <Loader size={14} className="animate-spin" />Backfilling…
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Clock size={14} />Backfill payment dates
                  </span>
                )}
              </Button>
              <Button variant="secondary" size="sm" onClick={handleVerify} disabled={verifying}>
                {verifying ? (
                  <span className="flex items-center gap-2">
                    <Loader size={14} className="animate-spin" />Comparing…
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Database size={14} />Verify QBO data
                  </span>
                )}
              </Button>
              <Button variant="secondary" size="sm" onClick={handleVerifyAR} disabled={verifyingAR}>
                {verifyingAR ? (
                  <span className="flex items-center gap-2">
                    <Loader size={14} className="animate-spin" />Comparing AR…
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Database size={14} />Verify AR total
                  </span>
                )}
              </Button>
              <Button variant="ghost" size="sm" onClick={handleQboDisconnect} disabled={disconnecting}>
                <Unlink size={14} className="mr-1.5" />
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </Button>
            </div>

            {/* Verify result — side-by-side counts */}
            {verifyResult && (
              <div className="rounded-md ring-1 ring-stone-700 overflow-hidden">
                <div className="px-3 py-2 bg-stone-800/60 border-b border-stone-800 flex items-center justify-between">
                  <div className="text-xs font-semibold text-stone-300 uppercase tracking-wider">
                    QBO vs Ledger
                  </div>
                  <div className="text-[10px] text-stone-500">
                    Checked {new Date(verifyResult.checkedAt).toLocaleString("en-IE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead className="text-[11px] text-stone-500 uppercase">
                    <tr className="border-b border-stone-800">
                      <th className="text-left px-3 py-2 font-medium">Entity</th>
                      <th className="text-right px-3 py-2 font-medium">In QBO</th>
                      <th className="text-right px-3 py-2 font-medium">In Ledger</th>
                      <th className="text-right px-3 py-2 font-medium">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {verifyResult.rows.map((row: any) => {
                      const diff = row.ledger - row.qbo;
                      const inSync = diff === 0;
                      const ledgerLow = diff < 0;
                      return (
                        <tr key={row.entity} className="border-b border-stone-800/50 last:border-0">
                          <td className="px-3 py-2 text-stone-200">{row.entity}</td>
                          <td className="px-3 py-2 text-right text-stone-400 tabular-nums">
                            {row.qbo === -1 ? "—" : row.qbo.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-right text-stone-400 tabular-nums">
                            {row.ledger.toLocaleString()}
                          </td>
                          <td className={`px-3 py-2 text-right tabular-nums font-medium ${
                            inSync ? "text-emerald-600" : ledgerLow ? "text-rose-600" : "text-amber-600"
                          }`}>
                            {inSync ? "✓" : (diff > 0 ? "+" : "") + diff.toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="px-3 py-2 bg-stone-800/40 border-t border-stone-800 text-[11px] text-stone-500 flex items-center justify-between">
                  <span>Payment applications stored: <span className="font-medium text-stone-300">{verifyResult.paymentApplications?.toLocaleString() ?? 0}</span></span>
                  <span>
                    {verifyResult.rows.every((r: any) => r.qbo === r.ledger)
                      ? <span className="text-emerald-400 font-medium">✓ Ledger matches QBO</span>
                      : <span className="text-amber-400">Run Sync to pull missing data</span>}
                  </span>
                </div>
              </div>
            )}

            {/* AR verification result */}
            {arVerifyResult && (
              <div className="rounded-md ring-1 ring-stone-700 overflow-hidden">
                <div className="px-3 py-2 bg-stone-800/60 border-b border-stone-800 flex items-center justify-between">
                  <div className="text-xs font-semibold text-stone-300 uppercase tracking-wider">AR Total — QBO vs Ledger</div>
                  <div className="text-[10px] text-stone-500">Checked {new Date(arVerifyResult.checkedAt).toLocaleString("en-IE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                </div>
                <table className="w-full text-[12px]">
                  <thead className="text-[10px] text-stone-500 uppercase">
                    <tr className="border-b border-stone-800">
                      <th className="text-left px-2 py-2 font-medium">Cur</th>
                      <th className="text-right px-2 py-2 font-medium">QBO Invoices</th>
                      <th className="text-right px-2 py-2 font-medium">QBO Credits</th>
                      <th className="text-right px-2 py-2 font-medium">QBO Net</th>
                      <th className="text-right px-2 py-2 font-medium">Ledger Invoices</th>
                      <th className="text-right px-2 py-2 font-medium">Ledger Credits</th>
                      <th className="text-right px-2 py-2 font-medium">Ledger Net</th>
                      <th className="text-right px-2 py-2 font-medium">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {arVerifyResult.byCurrency.map((row: any) => {
                      const diff = row.ledger.net - row.qbo.net;
                      const inSync = Math.abs(diff) < 0.50;
                      return (
                        <tr key={row.currency} className="border-b border-stone-800/50 last:border-0">
                          <td className="px-2 py-2 font-mono text-stone-300">{row.currency}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-stone-400">{fmt.money(row.qbo.invoices, row.currency)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-stone-400">{fmt.money(row.qbo.credits, row.currency)}</td>
                          <td className="px-2 py-2 text-right tabular-nums font-semibold text-white">{fmt.money(row.qbo.net, row.currency)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-stone-400">{fmt.money(row.ledger.invoices, row.currency)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-stone-400">{fmt.money(row.ledger.credits, row.currency)}</td>
                          <td className="px-2 py-2 text-right tabular-nums font-semibold text-white">{fmt.money(row.ledger.net, row.currency)}</td>
                          <td className={`px-2 py-2 text-right tabular-nums font-semibold ${inSync ? "text-emerald-600" : "text-rose-600"}`}>
                            {inSync ? "✓" : fmt.money(diff, row.currency)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="px-3 py-2 bg-stone-800/40 border-t border-stone-800 text-[11px] text-stone-500 flex items-center justify-between">
                  <span>QBO open: {arVerifyResult.qbo.openInvoiceCount} invoices, {arVerifyResult.qbo.openCmCount} credit memos</span>
                  <span>
                    {Math.abs(arVerifyResult.difference) < 0.50
                      ? <span className="text-emerald-400 font-medium">✓ AR totals match QBO</span>
                      : <span className="text-amber-400">Ledger AR differs by {fmt.money(Math.abs(arVerifyResult.difference), primaryCcy)}</span>}
                  </span>
                </div>
              </div>
            )}

            {/* Backfill result */}
            {backfillResult && (
              <div className="bg-emerald-500/10 ring-1 ring-emerald-500/30 rounded-md px-3 py-2 text-sm text-emerald-400 flex items-center gap-2">
                <Check size={14} className="text-emerald-400 shrink-0" />
                <span>
                  Backfilled <strong>{backfillResult.backfilled}</strong> invoice
                  {backfillResult.backfilled !== 1 ? "s" : ""} with payment dates
                  {backfillResult.skipped > 0
                    ? ` · ${backfillResult.skipped} skipped (no QBO payment found)`
                    : ""}
                </span>
              </div>
            )}

            {/* Reconciliation panel */}
            {syncResult && (
              <div className="space-y-3">
                <div
                  className={`rounded-lg p-4 ring-1 ${
                    isReconciled ? "bg-emerald-500/10 ring-emerald-500/30" : "bg-amber-500/10 ring-amber-500/30"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-3">
                    {isReconciled ? (
                      <CheckCircle size={16} className="text-emerald-400" />
                    ) : (
                      <AlertTriangle size={16} className="text-amber-400" />
                    )}
                    <span className="text-sm font-semibold">
                      {isReconciled ? "AR Reconciled ✓" : "AR Variance — investigation needed"}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    {[
                      { label: "QBO Total AR", value: syncResult.qboTotalAR, note: "From QBO open invoices" },
                      { label: "Ledger Total AR", value: syncResult.ledgerTotalAR, note: "Invoices in Ledger" },
                      {
                        label: "Difference",
                        value: syncResult.difference || 0,
                        note: isReconciled ? "Fully reconciled" : "Check credits/JEs",
                        colored: true,
                      },
                    ].map(({ label, value, note, colored }) => (
                      <div key={label} className="bg-stone-900/60 rounded-md p-3">
                        <div className="text-[11px] text-stone-500 mb-1">{label}</div>
                        <div
                          className={`text-lg font-semibold tabular-nums ${
                            colored
                              ? isReconciled
                                ? "text-emerald-400"
                                : "text-amber-400"
                              : "text-white"
                          }`}
                        >
                          {fmt.money(value, primaryCcy)}
                        </div>
                        <div className="text-[10px] text-stone-400 mt-0.5">{note}</div>
                      </div>
                    ))}
                  </div>
                  {!isReconciled && (
                    <div className="mt-3 text-xs text-amber-300 bg-amber-500/10 rounded p-2">
                      A variance may be caused by: Journal Entries hitting AR, retainer deposits, write-offs,
                      or invoices in a currency not yet synced. Check QBO AR Aging report.
                    </div>
                  )}
                </div>

                {/* Sync stats */}
                <div className="bg-stone-800/40 ring-1 ring-stone-700 rounded-md p-3">
                  <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
                    This sync
                  </div>
                  <div className="grid grid-cols-4 gap-x-2 gap-y-3 text-center">
                    {[
                      { label: "Customers", value: syncResult.customers },
                      { label: "Contacts", value: syncResult.contacts },
                      { label: "New invoices", value: syncResult.invoicesCreated },
                      { label: "Updated", value: syncResult.invoicesUpdated },
                      { label: "Auto-closed", value: syncResult.invoicesClosed },
                      { label: "Paid-dates fixed", value: syncResult.paidAtBackfilled || 0 },
                      { label: "Payments", value: (syncResult.paymentsCreated || 0) + (syncResult.paymentsUpdated || 0) },
                      { label: "Refunds", value: (syncResult.refundsCreated || 0) + (syncResult.refundsUpdated || 0) },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <div className="text-xl font-semibold text-white">{value}</div>
                        <div className="text-[10px] text-stone-500">{label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Webhook health — real-time delivery status */}
            {webhookHealth && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
                    Real-time webhook health
                  </div>
                  <button onClick={loadWebhookHealth}
                    className="text-[11px] text-stone-400 hover:text-stone-200 flex items-center gap-1">
                    <RefreshCw size={10} /> Refresh
                  </button>
                </div>

                {(() => {
                  const lastAt = webhookHealth.lastWebhookAt ? new Date(webhookHealth.lastWebhookAt) : null;
                  const lastSuccessAt = webhookHealth.lastSuccessAt ? new Date(webhookHealth.lastSuccessAt) : null;
                  const minutesSinceLast = lastAt ? Math.floor((Date.now() - lastAt.getTime()) / 60000) : null;
                  const minutesSinceSuccess = lastSuccessAt ? Math.floor((Date.now() - lastSuccessAt.getTime()) / 60000) : null;

                  // Health badge logic:
                  // - never received any webhook → "Not yet received"
                  // - last success within 24h → "Healthy"
                  // - last success > 24h ago → "Quiet"
                  // - errors > 0 in last 24h → "Errors"
                  let healthLabel = "Not yet received";
                  let healthColor = "neutral";
                  const isStale = lastSuccessAt && minutesSinceSuccess! > 60 * 48;
                  if (lastSuccessAt) {
                    if (webhookHealth.errorsLast24h > 0) {
                      healthLabel = `${webhookHealth.errorsLast24h} error(s) in 24h`;
                      healthColor = "amber";
                    } else if (minutesSinceSuccess! < 60 * 24) {
                      healthLabel = "Healthy";
                      healthColor = "emerald";
                    } else if (isStale) {
                      healthLabel = "Subscription may be broken";
                      healthColor = "rose";
                    } else {
                      healthLabel = "No events in 24h";
                      healthColor = "amber";
                    }
                  }

                  const fmtRelative = (mins: number | null) => {
                    if (mins === null) return "never";
                    if (mins < 1) return "just now";
                    if (mins < 60) return `${mins} min ago`;
                    const h = Math.floor(mins / 60);
                    if (h < 48) return `${h} h ago`;
                    return `${Math.floor(h / 24)} d ago`;
                  };

                  return (
                    <div className={`rounded-lg p-3 ring-1 ${
                      healthColor === "emerald" ? "bg-emerald-500/10 ring-emerald-500/30" :
                      healthColor === "rose"    ? "bg-rose-500/10 ring-rose-500/30" :
                      healthColor === "amber"   ? "bg-amber-500/10 ring-amber-500/30" :
                      "bg-stone-800/40 ring-stone-700"
                    }`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {healthColor === "emerald" ? <CheckCircle size={14} className="text-emerald-400" /> :
                           healthColor === "rose"    ? <XCircle size={14} className="text-rose-400" /> :
                           healthColor === "amber"   ? <AlertTriangle size={14} className="text-amber-400" /> :
                           <Clock size={14} className="text-stone-400" />}
                          <span className={`text-sm font-medium ${
                            healthColor === "emerald" ? "text-emerald-400" :
                            healthColor === "rose"    ? "text-rose-300" :
                            healthColor === "amber"   ? "text-amber-300" : "text-stone-300"
                          }`}>{healthLabel}</span>
                        </div>
                        <span className="text-[11px] text-stone-500">
                          {webhookHealth.last24hCount} event(s) in last 24h
                        </span>
                      </div>
                      {isStale && (
                        <div className="mb-2 text-[11px] text-rose-300 bg-rose-500/10 rounded px-2 py-1.5 leading-relaxed">
                          QBO has not sent any webhooks in {Math.floor(minutesSinceSuccess! / 60 / 24)} days. Payments recorded in QBO will not auto-close until you fix this.
                          <br />
                          <strong>Fix:</strong> Go to{" "}
                          <a href="https://developer.intuit.com" target="_blank" rel="noopener noreferrer" className="underline text-rose-200">developer.intuit.com</a>
                          {" "}→ your app → Webhooks → verify the endpoint is{" "}
                          <code className="font-mono text-rose-100 bg-rose-500/20 px-1 rounded">https://primeaccountax.com/api/webhooks/qbo</code>
                          {" "}and the Verifier Token matches your env var.
                        </div>
                      )}
                      <div className="grid grid-cols-3 gap-3 text-[11px]">
                        <div>
                          <div className="text-stone-400 uppercase tracking-wider mb-0.5">Last event</div>
                          <div className="text-stone-300">{fmtRelative(minutesSinceLast)}</div>
                        </div>
                        <div>
                          <div className="text-stone-400 uppercase tracking-wider mb-0.5">Last success</div>
                          <div className="text-stone-300">{fmtRelative(minutesSinceSuccess)}</div>
                        </div>
                        <div>
                          <div className="text-stone-400 uppercase tracking-wider mb-0.5">Cron safety net</div>
                          <div className="text-stone-300">{
                            webhookHealth.lastCronSyncAt
                              ? fmtRelative(Math.floor((Date.now() - new Date(webhookHealth.lastCronSyncAt).getTime()) / 60000))
                              : "never"
                          }</div>
                        </div>
                      </div>
                      <div className="mt-2 pt-2 border-t border-stone-700/60 text-[10px] text-stone-500">
                        Webhooks deliver QBO changes in seconds. If we miss one, the daily cron sync reconciles all data — nothing is permanently lost.
                      </div>
                    </div>
                  );
                })()}

                {/* Recent webhook events */}
                {webhookHealth.recentEvents?.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {webhookHealth.recentEvents.slice(0, 5).map((ev: any) => (
                      <div key={ev.id} className="flex items-center gap-2 text-[11px] py-1 px-2 rounded hover:bg-stone-800/50">
                        {ev.status === "received" ? <CheckCircle size={11} className="text-emerald-500" /> :
                         ev.status === "error" ? <XCircle size={11} className="text-rose-500" /> :
                         <AlertTriangle size={11} className="text-amber-500" />}
                        <span className="text-stone-500 w-28">
                          {new Date(ev.receivedAt).toLocaleString("en-IE", {
                            day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                          })}
                        </span>
                        <span className="text-stone-300">{ev.entityCount} change(s)</span>
                        <span className="text-stone-400 truncate">
                          {ev.entities?.map((e: any) => `${e.name}#${e.id}(${e.operation})`).join(", ")}
                        </span>
                        {ev.errorMessage && <span className="ml-auto text-rose-400">{ev.errorMessage}</span>}
                        {ev.processingMs && !ev.errorMessage && (
                          <span className="ml-auto text-stone-400">{ev.processingMs}ms</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Sync history */}
            {syncHistory.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
                  Sync history
                </div>
                <div className="space-y-1.5">
                  {syncHistory.slice(0, 8).map((log: any) => {
                    const reconciled = Math.abs(log.difference || 0) < 1;
                    return (
                      <div
                        key={log.id}
                        className="flex items-center gap-3 text-sm py-1.5 border-b border-stone-800 last:border-0"
                      >
                        {log.status === "success" ? (
                          <CheckCircle size={14} className={reconciled ? "text-emerald-500" : "text-amber-500"} />
                        ) : (
                          <XCircle size={14} className="text-rose-500" />
                        )}
                        <span className="text-stone-500 text-[12px] w-36">
                          {new Date(log.syncedAt).toLocaleString("en-IE", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        {log.status === "success" ? (
                          <>
                            <span className="text-stone-400 text-[12px]">
                              {log.invoicesCreated} new · {log.invoicesUpdated} updated · {log.invoicesClosed} closed
                            </span>
                            <span
                              className={`ml-auto text-[12px] font-medium tabular-nums ${
                                reconciled ? "text-emerald-400" : "text-amber-400"
                              }`}
                            >
                              {reconciled ? "✓ Reconciled" : `Δ ${fmt.money(log.difference || 0, primaryCcy)}`}
                            </span>
                            <span className="text-stone-400 text-[11px]">
                              {log.durationMs ? `${(log.durationMs / 1000).toFixed(1)}s` : ""}
                            </span>
                          </>
                        ) : (
                          <span className="text-rose-600 text-[12px] truncate">{log.errorMessage}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Not connected */
          <div className="space-y-5">
            <p className="text-sm text-stone-400 leading-relaxed">
              Connect QuickBooks Online to automatically sync your customers and outstanding
              invoices. Changes in QBO — new invoices, payments, credits — flow into Ledger
              in real time via webhooks, with a 30-minute cron safety net.
            </p>

            {/* Feature bullets */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { icon: <RefreshCw size={13} />, text: "Automatic two-way sync" },
                { icon: <Check size={13} />,      text: "Invoices close when paid in QBO" },
                { icon: <Database size={13} />,   text: "Customers & contacts imported" },
                { icon: <Clock size={13} />,      text: "Real-time webhooks + cron backup" },
              ].map(({ icon, text }) => (
                <div key={text} className="flex items-center gap-2 text-[13px] text-stone-400">
                  <span className="text-emerald-500 shrink-0">{icon}</span>
                  {text}
                </div>
              ))}
            </div>

            <Button icon={Link2} onClick={() => (window.location.href = "/api/qbo")}>
              Connect QuickBooks Online
            </Button>
          </div>
        )}
      </Card>

      {/* ── Xero ── */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 mb-4">
          <XeroLogo size={16} />
          <h3 className="text-sm font-semibold text-white">Xero</h3>
          {xeroStatus?.connected && <Badge variant="green" size="sm">Connected</Badge>}
        </div>

        {xeroStatus === null ? (
          <div className="flex items-center gap-2 text-sm text-stone-500">
            <Loader size={14} className="animate-spin" /> Checking…
          </div>
        ) : xeroStatus.connected ? (
          <div className="space-y-4">
            {/* Connected banner */}
            <div className="bg-sky-500/10 ring-1 ring-sky-500/30 rounded-md p-3 flex items-center gap-2">
              <Check size={15} className="text-sky-400" />
              <div>
                <div className="text-sm font-medium text-sky-400">
                  Connected to {xeroStatus.tenantName || "Xero"}
                </div>
                <div className="text-[11px] text-sky-500/80 mt-0.5">Tenant ID: {xeroStatus.tenantId}</div>
              </div>
            </div>

            <div className="text-sm text-stone-400">
              Sync pulls all Xero Contacts (as customers), open Invoices, Credit Notes and
              Payments. Invoices marked Paid in Xero auto-close in Ledger. Collection notes,
              stages and tasks are never overwritten.
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="ghost" size="sm" onClick={handleXeroDisconnect} disabled={xeroDisconnecting}>
                <Unlink size={14} className="mr-1.5" />
                {xeroDisconnecting ? "Disconnecting…" : "Disconnect"}
              </Button>
            </div>

            {/* Webhook health */}
            {xeroWebhookHealth && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
                    Real-time webhook health
                  </div>
                  <button
                    onClick={loadXeroWebhookHealth}
                    className="text-[11px] text-stone-400 hover:text-stone-200 flex items-center gap-1"
                  >
                    <RefreshCw size={10} /> Refresh
                  </button>
                </div>
                {(() => {
                  const lastAt = xeroWebhookHealth.lastWebhookAt ? new Date(xeroWebhookHealth.lastWebhookAt) : null;
                  const lastSuccessAt = xeroWebhookHealth.lastSuccessAt ? new Date(xeroWebhookHealth.lastSuccessAt) : null;
                  const minsLast = lastAt ? Math.floor((Date.now() - lastAt.getTime()) / 60000) : null;
                  const minsSuccess = lastSuccessAt ? Math.floor((Date.now() - lastSuccessAt.getTime()) / 60000) : null;
                  let healthLabel = "Not yet received";
                  let healthColor = "neutral";
                  if (lastSuccessAt) {
                    if (xeroWebhookHealth.errorsLast24h > 0) { healthLabel = `${xeroWebhookHealth.errorsLast24h} error(s) in 24h`; healthColor = "amber"; }
                    else if (minsSuccess! < 60 * 24) { healthLabel = "Healthy"; healthColor = "emerald"; }
                    else { healthLabel = "No events in 24h"; healthColor = "amber"; }
                  }
                  const fmtRel = (m: number | null) => {
                    if (m === null) return "never";
                    if (m < 1) return "just now";
                    if (m < 60) return `${m} min ago`;
                    const h = Math.floor(m / 60);
                    if (h < 48) return `${h} h ago`;
                    return `${Math.floor(h / 24)} d ago`;
                  };
                  return (
                    <div className={`rounded-lg p-3 ring-1 ${
                      healthColor === "emerald" ? "bg-emerald-500/10 ring-emerald-500/30" :
                      healthColor === "amber" ? "bg-amber-500/10 ring-amber-500/30" :
                      "bg-stone-800/40 ring-stone-700"
                    }`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {healthColor === "emerald" ? <CheckCircle size={14} className="text-emerald-400" /> :
                           healthColor === "amber" ? <AlertTriangle size={14} className="text-amber-400" /> :
                           <Clock size={14} className="text-stone-400" />}
                          <span className={`text-sm font-medium ${
                            healthColor === "emerald" ? "text-emerald-400" :
                            healthColor === "amber" ? "text-amber-300" : "text-stone-300"
                          }`}>{healthLabel}</span>
                        </div>
                        <span className="text-[11px] text-stone-500">
                          {xeroWebhookHealth.last24hCount} event(s) in last 24h
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-3 text-[11px]">
                        <div><div className="text-stone-400 uppercase tracking-wider mb-0.5">Last event</div><div className="text-stone-300">{fmtRel(minsLast)}</div></div>
                        <div><div className="text-stone-400 uppercase tracking-wider mb-0.5">Last success</div><div className="text-stone-300">{fmtRel(minsSuccess)}</div></div>
                        <div><div className="text-stone-400 uppercase tracking-wider mb-0.5">Cron safety net</div><div className="text-stone-300">{xeroWebhookHealth.lastCronSyncAt ? fmtRel(Math.floor((Date.now() - new Date(xeroWebhookHealth.lastCronSyncAt).getTime()) / 60000)) : "never"}</div></div>
                      </div>
                      <div className="mt-2 pt-2 border-t border-stone-700/60 text-[10px] text-stone-500">
                        Webhooks deliver Xero changes in seconds. The cron safety net runs every 4 hours to reconcile anything missed.
                      </div>
                    </div>
                  );
                })()}
                {xeroWebhookHealth.recentEvents?.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {xeroWebhookHealth.recentEvents.slice(0, 5).map((ev: any) => (
                      <div key={ev.id} className="flex items-center gap-2 text-[11px] py-1 px-2 rounded hover:bg-stone-800/50">
                        {ev.status === "received" ? <CheckCircle size={11} className="text-emerald-500" /> :
                         ev.status === "error" ? <XCircle size={11} className="text-rose-500" /> :
                         <AlertTriangle size={11} className="text-amber-500" />}
                        <span className="text-stone-500 w-28">
                          {new Date(ev.receivedAt).toLocaleString("en-IE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <span className="text-stone-300">{ev.entityCount} change(s)</span>
                        {ev.errorMessage && <span className="ml-auto text-rose-400">{ev.errorMessage}</span>}
                        {ev.processingMs && !ev.errorMessage && <span className="ml-auto text-stone-400">{ev.processingMs}ms</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Sync history */}
            {xeroHistory.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
                  Sync history
                </div>
                <div className="space-y-1.5">
                  {xeroHistory.slice(0, 8).map((log: any) => (
                    <div key={log.id} className="flex items-center gap-3 text-sm py-1.5 border-b border-stone-800 last:border-0">
                      {log.status === "success"
                        ? <CheckCircle size={14} className="text-emerald-500" />
                        : <XCircle size={14} className="text-rose-500" />}
                      <span className="text-stone-500 text-[12px] w-36">
                        {new Date(log.syncedAt).toLocaleString("en-IE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {log.status === "success" ? (
                        <>
                          <span className="text-stone-400 text-[12px]">
                            {log.invoicesCreated} new · {log.invoicesUpdated} updated · {log.invoicesClosed} closed
                          </span>
                          <span className="text-stone-400 text-[11px] ml-auto">
                            {log.durationMs ? `${(log.durationMs / 1000).toFixed(1)}s` : ""}
                          </span>
                        </>
                      ) : (
                        <span className="text-rose-600 text-[12px] truncate">{log.errorMessage}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Not connected */
          <div className="space-y-5">
            <p className="text-sm text-stone-400 leading-relaxed">
              Connect Xero to automatically sync your customers (Contacts) and outstanding
              invoices. Payments and credit notes flow into Ledger in real time via webhooks,
              with a scheduled cron safety net every 4 hours.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { icon: <RefreshCw size={13} />, text: "Contacts synced as customers" },
                { icon: <Check size={13} />,     text: "Invoices close when paid in Xero" },
                { icon: <Database size={13} />,  text: "Credit notes tracked as credits" },
                { icon: <Clock size={13} />,     text: "Real-time webhooks + cron backup" },
              ].map(({ icon, text }) => (
                <div key={text} className="flex items-center gap-2 text-[13px] text-stone-400">
                  <span className="text-sky-400 shrink-0">{icon}</span>
                  {text}
                </div>
              ))}
            </div>
            <Button onClick={() => (window.location.href = `/api/xero?t=${Date.now()}`)}>
              <XeroLogo size={14} />
              <span className="ml-1.5">Connect Xero</span>
            </Button>
          </div>
        )}
      </Card>

      {/* ── Sage Intacct ── */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 mb-4">
          <Database size={16} className="text-violet-400" />
          <h3 className="text-sm font-semibold text-white">Sage Intacct</h3>
          {sageStatus?.connected
            ? <Badge variant="green" size="sm">Connected</Badge>
            : <Badge variant="neutral" size="sm">Coming soon</Badge>}
        </div>

        {sageStatus === null ? (
          <div className="flex items-center gap-2 text-sm text-stone-500">
            <Loader size={14} className="animate-spin" /> Checking…
          </div>
        ) : sageStatus.connected ? (
          <div className="space-y-4">
            {/* Connected banner */}
            <div className="bg-violet-500/10 ring-1 ring-violet-500/30 rounded-md p-3 flex items-center gap-2">
              <Check size={15} className="text-violet-400" />
              <div>
                <div className="text-sm font-medium text-violet-400">
                  Connected to {sageStatus.companyName || sageStatus.companyId}
                </div>
                <div className="text-[11px] text-violet-500/80 mt-0.5">Company ID: {sageStatus.companyId}</div>
              </div>
            </div>

            <div className="text-sm text-stone-400">
              Sync pulls AR customers, invoices, and credit memos plus AP vendors and bills.
              Runs daily via cron — no webhooks required.
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="ghost" size="sm" onClick={handleSageDisconnect} disabled={sageDisconnecting}>
                <Unlink size={14} className="mr-1.5" />
                {sageDisconnecting ? "Disconnecting…" : "Disconnect"}
              </Button>
            </div>

            {/* Sync history */}
            {sageHistory.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
                  Sync history
                </div>
                <div className="space-y-1.5">
                  {sageHistory.slice(0, 8).map((log: any) => (
                    <div key={log.id} className="flex items-center gap-3 text-sm py-1.5 border-b border-stone-800 last:border-0">
                      {log.status === "success"
                        ? <CheckCircle size={14} className="text-emerald-500" />
                        : <XCircle size={14} className="text-rose-500" />}
                      <span className="text-stone-500 text-[12px] w-36">
                        {new Date(log.syncedAt).toLocaleString("en-IE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {log.status === "success" ? (
                        <>
                          <span className="text-stone-400 text-[12px]">
                            {log.invoicesCreated} new · {log.invoicesUpdated} updated · {log.invoicesClosed} closed
                          </span>
                          <span className="text-stone-400 text-[11px] ml-auto">
                            {log.durationMs ? `${(log.durationMs / 1000).toFixed(1)}s` : ""}
                          </span>
                        </>
                      ) : (
                        <span className="text-rose-600 text-[12px] truncate">{log.errorMessage}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Coming soon — Sage web-services sender registration pending */
          <div className="space-y-5">
            <p className="text-sm text-stone-400 leading-relaxed">
              Sync your Sage Intacct customers, invoices, credit memos, vendors and bills.
              <span className="text-stone-500"> This integration is being finalised and will be available soon.</span>
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 opacity-60">
              {[
                { icon: <RefreshCw size={13} />, text: "AR customers and invoices synced" },
                { icon: <Check size={13} />,     text: "Invoices close when paid in Sage" },
                { icon: <Database size={13} />,  text: "AP vendors and bills imported" },
                { icon: <Clock size={13} />,     text: "Daily cron sync — fully automatic" },
              ].map(({ icon, text }) => (
                <div key={text} className="flex items-center gap-2 text-[13px] text-stone-400">
                  <span className="text-violet-400 shrink-0">{icon}</span>
                  {text}
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <Button disabled className="opacity-60 cursor-not-allowed">
                <Clock size={14} />
                <span className="ml-1.5">Coming soon</span>
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* ── Sage instructions modal ── */}
      {sageInstructionsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-stone-900 border border-stone-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

            {/* Header */}
            <div className="px-6 pt-6 pb-4 border-b border-stone-800 flex items-start justify-between shrink-0">
              <div>
                <h2 className="text-base font-semibold text-white">Sage Intacct — Setup Guide</h2>
                <p className="text-[13px] text-stone-400 mt-1">
                  Complete these steps in your Sage Intacct account before connecting.
                </p>
              </div>
              <button onClick={() => setSageInstructionsOpen(false)} className="text-stone-500 hover:text-white transition-colors ml-4 mt-0.5">
                ✕
              </button>
            </div>

            {/* Steps */}
            <div className="overflow-y-auto px-6 py-5 space-y-5">

              {/* Step 1 */}
              <div className="flex gap-4">
                <div className="shrink-0 w-7 h-7 rounded-full bg-violet-500/20 border border-violet-500/40 flex items-center justify-center text-xs font-bold text-violet-400">1</div>
                <div>
                  <div className="text-sm font-semibold text-white mb-1">Enable Web Services</div>
                  <div className="text-[13px] text-stone-400 leading-relaxed">
                    Log into Sage Intacct as a Company Admin, then go to:
                  </div>
                  <div className="mt-2 px-3 py-2 bg-stone-800 rounded-lg font-mono text-[12px] text-violet-300">
                    Company → Admin → Subscriptions → tick <strong>Web Services</strong> → Save
                  </div>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex gap-4">
                <div className="shrink-0 w-7 h-7 rounded-full bg-violet-500/20 border border-violet-500/40 flex items-center justify-center text-xs font-bold text-violet-400">2</div>
                <div>
                  <div className="text-sm font-semibold text-white mb-1">Authorise Primeaccountax</div>
                  <div className="text-[13px] text-stone-400 leading-relaxed">
                    This allows our platform to connect to your Sage account. Go to:
                  </div>
                  <div className="mt-2 px-3 py-2 bg-stone-800 rounded-lg font-mono text-[12px] text-violet-300">
                    Company → Admin → Web Services Authorizations → Add
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {[
                      { label: "Sender ID",   value: "Primeaccountax" },
                      { label: "Password",    value: "Primeaccountax1!" },
                      { label: "Description", value: "Primeaccountax Integration" },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex items-center gap-2 text-[12px]">
                        <span className="text-stone-500 w-24 shrink-0">{label}:</span>
                        <span className="font-mono bg-stone-800 border border-stone-700 px-2 py-0.5 rounded text-white select-all">{value}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 text-[12px] text-amber-400/80">
                    ⚠ Enter these values exactly as shown — they must match our system.
                  </div>
                  <div className="mt-1 text-[12px] text-stone-500">Click <strong className="text-stone-400">Save</strong> when done.</div>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex gap-4">
                <div className="shrink-0 w-7 h-7 rounded-full bg-violet-500/20 border border-violet-500/40 flex items-center justify-center text-xs font-bold text-violet-400">3</div>
                <div>
                  <div className="text-sm font-semibold text-white mb-1">Create a dedicated API user</div>
                  <div className="text-[13px] text-stone-400 leading-relaxed">
                    Create a user specifically for this integration — do not use a personal login. Go to:
                  </div>
                  <div className="mt-2 px-3 py-2 bg-stone-800 rounded-lg font-mono text-[12px] text-violet-300">
                    Company → Admin → Users → Add User
                  </div>
                  <div className="mt-2 space-y-1.5 text-[12px] text-stone-400">
                    {[
                      "Set User Type to Business User",
                      "Tick Web Services only (no UI login needed)",
                      "Set Admin Privileges to Full (or read-only if preferred)",
                      "Grant permissions: AR, AP, Customers, Vendors",
                      "Note the User ID and Password you set",
                    ].map(s => (
                      <div key={s} className="flex items-start gap-2">
                        <CheckCircle size={12} className="text-violet-400 mt-0.5 shrink-0" />
                        <span>{s}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Step 4 */}
              <div className="flex gap-4">
                <div className="shrink-0 w-7 h-7 rounded-full bg-violet-500/20 border border-violet-500/40 flex items-center justify-center text-xs font-bold text-violet-400">4</div>
                <div>
                  <div className="text-sm font-semibold text-white mb-1">Find your Company ID</div>
                  <div className="text-[13px] text-stone-400 leading-relaxed">
                    Your Company ID is shown in the top-right corner of Sage Intacct when logged in, or under:
                  </div>
                  <div className="mt-2 px-3 py-2 bg-stone-800 rounded-lg font-mono text-[12px] text-violet-300">
                    Company → Company Information → Company ID
                  </div>
                </div>
              </div>

              {/* Step 5 */}
              <div className="flex gap-4">
                <div className="shrink-0 w-7 h-7 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-xs font-bold text-emerald-400">5</div>
                <div>
                  <div className="text-sm font-semibold text-white mb-1">Enter credentials here</div>
                  <div className="text-[13px] text-stone-400 leading-relaxed">
                    Come back to this page and click <strong className="text-white">Connect Sage Intacct</strong>. Enter:
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {[
                      { label: "Company ID", value: "Your Sage Company ID" },
                      { label: "User ID",    value: "The API user created in Step 3" },
                      { label: "Password",   value: "That user's password" },
                      { label: "Entity ID",  value: "Leave blank unless multi-entity" },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex items-center gap-2 text-[12px]">
                        <span className="text-stone-500 w-24 shrink-0">{label}:</span>
                        <span className="text-stone-300">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Note */}
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3 text-[12px] text-amber-300 leading-relaxed">
                <strong>Estimated setup time: ~10 minutes.</strong> You only need to do this once. All credentials are encrypted at rest and never shared.
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-stone-800 flex items-center justify-between shrink-0">
              <button onClick={() => setSageInstructionsOpen(false)} className="text-sm text-stone-500 hover:text-stone-300 transition-colors">
                Close
              </button>
              <Button onClick={() => { setSageInstructionsOpen(false); setSageConnectOpen(true); setSageConnectError(null); }}>
                <Database size={14} />
                <span className="ml-1.5">Connect Sage Intacct</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sage connect modal ── */}
      {sageConnectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-stone-900 border border-stone-700 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-6 pt-6 pb-4 border-b border-stone-800">
              <h2 className="text-base font-semibold text-white">Connect Sage Intacct</h2>
              <p className="text-[13px] text-stone-400 mt-1">
                Enter your Sage Intacct Web Services credentials. Use a dedicated API user.
              </p>
            </div>

            <form onSubmit={handleSageConnect} className="px-6 py-5 space-y-4">
              {sageConnectError && (
                <div className="px-3 py-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 leading-relaxed">
                  {sageConnectError}
                </div>
              )}

              {[
                { key: "companyId",  label: "Company ID",  placeholder: "e.g. ACME_Corp", required: true },
                { key: "sageUserId", label: "User ID",     placeholder: "Web services user login", required: true },
                { key: "password",   label: "Password",    placeholder: "User password", required: true, type: "password" },
                { key: "entityId",   label: "Entity ID",   placeholder: "Optional — for multi-entity", required: false },
              ].map(({ key, label, placeholder, required, type }) => (
                <div key={key}>
                  <label className="block text-xs text-stone-400 mb-1.5">
                    {label} {required && <span className="text-rose-400">*</span>}
                  </label>
                  <input
                    type={type || "text"}
                    value={(sageForm as any)[key]}
                    onChange={e => setSageForm(f => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder}
                    required={required}
                    autoComplete={type === "password" ? "current-password" : "off"}
                    className="w-full px-3 py-2 rounded-lg border border-stone-700 bg-stone-800/60 text-sm text-white placeholder-stone-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  />
                </div>
              ))}

              <div className="text-[11px] text-stone-500 leading-relaxed bg-stone-800/40 rounded-lg px-3 py-2">
                Your credentials are encrypted at rest. Sage Intacct requires a
                <strong className="text-stone-400"> Web Services user</strong> with API access enabled
                in your Sage subscription settings.
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setSageConnectOpen(false)}
                  className="flex-1 py-2 rounded-lg border border-stone-700 text-sm text-stone-400 hover:text-white hover:border-stone-500 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sageConnecting}
                  className="flex-1 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-sm font-medium text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {sageConnecting && <Loader size={13} className="animate-spin" />}
                  {sageConnecting ? "Verifying…" : "Connect"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Data Tools */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Database size={16} className="text-stone-400" />
          <h3 className="text-sm font-semibold text-white">Data tools</h3>
        </div>

        <div className="space-y-4">
          {/* Backfill inactive */}
          <div className="pb-4 border-b border-stone-800">
            <div className="text-sm font-medium text-white mb-1">Mark inactive — no open AR</div>
            <div className="text-[12px] text-stone-500 mb-3">
              Marks customers and projects as <strong>Inactive</strong> if they have no open invoices or unapplied credit memos.
              This runs automatically on every QBO sync. Use this to backfill existing records.
            </div>
            <Button size="sm" variant="secondary" onClick={handleBackfillInactive} disabled={backfillingInactive}>
              {backfillingInactive ? (
                <span className="flex items-center gap-2"><Loader size={14} className="animate-spin" />Running…</span>
              ) : (
                <span className="flex items-center gap-2"><RefreshCw size={14} />Mark inactive with no open AR</span>
              )}
            </Button>
            {backfillInactiveResult && (
              <div className="mt-2 bg-emerald-500/10 ring-1 ring-emerald-500/30 rounded-md px-3 py-2 text-sm text-emerald-400 flex items-center gap-2">
                <Check size={14} className="text-emerald-400 shrink-0" />
                <span>
                  Marked <strong>{backfillInactiveResult.customersDeactivated}</strong> customer{backfillInactiveResult.customersDeactivated !== 1 ? "s" : ""} and{" "}
                  <strong>{backfillInactiveResult.projectsDeactivated}</strong> project{backfillInactiveResult.projectsDeactivated !== 1 ? "s" : ""} inactive
                </span>
              </div>
            )}
          </div>

          {/* Fix mislabelled paid invoices */}
          <div className="pb-4 border-b border-stone-800">
            <div className="text-sm font-medium text-white mb-1">Fix payment status — mark fully paid as Paid</div>
            <div className="text-[12px] text-stone-500 mb-3">
              Corrects invoices whose open balance is <strong>zero</strong> but still show as Partially Paid or Unpaid, marking them <strong>Paid</strong> (and Closed). Balance is the source of truth. New syncs now handle this automatically — use this to fix existing records.
            </div>
            <Button size="sm" variant="secondary" onClick={handleFixPaid} disabled={fixingPaid}>
              {fixingPaid ? (
                <span className="flex items-center gap-2"><Loader size={14} className="animate-spin" />Running…</span>
              ) : (
                <span className="flex items-center gap-2"><RefreshCw size={14} />Fix fully-paid invoices</span>
              )}
            </Button>
            {fixPaidResult && (
              <div className="mt-2 bg-emerald-500/10 ring-1 ring-emerald-500/30 rounded-md px-3 py-2 text-sm text-emerald-400 flex items-center gap-2">
                <Check size={14} className="text-emerald-400 shrink-0" />
                <span>Corrected <strong>{fixPaidResult.corrected}</strong> invoice{fixPaidResult.corrected !== 1 ? "s" : ""} to Paid</span>
              </div>
            )}
          </div>

          {/* Tip */}
          <div className="text-[12px] text-stone-400 leading-relaxed">
            More data tools (re-sync, export, field mapping) will appear here as features are added.
          </div>
        </div>
      </Card>
    </div>
  );
}
