"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  Building2, Loader, ExternalLink, RefreshCw, CheckCircle2, AlertTriangle,
  Plus, Pencil, Clock, Zap, Hand, ChevronDown, X, FileText, Ban, Trash2,
  Activity, Wifi, WifiOff, AlertCircle, TrendingUp, Mail, Search, Users2, Blocks,
} from "lucide-react";
import { EditOrgModal } from "../_org-management";
import { Card, Badge, Button, Modal, Toast } from "@/components/ui";
import { fmt } from "@/lib/format";
import { COUNTRIES } from "@/lib/countries";
import { MODULE_KEYS, MODULES, type ModuleKey } from "@/lib/modules";

// ─── types ────────────────────────────────────────────────────────────────────

type Customer = {
  orgId: string; accountId: string | null; accountRef: string | null;
  name: string; email: string | null;
  subId: string | null; stripeSubscriptionId: string | null; stripeCustomerId: string | null;
  hasSub: boolean; source: string | null; status: string;
  isActive: boolean; cancelAtPeriodEnd: boolean;
  planName: string | null; planAmount: number | null; planCurrency: string;
  planInterval: string | null; billing: string; mrr: number; renewsAt: number | null;
  lastPayment: number | null; lastPaymentStatus: string | null; lastPaymentAmount: number | null;
  manualExpiresAt: number | null; manualPaymentStatus: string | null;
  manualInvoiceRef: string | null; manualNotes: string | null;
  billingEmail: string | null; planAmountRaw: number | null;
  enabledModules: string[];
};

type Health = {
  orgId: string; lastLogin: number | null; daysSinceLogin: number | null;
  totalInvoices: number; overdueInvoices: number; paidInvoices: number; arValue: number;
  emails30d: number; emailsTotal: number;
  integrationConnected: boolean; integrationType: string | null;
  integrationStatus: string | null; integrationSyncedAt: number | null;
  lastCronRun: number | null; emailsSentByCron: number;
};

type Row = Customer & { health: Health | null; score: number; tier: Tier };
type Tier = "healthy" | "fair" | "at_risk" | "dormant";
type Tab = "all" | "healthy" | "fair" | "at_risk" | "dormant" | "stripe" | "manual" | "expiring" | "attention" | "no_integration";
type SyncResult = { synced: number; skipped: number; errors: string[] } | null;

// ─── scoring ──────────────────────────────────────────────────────────────────

function scoreHealth(c: Customer, h: Health | null): number {
  let s = 100;
  if (!c.isActive) s -= 30;
  if (c.lastPaymentStatus === "failed" || c.status === "past_due" || c.status === "unpaid") s -= 25;
  if (c.source === "manual" && c.manualPaymentStatus === "overdue") s -= 20;
  if (!h) return Math.max(0, s - 20);
  if (h.daysSinceLogin === null)       s -= 35;
  else if (h.daysSinceLogin > 60)     s -= 30;
  else if (h.daysSinceLogin > 30)     s -= 20;
  else if (h.daysSinceLogin > 14)     s -= 8;
  if (!h.integrationConnected)         s -= 15;
  else if (h.integrationStatus === "error") s -= 8;
  if (h.overdueInvoices / Math.max(h.totalInvoices, 1) > 0.5) s -= 20;
  else if (h.overdueInvoices / Math.max(h.totalInvoices, 1) > 0.2) s -= 10;
  return Math.max(0, Math.min(100, s));
}

function tier(score: number): Tier {
  if (score >= 75) return "healthy";
  if (score >= 50) return "fair";
  if (score >= 25) return "at_risk";
  return "dormant";
}

const TIER_DOT: Record<Tier, string> = {
  healthy: "bg-emerald-400", fair: "bg-amber-400", at_risk: "bg-rose-400", dormant: "bg-stone-500",
};
const TIER_TEXT: Record<Tier, string> = {
  healthy: "text-emerald-300", fair: "text-amber-300", at_risk: "text-rose-300", dormant: "text-stone-400",
};
const TIER_BAR: Record<Tier, string> = {
  healthy: "bg-emerald-500", fair: "bg-amber-500", at_risk: "bg-rose-500", dormant: "bg-stone-600",
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function daysUntilMs(ts: number | null): number | null {
  if (ts === null) return null;
  return Math.ceil((ts - Date.now()) / 86_400_000);
}

function relTime(ts: number | null): { text: string; cls: string } {
  if (!ts) return { text: "Never", cls: "text-stone-600" };
  const d = Math.floor((Date.now() - ts) / 86_400_000);
  if (d === 0) return { text: "Today",     cls: "text-emerald-400" };
  if (d === 1) return { text: "Yesterday", cls: "text-emerald-400" };
  if (d <= 7)  return { text: `${d}d ago`, cls: "text-stone-300" };
  if (d <= 14) return { text: `${d}d ago`, cls: "text-stone-400" };
  if (d <= 30) return { text: `${d}d ago`, cls: "text-amber-400" };
  return { text: `${d}d ago`, cls: "text-rose-400" };
}

function fmtPlan(amount: number | null, currency: string, interval: string | null) {
  if (!amount) return null;
  return fmt.money(amount / 100, currency) + (interval ? `/${interval}` : "");
}

const STRIPE_BADGE: Record<string, string> = {
  active: "green", trialing: "blue", past_due: "red", canceled: "neutral",
  cancelled: "neutral", unpaid: "red", incomplete: "yellow", paused: "neutral",
};
const PAYMENT_BADGE: Record<string, string> = {
  paid: "green", pending: "yellow", overdue: "red", waived: "neutral",
};

function ExpiryCell({ c }: { c: Row }) {
  if (!c.hasSub) return <span className="text-stone-600 text-xs">—</span>;
  if (c.source === "manual") {
    if (!c.manualExpiresAt) return <span className="text-stone-500 text-xs">No expiry</span>;
    const d = daysUntilMs(c.manualExpiresAt);
    const label = new Date(c.manualExpiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    if (d === null || d < 0) return <span className="text-rose-400 text-xs font-medium">{label} (expired)</span>;
    if (d <= 7) return <span className="text-amber-400 text-xs font-medium">{label} ({d}d)</span>;
    return <span className="text-stone-300 text-xs">{label}</span>;
  }
  if (!c.renewsAt) return <span className="text-stone-600 text-xs">—</span>;
  return <span className="text-stone-400 text-xs">{new Date(c.renewsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>;
}

// ─── ExtendDropdown ───────────────────────────────────────────────────────────

function ExtendDropdown({ subId, onDone }: { subId: string; onDone: () => void }) {
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState<number | null>(null);

  const extend = async (days: number) => {
    setLoading(days); setOpen(false);
    await fetch(`/api/admin/subscriptions/${subId}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "extend", days }),
    });
    setLoading(null); onDone();
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} disabled={loading !== null}
        className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-stone-700 text-stone-400 hover:border-stone-500 hover:text-stone-200 transition-colors disabled:opacity-40">
        {loading !== null ? <Loader size={10} className="animate-spin" /> : <Clock size={10} />}
        Extend <ChevronDown size={10} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 bg-stone-900 border border-stone-700 rounded-lg shadow-xl overflow-hidden min-w-[90px]">
            {[30, 60, 90].map(d => (
              <button key={d} onClick={() => extend(d)}
                className="w-full text-left px-3 py-2 text-xs text-stone-300 hover:bg-stone-800 hover:text-white transition-colors">
                +{d} days
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── GrantAccessDropdown ──────────────────────────────────────────────────────
// Proactively grant app access to a customer who is blocked (e.g. Stripe
// payment incomplete). Creates an admin-approved access grant the billing gate
// honours immediately — Stripe billing state is left untouched.
function GrantAccessDropdown({ orgId, onDone }: { orgId: string; onDone: (msg: string, ok: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<number | null>(null);

  const grant = async (days: number) => {
    setLoading(days); setOpen(false);
    const r = await fetch("/api/admin/temp-access", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, daysAccess: days }),
    });
    setLoading(null);
    onDone(r.ok ? "Access granted" : "Could not grant access", r.ok);
  };

  const OPTIONS: { label: string; days: number }[] = [
    { label: "30 days", days: 30 }, { label: "90 days", days: 90 },
    { label: "1 year", days: 365 }, { label: "Comp (10 years)", days: 3650 },
  ];

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} disabled={loading !== null}
        className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-emerald-700/50 text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-40">
        {loading !== null ? <Loader size={10} className="animate-spin" /> : <Clock size={10} />}
        Grant access <ChevronDown size={10} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 bg-stone-900 border border-stone-700 rounded-lg shadow-xl overflow-hidden min-w-[150px]">
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-stone-600 border-b border-stone-800">Grant despite non-payment</div>
            {OPTIONS.map(o => (
              <button key={o.days} onClick={() => grant(o.days)}
                className="w-full text-left px-3 py-2 text-xs text-stone-300 hover:bg-stone-800 hover:text-white transition-colors">
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── ModulesDropdown ──────────────────────────────────────────────────────────
// Which product areas this org can access (Manufacturing, etc.) — see
// lib/modules.ts. Assignment is a platform-admin action, not self-service.
//
// Portaled to <body> and positioned via getBoundingClientRect (same pattern
// as Sidebar's FlyoutGroup) instead of an absolutely-positioned child of the
// table cell — the table wrapper scrolls (overflow-x-auto), which per the
// CSS overflow spec makes its overflow-y compute to auto too, so a plain
// absolute panel on a bottom row got clipped by the table's own bounds with
// no way to scroll it into view. A fixed-position portal is never clipped by
// an ancestor's overflow.
const MODULES_PANEL_WIDTH = 224;
const MODULES_PANEL_EST_HEIGHT = 260;

function ModulesDropdown({ orgId, enabledModules, onDone }: {
  orgId: string; enabledModules: string[]; onDone: (msg: string, ok: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [theme, setTheme] = useState("");
  const [saving, setSaving] = useState<ModuleKey | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const openNow = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const openUpward = window.innerHeight - r.bottom < MODULES_PANEL_EST_HEIGHT;
      setPos({
        left: Math.round(r.right - MODULES_PANEL_WIDTH),
        top: Math.round(openUpward ? r.top - MODULES_PANEL_EST_HEIGHT - 4 : r.bottom + 4),
      });
    }
    setTheme(document.querySelector("[data-theme]")?.getAttribute("data-theme") ?? "");
    setOpen(true);
  };

  const toggle = async (key: ModuleKey, checked: boolean) => {
    const next = checked ? [...new Set([...enabledModules, key])] : enabledModules.filter(k => k !== key);
    setSaving(key);
    const r = await fetch(`/api/admin/organisations/${orgId}/modules`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabledModules: next }),
    });
    const d = await r.json().catch(() => ({}));
    setSaving(null);
    onDone(r.ok ? `${MODULES[key].label} ${checked ? "enabled" : "disabled"}` : (d.error ?? "Failed"), r.ok);
  };

  return (
    <>
      <button ref={btnRef} onClick={() => (open ? setOpen(false) : openNow())}
        className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-stone-700 text-stone-400 hover:border-stone-500 hover:text-stone-200 transition-colors">
        <Blocks size={10} /> {enabledModules.length} <ChevronDown size={10} />
      </button>
      {open && pos && typeof document !== "undefined" && createPortal(
        <div data-theme={theme || undefined}>
          <div className="fixed inset-0 z-[59]" onClick={() => setOpen(false)} />
          <div style={{ position: "fixed", left: pos.left, top: pos.top, width: MODULES_PANEL_WIDTH }}
            className="z-[60] bg-stone-900 border border-stone-700 rounded-lg shadow-2xl shadow-black/50 overflow-hidden">
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-stone-600 border-b border-stone-800">Assign modules</div>
            {MODULE_KEYS.map(key => {
              const meta = MODULES[key];
              const checked = enabledModules.includes(key);
              return (
                <label key={key} className="flex items-start gap-2 px-3 py-2 text-xs text-stone-300 hover:bg-stone-800 cursor-pointer">
                  <input type="checkbox" checked={checked} disabled={saving !== null}
                    onChange={e => toggle(key, e.target.checked)}
                    className="mt-0.5 accent-emerald-500" />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      {meta.label}
                      {meta.core && <span className="text-[9px] uppercase tracking-wide px-1 py-0.5 rounded-full bg-stone-800 text-stone-500">core</span>}
                      {saving === key && <Loader size={9} className="animate-spin text-stone-500" />}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// ─── StripeInvoiceModal ───────────────────────────────────────────────────────

function StripeInvoiceModal({ open, onClose, onDone, onToast }: {
  open: boolean; onClose: () => void; onDone: () => void; onToast: (t: any) => void;
}) {
  const [orgs, setOrgs]         = useState<{ id: string; name: string }[]>([]);
  const [orgId, setOrgId]       = useState("");
  const [mode, setMode]         = useState<"subscription" | "oneoff">("subscription");
  const [billingEmail, setBillingEmail] = useState("");
  const [country, setCountry]   = useState("IE");
  const [stateRegion, setStateRegion] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [currency, setCurrency] = useState("GBP");
  const [daysUntilDue, setDaysUntilDue] = useState("14");
  const [planName, setPlanName] = useState("");
  const [amount, setAmount]     = useState("");
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [coupons, setCoupons]   = useState<{ id: string; name: string }[]>([]);
  const [couponId, setCouponId] = useState("");
  const [items, setItems]       = useState<{ description: string; amount: string }[]>([{ description: "", amount: "" }]);
  const [memo, setMemo]         = useState("");
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState("");
  const [result, setResult]     = useState<any>(null);

  useEffect(() => {
    if (!open) return;
    setErr(""); setResult(null);
    fetch("/api/admin/organisations").then(r => r.ok ? r.json() : [])
      .then(d => setOrgs((Array.isArray(d) ? d : (d?.organisations ?? [])).map((o: any) => ({ id: o.id, name: o.name }))));
    fetch("/api/admin/billing/coupons").then(r => r.ok ? r.json() : { coupons: [] })
      .then(d => setCoupons((d.coupons ?? []).filter((c: any) => c.valid).map((c: any) => ({
        id: c.id,
        name: `${c.name} (${c.percentOff != null ? c.percentOff + "%" : ((c.amountOff ?? 0) / 100).toFixed(2) + " " + (c.currency ?? "")})`,
      })))).catch(() => {});
  }, [open]);

  const setItem = (i: number, k: "description" | "amount", v: string) =>
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it));

  const submit = async () => {
    setErr("");
    if (!orgId) return setErr("Select an organisation");
    if (!billingEmail.trim()) return setErr("Billing email is required");
    if (!country) return setErr("Select the customer's country");
    const payload: any = {
      orgId, mode, billingEmail: billingEmail.trim(),
      currency: currency.toLowerCase(), daysUntilDue: parseInt(daysUntilDue) || 14,
      country, state: stateRegion.trim() || undefined, postalCode: postalCode.trim() || undefined,
    };
    if (mode === "subscription") {
      const cents = Math.round(parseFloat(amount) * 100);
      if (!cents || cents <= 0) return setErr("Enter a valid amount");
      payload.amount = cents; payload.interval = interval;
      payload.planName = planName.trim() || "Custom plan";
      if (couponId) payload.couponId = couponId;
    } else {
      const li = items.filter(it => it.description.trim() && parseFloat(it.amount) > 0)
        .map(it => ({ description: it.description.trim(), amount: Math.round(parseFloat(it.amount) * 100) }));
      if (li.length === 0) return setErr("Add at least one line item");
      payload.lineItems = li; payload.memo = memo.trim() || undefined;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/admin/billing/create-invoice", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || `Failed (${r.status})`); return; }
      setResult(d);
      onToast({ type: "success", message: mode === "subscription" ? "First invoice created" : "Invoice created & sent" });
      onDone();
    } catch (e: any) { setErr(e?.message || "Network error"); } finally { setSaving(false); }
  };

  const CURRENCIES = ["GBP", "EUR", "USD", "AUD", "CAD", "NZD", "CHF", "AED", "INR", "SGD", "ZAR"];
  const inp = "px-3 py-2 rounded-lg border border-stone-700 bg-stone-800/60 text-sm text-white placeholder-stone-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500";
  const lbl = "text-xs text-stone-400 block mb-1.5";
  const oneOffTotal = items.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);
  const symbol = ({ GBP: "£", EUR: "€", USD: "$", AUD: "$", CAD: "$", NZD: "$", INR: "₹" } as Record<string, string>)[currency] ?? "";

  return (
    <Modal open={open} onClose={onClose} title="Create Stripe invoice"
      footer={result ? (
        <Button variant="primary" onClick={() => { setResult(null); onClose(); }}>Done</Button>
      ) : (
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={saving}>
            {saving && <Loader size={13} className="animate-spin mr-1" />}
            {saving ? "Creating…" : "Create & send invoice"}
          </Button>
        </>
      )}>
      {result ? (
        <div className="px-5 py-6 space-y-4">
          <div className="flex items-center gap-2.5 text-emerald-300">
            <div className="w-9 h-9 rounded-full bg-emerald-500/15 flex items-center justify-center"><CheckCircle2 size={18} /></div>
            <div>
              <p className="text-sm font-medium text-white">{result.recurring ? "First invoice ready to share" : "Invoice created & emailed"}</p>
              <p className="text-xs text-stone-400">{result.recurring ? "Share the link below to collect the first payment." : <>Status: <span className="text-stone-200 capitalize">{result.status}</span></>}</p>
            </div>
          </div>
          {result.hostedInvoiceUrl && (
            <a href={result.hostedInvoiceUrl} target="_blank" rel="noreferrer"
               className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-sky-500/30 bg-sky-500/10 text-sm text-sky-300 hover:bg-sky-500/15 transition-colors">
              <span className="flex items-center gap-2"><ExternalLink size={14} /> Open / copy invoice link</span>
              <span className="text-[11px] text-sky-400/70">opens Stripe</span>
            </a>
          )}
        </div>
      ) : (
        <div className="px-5 py-5 space-y-4">
          <div>
            <label className={lbl}>Organisation <span className="text-rose-400">*</span></label>
            <select value={orgId} onChange={e => setOrgId(e.target.value)} className={inp + " w-full"}>
              <option value="">Select…</option>
              {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Billing email <span className="text-rose-400">*</span></label>
            <input type="email" value={billingEmail} onChange={e => setBillingEmail(e.target.value)} placeholder="finance@client.com" className={inp + " w-full"} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <label className={lbl}>Country <span className="text-rose-400">*</span></label>
              <select value={country} onChange={e => setCountry(e.target.value)} className={inp + " w-full"}>
                {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </div>
            <div><label className={lbl}>State / region</label><input value={stateRegion} onChange={e => setStateRegion(e.target.value)} placeholder="optional" className={inp + " w-full"} /></div>
            <div><label className={lbl}>Postal code</label><input value={postalCode} onChange={e => setPostalCode(e.target.value)} placeholder="optional" className={inp + " w-full"} /></div>
          </div>
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-stone-800/60 rounded-lg">
            {([["subscription", "Recurring"], ["oneoff", "One-off invoice"]] as const).map(([m, l]) => (
              <button key={m} onClick={() => setMode(m)}
                className={`h-8 text-xs font-medium rounded-md transition-all ${mode === m ? "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/40" : "text-stone-400 hover:text-stone-200"}`}>
                {l}
              </button>
            ))}
          </div>
          {mode === "subscription" ? (
            <>
              <div><label className={lbl}>Plan name</label><input value={planName} onChange={e => setPlanName(e.target.value)} placeholder="e.g. AR Automation — Pro" className={inp + " w-full"} /></div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={lbl}>Amount</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-stone-500">{symbol}</span>
                    <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="499.00" inputMode="decimal" className={inp + ` w-full ${symbol ? "pl-7" : ""}`} />
                  </div>
                </div>
                <div><label className={lbl}>Currency</label><select value={currency} onChange={e => setCurrency(e.target.value)} className={inp + " w-full"}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></div>
                <div><label className={lbl}>Billing cycle</label><select value={interval} onChange={e => setInterval(e.target.value as any)} className={inp + " w-full"}><option value="month">Monthly</option><option value="year">Yearly</option></select></div>
              </div>
              {coupons.length > 0 && (
                <div><label className={lbl}>Discount <span className="text-stone-600">(optional)</span></label>
                <select value={couponId} onChange={e => setCouponId(e.target.value)} className={inp + " w-full"}>
                  <option value="">No discount</option>
                  {coupons.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></div>
              )}
            </>
          ) : (
            <>
              <div>
                <label className={lbl}>Line items</label>
                <div className="space-y-2">
                  {items.map((it, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input value={it.description} onChange={e => setItem(i, "description", e.target.value)} placeholder="Description" className={inp + " flex-1 min-w-0"} />
                      <div className="relative w-32 shrink-0">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-stone-500">{symbol}</span>
                        <input value={it.amount} onChange={e => setItem(i, "amount", e.target.value)} placeholder="0.00" inputMode="decimal" className={inp + ` w-full text-right ${symbol ? "pl-7" : ""}`} />
                      </div>
                      <button onClick={() => setItems(items.length > 1 ? items.filter((_, idx) => idx !== i) : items)} disabled={items.length === 1} className="text-stone-600 hover:text-rose-400 p-1.5 disabled:opacity-30"><X size={14} /></button>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-2">
                  <button onClick={() => setItems([...items, { description: "", amount: "" }])} className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1"><Plus size={12} /> Add line</button>
                  <span className="text-xs text-stone-400">Total <span className="text-white font-medium tabular-nums">{symbol}{oneOffTotal.toFixed(2)}</span></span>
                </div>
              </div>
              <div><label className={lbl}>Currency</label><select value={currency} onChange={e => setCurrency(e.target.value)} className={inp + " w-full"}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></div>
              <div><label className={lbl}>Memo <span className="text-stone-600">(optional)</span></label><input value={memo} onChange={e => setMemo(e.target.value)} placeholder="Shown on the invoice" className={inp + " w-full"} /></div>
            </>
          )}
          <div>
            <label className={lbl}>Payment terms</label>
            <div className="flex items-center gap-2">
              <input value={daysUntilDue} onChange={e => setDaysUntilDue(e.target.value)} inputMode="numeric" className={inp + " w-20 text-center"} />
              <span className="text-xs text-stone-500">days until due</span>
            </div>
          </div>
          {err && <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">{err}</div>}
        </div>
      )}
    </Modal>
  );
}

// ─── ManualModal ──────────────────────────────────────────────────────────────

function ManualModal({ open, onClose, onSaved, existing }: {
  open: boolean; onClose: () => void; onSaved: () => void; existing?: Row | null;
}) {
  const [orgs, setOrgs]           = useState<{ id: string; name: string }[]>([]);
  const [orgId, setOrgId]         = useState(existing?.orgId ?? "");
  const [planName, setPlanName]   = useState(existing?.planName ?? "");
  const [amount, setAmount]       = useState(existing?.planAmountRaw != null ? String(existing.planAmountRaw / 100) : "");
  const [currency, setCurrency]   = useState(existing?.planCurrency?.toUpperCase() ?? "GBP");
  const [interval, setInterval]   = useState(existing?.planInterval ?? "month");
  const [noExpiry, setNoExpiry]   = useState(!existing?.manualExpiresAt);
  const [expiresAt, setExpiresAt] = useState(existing?.manualExpiresAt ? new Date(existing.manualExpiresAt).toISOString().slice(0, 10) : "");
  const [payStatus, setPayStatus] = useState<string>(existing?.manualPaymentStatus ?? "paid");
  const [invoiceRef, setInvoiceRef] = useState(existing?.manualInvoiceRef ?? "");
  const [notes, setNotes]         = useState(existing?.manualNotes ?? "");
  const [billingEmail, setBillingEmail] = useState(existing?.billingEmail ?? "");
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState("");

  useEffect(() => {
    if (!open || existing) return;
    fetch("/api/admin/organisations").then(r => r.ok ? r.json() : [])
      .then(d => setOrgs((Array.isArray(d) ? d : (d?.organisations ?? [])).filter((o: any) => !o.subId).map((o: any) => ({ id: o.id, name: o.name }))));
  }, [open, existing]);

  const handleSubmit = async () => {
    setErr("");
    if (!existing && !orgId) { setErr("Select an organisation"); return; }
    if (!planName.trim()) { setErr("Plan name is required"); return; }
    setSaving(true);
    try {
      const payload: any = {
        planName, amount: amount ? Math.round(parseFloat(amount) * 100) : undefined,
        currency: currency || undefined, interval: interval || undefined,
        expiresAt: noExpiry ? null : (expiresAt ? new Date(expiresAt).toISOString() : null),
        paymentStatus: payStatus, invoiceRef: invoiceRef || undefined,
        notes: notes || undefined, billingEmail: billingEmail || undefined,
      };
      let url: string; let method: string;
      if (existing?.subId) { url = `/api/admin/subscriptions/${existing.subId}`; method = "PATCH"; payload.action = "update"; }
      else { url = "/api/admin/subscriptions/manual"; method = "POST"; payload.orgId = orgId; }
      const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (r.ok) { onSaved(); onClose(); }
      else { const d = await r.json().catch(() => ({})); setErr(d.error ?? "Failed to save"); }
    } finally { setSaving(false); }
  };

  const inp = "w-full px-3 py-2 rounded-lg border border-stone-700 bg-stone-800/60 text-sm text-white placeholder-stone-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

  return (
    <Modal open={open} onClose={onClose} title={existing ? "Edit subscription" : "Add manual subscription"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} disabled={saving}>
            {saving && <Loader size={13} className="animate-spin mr-1" />}
            {existing ? "Save changes" : "Create"}
          </Button>
        </>
      }>
      <div className="px-5 py-5 space-y-4">
        {err && <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">{err}</div>}
        {!existing && (
          <div>
            <label className="text-xs text-stone-400 block mb-1.5">Organisation <span className="text-rose-400">*</span></label>
            {orgs.length === 0
              ? <div className="px-3 py-2.5 rounded-lg border border-stone-700 bg-stone-800/40 text-xs text-stone-400">All organisations already have a subscription.</div>
              : <select value={orgId} onChange={e => setOrgId(e.target.value)} className={inp}><option value="">Select…</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}
          </div>
        )}
        <div><label className="text-xs text-stone-400 block mb-1.5">Plan name <span className="text-rose-400">*</span></label><input value={planName} onChange={e => setPlanName(e.target.value)} placeholder="e.g. Annual Pro" className={inp} /></div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="text-xs text-stone-400 block mb-1.5">Amount</label><input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className={inp} /></div>
          <div><label className="text-xs text-stone-400 block mb-1.5">Currency</label><select value={currency} onChange={e => setCurrency(e.target.value)} className={inp}>{["GBP","USD","EUR","AUD","CAD"].map(c => <option key={c}>{c}</option>)}</select></div>
          <div><label className="text-xs text-stone-400 block mb-1.5">Cycle</label><select value={interval} onChange={e => setInterval(e.target.value)} className={inp}><option value="month">Monthly</option><option value="year">Annual</option><option value="custom">Custom</option></select></div>
        </div>
        <div>
          <label className="text-xs text-stone-400 block mb-1.5">Access until</label>
          <label className="flex items-center gap-2 cursor-pointer mb-2"><input type="checkbox" checked={noExpiry} onChange={e => setNoExpiry(e.target.checked)} className="accent-emerald-500" /><span className="text-xs text-stone-300">No expiry</span></label>
          {!noExpiry && <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} className={inp} />}
        </div>
        <div>
          <label className="text-xs text-stone-400 block mb-1.5">Payment status</label>
          <div className="flex gap-2 flex-wrap">
            {(["paid","pending","overdue","waived"] as const).map(s => (
              <button key={s} onClick={() => setPayStatus(s)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border capitalize transition-all ${payStatus === s
                  ? s === "paid" ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                  : s === "overdue" ? "bg-rose-500/15 border-rose-500/40 text-rose-300"
                  : s === "pending" ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                  : "bg-stone-700 border-stone-600 text-stone-300"
                  : "border-stone-700 text-stone-400 hover:border-stone-600"}`}>{s}</button>
            ))}
          </div>
        </div>
        <div><label className="text-xs text-stone-400 block mb-1.5">Invoice ref <span className="text-stone-600">(optional)</span></label><input value={invoiceRef} onChange={e => setInvoiceRef(e.target.value)} placeholder="INV-2024-001" className={inp} /></div>
        <div><label className="text-xs text-stone-400 block mb-1.5">Billing email <span className="text-stone-600">(optional)</span></label><input type="email" value={billingEmail} onChange={e => setBillingEmail(e.target.value)} placeholder="accounts@client.com" className={inp} /></div>
        <div><label className="text-xs text-stone-400 block mb-1.5">Notes <span className="text-stone-600">(optional)</span></label><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} maxLength={1000} className={inp + " resize-none"} /></div>
      </div>
    </Modal>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CustomersPage() {
  const [rows, setRows]             = useState<Row[]>([]);
  const [summary, setSummary]       = useState<any>(null);
  const [loading, setLoading]       = useState(true);
  const [syncing, setSyncing]       = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult>(null);
  const [tab, setTab]               = useState<Tab>("all");
  const [search, setSearch]         = useState("");
  const [showInvoice, setShowInvoice] = useState(false);
  const [showAdd, setShowAdd]       = useState(false);
  const [editing, setEditing]       = useState<Row | null>(null);
  const [editOrg, setEditOrg]       = useState<any>(null);
  const [toast, setToast]           = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleting, setDeleting]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [custRes, healthRes] = await Promise.all([
        fetch("/api/admin/customers"),
        fetch("/api/admin/customers/health"),
      ]);
      const custData   = custRes.ok   ? await custRes.json()   : {};
      const healthData = healthRes.ok ? await healthRes.json() : {};
      const customers: Customer[] = custData.customers ?? [];
      const healthList: Health[]  = Array.isArray(healthData) ? healthData : (healthData.customers ?? []);
      const healthMap = new Map(healthList.map((h: Health) => [h.orgId, h]));
      const merged: Row[] = customers.map(c => {
        const h = healthMap.get(c.orgId) ?? null;
        const s = scoreHealth(c, h);
        return { ...c, health: h, score: s, tier: tier(s) };
      });
      setRows(merged);
      setSummary(custData.summary ?? null);
    } catch (e: any) {
      setToast({ type: "error", message: e?.message ?? "Failed to load" });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSyncAll = async () => {
    setSyncing(true); setSyncResult(null);
    try {
      const r = await fetch("/api/admin/subscriptions/sync", { method: "POST" });
      const d = await r.json();
      setSyncResult(d);
      if (r.ok) await load();
    } catch { setSyncResult({ synced: 0, skipped: 0, errors: ["Network error"] }); }
    finally { setSyncing(false); }
  };

  const cancelStripe = async (c: Row) => {
    if (!confirm(`Cancel ${c.name}'s Stripe subscription and revoke access? This cannot be undone.`)) return;
    const r = await fetch(`/api/admin/subscriptions/${c.subId}/cancel`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ atPeriodEnd: false }),
    });
    const d = await r.json();
    if (r.ok) { setToast({ type: "success", message: "Subscription cancelled" }); load(); }
    else setToast({ type: "error", message: d.error ?? "Cancel failed" });
  };

  const markPaid = async (c: Row) => {
    if (!c.subId) return;
    const r = await fetch(`/api/admin/subscriptions/${c.subId}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "mark_paid" }),
    });
    if (r.ok) { setToast({ type: "success", message: "Marked as paid" }); load(); }
    else setToast({ type: "error", message: "Action failed" });
  };

  const deleteOrg = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/admin/organisations/${deleteTarget.orgId}`, { method: "DELETE" });
      const d = await r.json();
      if (r.ok) {
        setToast({ type: "success", message: `"${deleteTarget.name}" deleted — all data removed.` });
        setDeleteTarget(null); setDeleteConfirmName(""); load();
      } else setToast({ type: "error", message: d.error ?? "Delete failed" });
    } catch (e: any) { setToast({ type: "error", message: e?.message ?? "Network error" }); }
    finally { setDeleting(false); }
  };

  // ── derived ──
  const healthCounts = {
    healthy: rows.filter(r => r.tier === "healthy").length,
    fair:    rows.filter(r => r.tier === "fair").length,
    at_risk: rows.filter(r => r.tier === "at_risk").length,
    dormant: rows.filter(r => r.tier === "dormant").length,
  };
  const expiringCount  = rows.filter(c => { if (c.source !== "manual" || !c.manualExpiresAt) return false; const d = daysUntilMs(c.manualExpiresAt); return d !== null && d >= 0 && d <= 7; }).length;
  const attentionCount = rows.filter(c => c.status === "past_due" || c.status === "unpaid" || c.manualPaymentStatus === "overdue").length;
  const noIntCount     = rows.filter(c => !c.health?.integrationConnected).length;
  const totalMrr       = summary?.totalMrr ?? 0;
  const mrrCurrency    = summary?.currency ?? "GBP";

  // ── filter ──
  const filtered = rows.filter(c => {
    const q = search.toLowerCase();
    if (q && !c.name.toLowerCase().includes(q) && !(c.email ?? "").toLowerCase().includes(q) && !(c.accountRef ?? "").toLowerCase().includes(q)) return false;
    if (tab === "healthy")        return c.tier === "healthy";
    if (tab === "fair")           return c.tier === "fair";
    if (tab === "at_risk")        return c.tier === "at_risk";
    if (tab === "dormant")        return c.tier === "dormant";
    if (tab === "stripe")         return c.source === "stripe";
    if (tab === "manual")         return c.source === "manual";
    if (tab === "expiring") { if (c.source !== "manual" || !c.manualExpiresAt) return false; const d = daysUntilMs(c.manualExpiresAt); return d !== null && d >= 0 && d <= 7; }
    if (tab === "attention")      return c.status === "past_due" || c.status === "unpaid" || c.manualPaymentStatus === "overdue";
    if (tab === "no_integration") return !c.health?.integrationConnected;
    return true;
  });

  const tabs: { key: Tab; label: string; count: number; warn?: boolean }[] = [
    { key: "all",            label: "All",              count: rows.length },
    { key: "healthy",        label: "Healthy",          count: healthCounts.healthy },
    { key: "fair",           label: "Fair",             count: healthCounts.fair },
    { key: "at_risk",        label: "At risk",          count: healthCounts.at_risk,  warn: healthCounts.at_risk > 0 },
    { key: "dormant",        label: "Dormant",          count: healthCounts.dormant,  warn: healthCounts.dormant > 0 },
    { key: "stripe",         label: "Stripe",           count: rows.filter(r => r.source === "stripe").length },
    { key: "manual",         label: "Manual",           count: rows.filter(r => r.source === "manual").length },
    { key: "expiring",       label: "Expiring soon",    count: expiringCount,         warn: expiringCount > 0 },
    { key: "attention",      label: "Needs attention",  count: attentionCount,        warn: attentionCount > 0 },
    { key: "no_integration", label: "No integration",   count: noIntCount },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-base font-semibold text-white">Customers</h1>
          <p className="text-xs text-stone-500 mt-0.5">Unified billing & health workspace — all organisations in one view</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={load} disabled={loading || syncing}
            className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-200 transition-colors disabled:opacity-40">
            <Loader size={12} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button onClick={handleSyncAll} disabled={syncing || loading}
            className="flex items-center gap-2 h-8 px-3 text-xs font-medium rounded-lg border border-stone-700 bg-stone-800/50 text-stone-300 hover:bg-stone-700 hover:text-white disabled:opacity-40 transition-all">
            <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Syncing…" : "Sync Stripe"}
          </button>
          <button onClick={() => setShowInvoice(true)}
            className="flex items-center gap-2 h-8 px-3 text-xs font-medium rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors">
            <FileText size={13} /> Create invoice
          </button>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 h-8 px-3 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors">
            <Plus size={13} /> Add manual
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-6 gap-3">
        <div className="p-3 rounded-xl border border-stone-800 bg-stone-900/50">
          <div className="flex items-center justify-between mb-1"><span className="text-[11px] text-stone-500">Total orgs</span><Building2 size={13} className="text-stone-600" /></div>
          <p className="text-xl font-semibold text-white">{summary?.total ?? rows.length}</p>
        </div>
        <div className="p-3 rounded-xl border border-stone-800 bg-stone-900/50">
          <div className="flex items-center justify-between mb-1"><span className="text-[11px] text-stone-500">Stripe active</span><Zap size={13} className="text-blue-400" /></div>
          <p className="text-xl font-semibold text-white">{summary?.stripeActive ?? 0}</p>
        </div>
        <div className="p-3 rounded-xl border border-stone-800 bg-stone-900/50">
          <div className="flex items-center justify-between mb-1"><span className="text-[11px] text-stone-500">Manual active</span><Hand size={13} className="text-emerald-400" /></div>
          <p className="text-xl font-semibold text-white">{summary?.manualActive ?? 0}</p>
        </div>
        <div className={`p-3 rounded-xl border ${(healthCounts.at_risk + healthCounts.dormant) > 0 ? "border-rose-500/30 bg-rose-500/5" : "border-stone-800 bg-stone-900/50"}`}>
          <div className="flex items-center justify-between mb-1"><span className="text-[11px] text-stone-500">At risk / dormant</span><AlertCircle size={13} className={(healthCounts.at_risk + healthCounts.dormant) > 0 ? "text-rose-400" : "text-stone-600"} /></div>
          <p className={`text-xl font-semibold ${(healthCounts.at_risk + healthCounts.dormant) > 0 ? "text-rose-300" : "text-white"}`}>{healthCounts.at_risk + healthCounts.dormant}</p>
        </div>
        <div className={`p-3 rounded-xl border ${expiringCount > 0 ? "border-amber-500/30 bg-amber-500/5" : "border-stone-800 bg-stone-900/50"}`}>
          <div className="flex items-center justify-between mb-1"><span className="text-[11px] text-stone-500">Expiring ≤7d</span><Clock size={13} className={expiringCount > 0 ? "text-amber-400" : "text-stone-600"} /></div>
          <p className={`text-xl font-semibold ${expiringCount > 0 ? "text-amber-300" : "text-white"}`}>{expiringCount}</p>
        </div>
        <div className="p-3 rounded-xl border border-stone-800 bg-stone-900/50">
          <div className="flex items-center justify-between mb-1"><span className="text-[11px] text-stone-500">Total MRR</span><TrendingUp size={13} className="text-violet-400" /></div>
          <p className="text-xl font-semibold text-white tabular-nums">{totalMrr > 0 ? fmt.money(totalMrr, mrrCurrency) : "—"}</p>
        </div>
      </div>

      {/* Sync banner */}
      {syncResult && (
        <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border text-sm ${syncResult.errors.length ? "border-amber-500/30 bg-amber-500/10 text-amber-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"}`}>
          {syncResult.errors.length ? <AlertTriangle size={15} className="text-amber-400 mt-0.5 shrink-0" /> : <CheckCircle2 size={15} className="text-emerald-400 mt-0.5 shrink-0" />}
          <div className="flex-1 min-w-0">
            <p className="font-medium">Sync complete — {syncResult.synced} updated, {syncResult.skipped} skipped{syncResult.errors.length > 0 && `, ${syncResult.errors.length} error${syncResult.errors.length !== 1 ? "s" : ""}`}</p>
            {syncResult.errors.length > 0 && <ul className="mt-1 text-[11px] text-amber-400/80 space-y-0.5">{syncResult.errors.slice(0, 5).map((e, i) => <li key={i}>· {e}</li>)}</ul>}
          </div>
          <button onClick={() => setSyncResult(null)} className="text-stone-500 hover:text-stone-300 ml-2 shrink-0"><X size={14} /></button>
        </div>
      )}

      {/* Tabs + search bar */}
      <div className="flex items-center gap-3">
        <div className="flex gap-0.5 border-b border-stone-800 flex-1 overflow-x-auto">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${tab === t.key ? "border-violet-500 text-white" : "border-transparent text-stone-500 hover:text-stone-300"}`}>
              {t.label}
              {t.count > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${t.warn ? "bg-rose-500/20 text-rose-300" : "bg-stone-800 text-stone-400"}`}>{t.count}</span>
              )}
            </button>
          ))}
        </div>
        <div className="relative shrink-0">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-600" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
            className="h-8 w-44 pl-8 pr-3 rounded-lg border border-stone-700 bg-stone-800/50 text-xs text-stone-200 placeholder-stone-600 focus:border-stone-500 focus:outline-none" />
          {search && <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-600 hover:text-stone-400"><X size={12} /></button>}
        </div>
      </div>

      {/* Table */}
      <Card padding="none">
        {loading ? (
          <div className="p-5 space-y-3">{[1,2,3,4,5].map(i => <div key={i} className="h-12 bg-stone-800 rounded animate-pulse" />)}</div>
        ) : !filtered.length ? (
          <div className="py-16 text-center">
            <Building2 size={28} className="text-stone-600 mx-auto mb-3" />
            <p className="text-sm text-stone-500">{search ? "No customers match your search" : "No customers in this view"}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1100px]">
              <thead>
                <tr className="border-b border-stone-800">
                  {["Customer", "Plan", "Status & Health", "Activity", "Automations", "MRR / Expiry", "Modules", "Actions"].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-[11px] text-stone-500 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const isManual       = c.source === "manual";
                  const h              = c.health;
                  const loginRel       = relTime(h?.lastLogin ?? null);
                  const isExpiringSoon = isManual && (() => { const d = daysUntilMs(c.manualExpiresAt); return d !== null && d >= 0 && d <= 7; })();
                  const isOverdue      = c.status === "past_due" || c.status === "unpaid" || c.manualPaymentStatus === "overdue";

                  return (
                    <tr key={c.orgId}
                      className={`border-b border-stone-800/50 hover:bg-stone-800/20 transition-colors ${isExpiringSoon ? "bg-amber-500/3" : isOverdue ? "bg-rose-500/3" : ""}`}>

                      {/* Customer */}
                      <td className="px-4 py-3">
                        <Link href={`/admin/customers/${c.orgId}`}
                          className="text-white text-xs font-semibold hover:text-violet-300 transition-colors block leading-tight">
                          {c.name}
                        </Link>
                        {c.email && <p className="text-[11px] text-stone-500 truncate max-w-[160px]">{c.email}</p>}
                        <div className="mt-0.5">
                          {c.accountRef
                            ? <span className="font-mono text-[10px] text-violet-400/70 bg-violet-500/10 px-1.5 py-0.5 rounded">{c.accountRef}</span>
                            : <span className="font-mono text-[10px] text-stone-700" title={c.orgId}>{c.orgId.slice(0, 8)}…</span>
                          }
                        </div>
                      </td>

                      {/* Plan */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          {isManual ? (
                            <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full border border-stone-600 bg-stone-800 text-stone-400 font-medium">
                              <Hand size={8} /> Manual
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-300 font-medium">
                              <Zap size={8} /> Stripe
                            </span>
                          )}
                          {c.cancelAtPeriodEnd && <span className="text-[10px] text-amber-400">cancels</span>}
                        </div>
                        {c.planName ? (
                          <>
                            <p className="text-stone-200 text-xs font-medium truncate max-w-[140px]">{c.planName}</p>
                            {fmtPlan(c.planAmount, c.planCurrency, c.planInterval) && (
                              <p className="text-[11px] text-stone-500">{fmtPlan(c.planAmount, c.planCurrency, c.planInterval)}</p>
                            )}
                          </>
                        ) : <span className="text-stone-600 text-xs">No plan</span>}
                        {isManual && c.manualInvoiceRef && <p className="text-[10px] text-stone-600 font-mono">{c.manualInvoiceRef}</p>}
                      </td>

                      {/* Status & Health */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                          {!c.hasSub
                            ? <Badge variant="neutral" size="sm">No sub</Badge>
                            : isManual
                              ? (() => { const d = daysUntilMs(c.manualExpiresAt); return (!c.manualExpiresAt || (d !== null && d > 0)) ? <Badge variant="green" size="sm">Active</Badge> : <Badge variant="neutral" size="sm">Expired</Badge>; })()
                              : <Badge variant={(STRIPE_BADGE[c.status] ?? "neutral") as any} size="sm">{c.status}</Badge>
                          }
                          {isManual && c.manualPaymentStatus && c.manualPaymentStatus !== "paid" && (
                            <Badge variant={(PAYMENT_BADGE[c.manualPaymentStatus] ?? "neutral") as any} size="sm">{c.manualPaymentStatus}</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${TIER_DOT[c.tier]}`} />
                          <div className="flex-1 h-1 bg-stone-800 rounded-full overflow-hidden w-16">
                            <div className={`h-full rounded-full ${TIER_BAR[c.tier]}`} style={{ width: `${c.score}%` }} />
                          </div>
                          <span className={`text-[10px] font-medium tabular-nums ${TIER_TEXT[c.tier]}`}>{c.score}</span>
                        </div>
                      </td>

                      {/* Activity */}
                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <Activity size={11} className="text-stone-600 shrink-0" />
                            <span className={`text-[11px] ${loginRel.cls}`}>{loginRel.text}</span>
                          </div>
                          {h?.integrationConnected ? (
                            <div className="flex items-center gap-1.5">
                              <Wifi size={11} className="text-emerald-500 shrink-0" />
                              <span className="text-[11px] text-stone-400 capitalize">{h.integrationType ?? "Connected"}</span>
                              {h.integrationStatus === "error" && <AlertCircle size={10} className="text-rose-400" />}
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <WifiOff size={11} className="text-stone-600 shrink-0" />
                              <span className="text-[11px] text-stone-600">No integration</span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Automations */}
                      <td className="px-4 py-3">
                        {h ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <Mail size={11} className="text-stone-600 shrink-0" />
                              <span className="text-[11px] text-stone-300 tabular-nums">{h.emails30d} <span className="text-stone-600">30d</span></span>
                            </div>
                            <div className="text-[11px] text-stone-600 tabular-nums pl-[19px]">{h.emailsTotal} total</div>
                          </div>
                        ) : <span className="text-stone-600 text-xs">—</span>}
                      </td>

                      {/* MRR / Expiry */}
                      <td className="px-4 py-3">
                        <p className="text-xs font-medium text-white tabular-nums">
                          {c.mrr > 0 ? fmt.money(c.mrr, c.planCurrency) + "/mo" : "—"}
                        </p>
                        <div className="mt-0.5"><ExpiryCell c={c} /></div>
                      </td>

                      {/* Modules */}
                      <td className="px-4 py-3">
                        <ModulesDropdown orgId={c.orgId} enabledModules={c.enabledModules}
                          onDone={(message, ok) => { if (ok) load(); setToast({ type: ok ? "success" : "error", message }); }} />
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 flex-wrap">
                          <Link href={`/admin/invoices?org=${c.orgId}`}
                            className="flex items-center gap-0.5 text-[11px] px-2 py-1 rounded border border-stone-700 text-stone-400 hover:border-stone-500 hover:text-stone-200 transition-colors">
                            <FileText size={10} /> Invoices
                          </Link>
                          <button onClick={() => setEditOrg({ id: c.orgId, name: c.name, slug: "", email: c.email })}
                            className="flex items-center gap-0.5 text-[11px] px-2 py-1 rounded border border-stone-700 text-stone-400 hover:border-stone-500 hover:text-stone-200 transition-colors" title="Manage users & organisation">
                            <Users2 size={10} /> Users
                          </button>

                          {isManual && c.subId && (
                            <>
                              <ExtendDropdown subId={c.subId} onDone={() => { load(); setToast({ type: "success", message: "Access extended" }); }} />
                              {c.manualPaymentStatus !== "paid" && (
                                <button onClick={() => markPaid(c)}
                                  className="text-[11px] px-2 py-1 rounded border border-emerald-700/50 text-emerald-400 hover:bg-emerald-500/10 transition-colors">
                                  Mark paid
                                </button>
                              )}
                              <button onClick={() => setEditing(c)} className="text-stone-500 hover:text-stone-300 p-1 transition-colors" title="Edit manual subscription"><Pencil size={12} /></button>
                            </>
                          )}

                          {!isManual && c.hasSub && !c.isActive && (
                            <GrantAccessDropdown orgId={c.orgId} onDone={(message, ok) => { if (ok) load(); setToast({ type: ok ? "success" : "error", message }); }} />
                          )}

                          {!isManual && c.stripeCustomerId && (
                            <a href={`https://dashboard.stripe.com/customers/${c.stripeCustomerId}`} target="_blank" rel="noopener noreferrer"
                              className="text-stone-500 hover:text-sky-400 transition-colors p-1" title="Open in Stripe">
                              <ExternalLink size={12} />
                            </a>
                          )}
                          {!isManual && c.subId && (c.status === "active" || c.status === "trialing" || c.status === "past_due") && (
                            <button onClick={() => cancelStripe(c)}
                              className="flex items-center gap-0.5 text-[11px] px-2 py-1 rounded border border-rose-700/50 text-rose-400 hover:bg-rose-500/10 transition-colors">
                              <Ban size={10} /> Cancel
                            </button>
                          )}

                          <button onClick={() => { setDeleteTarget(c); setDeleteConfirmName(""); }}
                            className="text-stone-600 hover:text-rose-400 p-1 transition-colors" title="Delete organisation">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Footer bar */}
      {!loading && rows.length > 0 && (
        <div className="flex items-center gap-4 text-[11px] text-stone-600">
          <span>{filtered.length} of {rows.length} organisations</span>
          <span>·</span>
          <span>{rows.filter(r => r.isActive).length} active subscriptions</span>
          <span>·</span>
          <span>{rows.filter(r => r.health?.integrationConnected).length} integrated</span>
          {totalMrr > 0 && <><span>·</span><span className="text-stone-400">{fmt.money(totalMrr, mrrCurrency)}/mo MRR</span></>}
        </div>
      )}

      {/* Modals */}
      <StripeInvoiceModal open={showInvoice} onClose={() => setShowInvoice(false)} onDone={load} onToast={t => setToast(t)} />

      <ManualModal open={showAdd} onClose={() => setShowAdd(false)}
        onSaved={() => { load(); setToast({ type: "success", message: "Manual subscription created" }); }} />

      {editing && (
        <ManualModal open={!!editing} onClose={() => setEditing(null)} existing={editing}
          onSaved={() => { load(); setToast({ type: "success", message: "Subscription updated" }); }} />
      )}

      {editOrg && (
        <EditOrgModal org={editOrg} onClose={() => setEditOrg(null)} onSaved={() => load()} />
      )}

      {deleteTarget && (
        <Modal open={!!deleteTarget} onClose={() => { setDeleteTarget(null); setDeleteConfirmName(""); }}
          title="Delete organisation"
          footer={
            <>
              <Button variant="secondary" onClick={() => { setDeleteTarget(null); setDeleteConfirmName(""); }}>Cancel</Button>
              <button onClick={deleteOrg} disabled={deleting || deleteConfirmName !== deleteTarget.name}
                className="flex items-center gap-1.5 h-9 px-4 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                {deleting && <Loader size={12} className="animate-spin" />}
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
            </>
          }>
          <div className="px-5 py-5 space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20">
              <AlertTriangle size={16} className="text-rose-400 mt-0.5 shrink-0" />
              <div className="text-xs text-rose-300 space-y-1">
                <p className="font-semibold">This cannot be undone.</p>
                <p>Deleting <span className="text-white font-medium">"{deleteTarget.name}"</span> will permanently remove:</p>
                <ul className="list-disc list-inside text-rose-300/80 space-y-0.5 mt-1">
                  <li>All users and login access</li>
                  <li>All invoices, communications, and tasks</li>
                  <li>All sync data (QBO, Xero, Sage)</li>
                  <li>The subscription record</li>
                  {deleteTarget.source === "stripe" && <li className="text-rose-200 font-medium">Stripe subscription will be cancelled immediately</li>}
                </ul>
              </div>
            </div>
            <div>
              <label className="text-xs text-stone-400 block mb-2">
                Type <span className="text-white font-mono font-semibold">{deleteTarget.name}</span> to confirm
              </label>
              <input value={deleteConfirmName} onChange={e => setDeleteConfirmName(e.target.value)}
                placeholder={deleteTarget.name} autoFocus
                className="w-full px-3 py-2 rounded-lg border border-stone-700 bg-stone-800/60 text-sm text-white placeholder-stone-600 focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500" />
              {deleteConfirmName && deleteConfirmName !== deleteTarget.name && (
                <p className="text-[11px] text-rose-400 mt-1">Name doesn't match exactly</p>
              )}
            </div>
          </div>
        </Modal>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
