"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft, Loader, ExternalLink, Ban, Undo2, CheckCircle2, HandCoins,
  CreditCard, Building2, TrendingUp, FileText, Receipt, FileMinus, Blocks,
} from "lucide-react";
import { Card, Badge, Toast, Button, Modal } from "@/components/ui";
import { Pencil } from "lucide-react";
import { fmt } from "@/lib/format";
import { MODULE_KEYS, MODULES, type ModuleKey } from "@/lib/modules";

const STATUS_BADGE: Record<string, string> = {
  paid: "green", open: "blue", draft: "neutral", void: "neutral", uncollectible: "red",
  active: "green", trialing: "blue", past_due: "red", canceled: "neutral", cancelled: "neutral",
  incomplete: "yellow", unpaid: "red", issued: "green",
};
const METHOD_LABEL: Record<string, string> = {
  bank_transfer: "Bank transfer", cheque: "Cheque", cash: "Cash", card_external: "Card (external)", other: "Other", stripe: "Stripe", offline: "Offline",
};

function Stat({ label, value, icon: Icon, accent }: any) {
  return (
    <div className="p-3 rounded-xl border border-stone-800 bg-stone-900/50">
      <div className="flex items-center justify-between mb-1"><span className="text-[11px] text-stone-500">{label}</span><Icon size={13} className={accent ?? "text-stone-600"} /></div>
      <p className="text-xl font-semibold text-white tabular-nums">{value}</p>
    </div>
  );
}

type Tab = "invoices" | "payments" | "credits";

export default function CustomerDetailPage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast]     = useState<any>(null);
  const [acting, setActing]   = useState<string | null>(null);
  const [tab, setTab]         = useState<Tab>("invoices");
  const [priceOpen, setPriceOpen] = useState(false);
  const [newAmount, setNewAmount] = useState("");
  const [newInterval, setNewInterval] = useState<"month" | "year">("month");
  const [prorate, setProrate] = useState(true);
  const [savingPrice, setSavingPrice] = useState(false);
  const [savingModules, setSavingModules] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/billing/org/${orgId}`);
      const d = await r.json();
      if (r.ok) setData(d);
      else setToast({ type: "error", message: d.error ?? `Failed (${r.status})` });
    } catch (e: any) { setToast({ type: "error", message: e?.message ?? "Network error" }); }
    finally { setLoading(false); }
  }, [orgId]);

  useEffect(() => { if (orgId) load(); }, [orgId, load]);

  const ccy = data?.stats?.currency ?? "GBP";
  const money = (n: number) => fmt.money((n ?? 0) / 100, ccy);
  const date = (t: number | null) => t ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }) : "—";

  // Record an offline-collected payment against a Stripe invoice (one ledger:
  // marks it paid out-of-band, no card charged, access syncs via invoice.paid).
  const [payInv, setPayInv]       = useState<any | null>(null);
  const [payMethod, setPayMethod] = useState("bank_transfer");
  const [payDate, setPayDate]     = useState("");
  const [payNote, setPayNote]     = useState("");
  const [payingOff, setPayingOff] = useState(false);

  const submitMarkPaid = async () => {
    if (!payInv) return;
    setPayingOff(true);
    try {
      const r = await fetch(`/api/admin/billing/invoices/${payInv.id}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "mark_paid", method: payMethod, receivedDate: payDate, note: payNote.trim() || undefined }),
      });
      const d = await r.json();
      if (r.ok) {
        // Surface the backend's provisioning outcome — a green toast on a
        // paid org with zero users is how customers end up locked out.
        if (d.warning) setToast({ type: "error", message: d.warning });
        else setToast({ type: "success", message: `Offline payment recorded${d.invited ? ` — ${d.invited} set-password invite(s) sent` : ""}` });
        setPayInv(null); load();
      }
      else setToast({ type: "error", message: d.error ?? "Failed" });
    } finally { setPayingOff(false); }
  };

  const invoiceAction = async (invId: string, body: any, confirmMsg?: string, promptNote?: boolean) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    if (promptNote) { const n = window.prompt("Note / reference (optional):") ?? ""; body.note = n.trim() || undefined; }
    setActing(invId);
    try {
      const r = await fetch(`/api/admin/billing/invoices/${invId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (r.ok) { setToast({ type: "success", message: "Done" }); load(); }
      else setToast({ type: "error", message: d.error ?? "Failed" });
    } finally { setActing(null); }
  };

  const cancelSub = async () => {
    const sub = data?.subscription; if (!sub) return;
    if (!confirm(`Cancel ${data.org.name}'s subscription now and revoke access?`)) return;
    setActing("sub");
    try {
      const r = await fetch(`/api/admin/subscriptions/${sub.id}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ atPeriodEnd: false }) });
      const d = await r.json();
      if (r.ok) { setToast({ type: "success", message: "Subscription cancelled" }); load(); }
      else setToast({ type: "error", message: d.error ?? "Failed" });
    } finally { setActing(null); }
  };

  const toggleModule = async (key: ModuleKey, enabled: boolean) => {
    const current: ModuleKey[] = Array.isArray(data?.org?.enabledModules) ? data.org.enabledModules : [];
    const next = enabled ? [...new Set([...current, key])] : current.filter(k => k !== key);
    setSavingModules(true);
    try {
      const r = await fetch(`/api/admin/organisations/${orgId}/modules`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabledModules: next }),
      });
      const d = await r.json();
      if (r.ok) { setToast({ type: "success", message: `${MODULES[key].label} ${enabled ? "enabled" : "disabled"}` }); load(); }
      else setToast({ type: "error", message: d.error ?? "Failed" });
    } finally { setSavingModules(false); }
  };

  const openPriceModal = () => {
    const s = data?.subscription;
    setNewAmount(s?.planAmount != null ? String(s.planAmount / 100) : "");
    setNewInterval(s?.planInterval === "year" ? "year" : "month");
    setProrate(true);
    setPriceOpen(true);
  };
  const submitPrice = async () => {
    const sub = data?.subscription; if (!sub) return;
    const cents = Math.round(parseFloat(newAmount) * 100);
    if (!cents || cents <= 0) { setToast({ type: "error", message: "Enter a valid amount" }); return; }
    setSavingPrice(true);
    try {
      const r = await fetch(`/api/admin/subscriptions/${sub.id}/change-price`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: cents, interval: newInterval, prorate }),
      });
      const d = await r.json();
      if (r.ok) { setToast({ type: "success", message: "Price updated" }); setPriceOpen(false); load(); }
      else setToast({ type: "error", message: d.error ?? "Failed" });
    } finally { setSavingPrice(false); }
  };

  if (loading && !data) return <div className="p-6"><Loader size={20} className="animate-spin text-stone-500" /></div>;
  if (!data) return null;

  const { org, subscription: sub, invoices, payments, creditNotes = [], stats } = data;

  const tabs: { key: Tab; label: string; icon: any; count: number }[] = [
    { key: "invoices", label: "Invoices", icon: FileText, count: invoices.length },
    { key: "payments", label: "Payments", icon: Receipt, count: payments.length },
    { key: "credits",  label: "Credit Notes", icon: FileMinus, count: creditNotes.length },
  ];

  return (
    <div className="space-y-5">
      <Link href="/admin/customers" className="inline-flex items-center gap-1 text-[13px] text-stone-500 hover:text-stone-200">
        <ChevronLeft size={14} /> Customers
      </Link>

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-stone-800 flex items-center justify-center"><Building2 size={18} className="text-stone-400" /></div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-white">{org.name}</h1>
          <p className="text-xs text-stone-500">
            {data.admins?.[0]?.email ?? sub?.billingEmail ?? "—"}
            {sub && <> · <Badge variant={(STATUS_BADGE[sub.status] ?? "neutral") as any} size="sm">{sub.isActive ? "active" : sub.status}</Badge></>}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={async () => {
              const r = await fetch(`/api/admin/organisations/${orgId}/activate`, { method: "POST" });
              const d = await r.json().catch(() => ({}));
              if (!r.ok) { setToast({ type: "error", message: d.error ?? "Failed" }); return; }
              if (d.warning) setToast({ type: "error", message: d.warning });
              else setToast({ type: "success", message: `Activated — ${d.invited} set-password invite(s) sent (${d.userCount} user(s) in org)` });
              load();
            }}
            title="Activate the org and (re)send set-password invites to users without working credentials"
            className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium rounded-lg border border-emerald-800 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors">
            <CheckCircle2 size={13} /> Activate &amp; send invites
          </button>
          {data.crmLeadId && (
            <Link href={`/admin/leads/${data.crmLeadId}`}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800 transition-colors">
              <ExternalLink size={13} /> View in CRM
            </Link>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="MRR" value={money(stats.mrr)} icon={TrendingUp} accent="text-emerald-400" />
        <Stat label="Total billed" value={money(stats.totalBilled)} icon={CreditCard} />
        <Stat label="Total paid" value={money(stats.totalPaid)} icon={CheckCircle2} accent="text-emerald-400" />
        <Stat label="Outstanding" value={money(stats.outstanding)} icon={HandCoins} accent={stats.outstanding > 0 ? "text-amber-400" : "text-stone-600"} />
      </div>

      {/* Subscription */}
      <Card padding="md">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white">Subscription</h2>
          {sub && sub.source === "stripe" && (sub.status === "active" || sub.status === "trialing" || sub.status === "past_due") && (
            <div className="flex items-center gap-2">
              <button onClick={openPriceModal} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-stone-700 text-stone-300 hover:bg-stone-700">
                <Pencil size={11} /> Change price
              </button>
              <button onClick={cancelSub} disabled={acting === "sub"} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-rose-700/50 text-rose-400 hover:bg-rose-500/10 disabled:opacity-40">
                {acting === "sub" ? <Loader size={11} className="animate-spin" /> : <Ban size={11} />} Cancel & revoke
              </button>
            </div>
          )}
        </div>
        {!sub ? (
          <p className="text-sm text-stone-500">No subscription. <Link href="/admin/subscriptions" className="text-sky-400 hover:text-sky-300">Create one →</Link></p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><div className="text-[11px] text-stone-500 mb-0.5">Plan</div><div className="text-stone-200">{sub.planName ?? "—"}</div></div>
            <div><div className="text-[11px] text-stone-500 mb-0.5">Price</div><div className="text-stone-200">{sub.planAmount ? `${fmt.money(sub.planAmount / 100, (sub.planCurrency ?? ccy).toUpperCase())}${sub.planInterval ? `/${sub.planInterval}` : ""}` : "—"}</div></div>
            <div><div className="text-[11px] text-stone-500 mb-0.5">Source</div><div className="text-stone-200 capitalize">{sub.source}</div></div>
            <div><div className="text-[11px] text-stone-500 mb-0.5">{sub.source === "manual" ? "Expires" : "Renews"}</div>
              <div className="text-stone-200">
                {sub.source === "manual"
                  ? (sub.manualExpiresAt ? new Date(sub.manualExpiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "No expiry")
                  : (sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—")}
                {sub.cancelAtPeriodEnd && <span className="text-amber-400 text-[11px] ml-1">(cancelling)</span>}
              </div>
            </div>
            {sub.stripeSubscriptionId && (
              <div><div className="text-[11px] text-stone-500 mb-0.5">Stripe Subscription</div>
                <a href={`https://dashboard.stripe.com/subscriptions/${sub.stripeSubscriptionId}`} target="_blank" rel="noreferrer" className="text-sky-400 hover:text-sky-300 font-mono text-xs inline-flex items-center gap-1">{String(sub.stripeSubscriptionId).slice(0, 18)}… <ExternalLink size={11} /></a>
              </div>
            )}
            {sub.stripeCustomerId && (
              <div><div className="text-[11px] text-stone-500 mb-0.5">Stripe Customer</div>
                <a href={`https://dashboard.stripe.com/customers/${sub.stripeCustomerId}`} target="_blank" rel="noreferrer" className="text-sky-400 hover:text-sky-300 font-mono text-xs inline-flex items-center gap-1">{String(sub.stripeCustomerId).slice(0, 18)}… <ExternalLink size={11} /></a>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Modules */}
      <Card padding="md">
        <div className="flex items-center gap-2 mb-3">
          <Blocks size={14} className="text-stone-500" />
          <h2 className="text-sm font-semibold text-white">Modules</h2>
          <span className="text-[11px] text-stone-500">— which product areas this org can access</span>
        </div>
        <div className="grid sm:grid-cols-2 gap-2.5">
          {MODULE_KEYS.map((key) => {
            const meta = MODULES[key];
            const enabled = Array.isArray(org.enabledModules) && org.enabledModules.includes(key);
            return (
              <label key={key} className="flex items-start gap-2.5 rounded-lg border border-stone-800 bg-stone-900/50 p-3 cursor-pointer hover:border-stone-700">
                <input type="checkbox" checked={enabled} disabled={savingModules}
                  onChange={(e) => toggleModule(key, e.target.checked)}
                  className="mt-0.5 accent-emerald-500" />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-medium text-stone-100">{meta.label}</span>
                    {meta.core && <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-stone-800 text-stone-500">core</span>}
                  </div>
                  <p className="text-[11px] text-stone-500 leading-snug mt-0.5">{meta.description}</p>
                </div>
              </label>
            );
          })}
        </div>
      </Card>

      {/* Tabs */}
      <div>
        <div className="flex gap-1 border-b border-stone-800 mb-0">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px ${
                tab === t.key ? "border-emerald-500 text-white" : "border-transparent text-stone-500 hover:text-stone-300"
              }`}>
              <t.icon size={13} /> {t.label}
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-stone-800 text-stone-400">{t.count}</span>
            </button>
          ))}
          {tab === "invoices" && (
            <Link href={`/admin/invoices?org=${orgId}`} className="ml-auto self-center text-[11px] text-sky-400 hover:text-sky-300">Full invoice tools →</Link>
          )}
        </div>

        <Card padding="none">
          {/* ── Invoices ── */}
          {tab === "invoices" && (
            invoices.length === 0 ? <p className="text-sm text-stone-500 py-8 text-center">No invoices yet</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-stone-800 text-[11px] text-stone-500">
                    {["Invoice", "Billing", "Amount", "Status", "Created", "Paid", "Actions"].map(h => <th key={h} className="text-left px-4 py-2.5 font-medium">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {invoices.map((inv: any) => {
                      const canVoid = inv.status === "open" || inv.status === "draft";
                      const paidDate = inv.receivedDate ? new Date(inv.receivedDate).getTime() : inv.paidAt;
                      return (
                        <tr key={inv.id} className="border-b border-stone-800/50 hover:bg-stone-800/25">
                          <td className="px-4 py-2.5 font-mono text-xs text-stone-300">{inv.number ?? inv.id.slice(0, 12)}</td>
                          <td className="px-4 py-2.5"><span className="text-[10px] text-stone-400">{inv.billingLabel}</span></td>
                          <td className="px-4 py-2.5 tabular-nums text-stone-200">{money(inv.total)}</td>
                          <td className="px-4 py-2.5"><Badge variant={(STATUS_BADGE[inv.status] ?? "neutral") as any}>{inv.status}</Badge>{inv.refunded && <span className="text-[10px] text-rose-400 ml-1">refunded</span>}</td>
                          <td className="px-4 py-2.5 text-[11px] text-stone-400">{date(inv.created)}</td>
                          <td className="px-4 py-2.5 text-[11px]">{paidDate ? <span className="text-emerald-400/90">{date(paidDate)}</span> : <span className="text-stone-600">—</span>}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1.5">
                              {inv.hostedInvoiceUrl && <a href={inv.hostedInvoiceUrl} target="_blank" rel="noreferrer" className="text-stone-500 hover:text-sky-400 p-1"><ExternalLink size={13} /></a>}
                              {(inv.status === "open" || inv.status === "draft") && <button onClick={() => { setPayInv(inv); setPayMethod("bank_transfer"); setPayDate(new Date().toISOString().slice(0, 10)); setPayNote(""); }} disabled={acting === inv.id} className="text-[11px] px-2 py-1 rounded border border-emerald-700/50 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40 flex items-center gap-1"><CheckCircle2 size={11} /> Mark paid</button>}
                              {canVoid && <button onClick={() => invoiceAction(inv.id, { action: "void" }, `Void invoice ${inv.number ?? ""}?`)} disabled={acting === inv.id} className="text-[11px] px-2 py-1 rounded border border-rose-700/50 text-rose-400 hover:bg-rose-500/10 disabled:opacity-40 flex items-center gap-1"><Ban size={11} /> Void</button>}
                              {inv.status === "paid" && !inv.refunded && <button onClick={() => invoiceAction(inv.id, { action: "refund" }, `Refund ${money(inv.total)} to ${org.name}?${inv.isSubscription ? " The subscription will be cancelled." : ""}`, true)} disabled={acting === inv.id} className="text-[11px] px-2 py-1 rounded border border-amber-700/50 text-amber-400 hover:bg-amber-500/10 disabled:opacity-40 flex items-center gap-1"><Undo2 size={11} /> Refund</button>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}

          {/* ── Payments ── */}
          {tab === "payments" && (
            payments.length === 0 ? <p className="text-sm text-stone-500 py-8 text-center">No payments recorded yet</p> : (
              <div className="divide-y divide-stone-800/50">
                {payments.map((p: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 text-sm px-4 py-3">
                    <CheckCircle2 size={14} className={p.refunded ? "text-stone-600" : "text-emerald-500"} />
                    <span className="text-stone-200 tabular-nums w-24">{money(p.amount)}</span>
                    <span className="text-[11px] text-stone-500">{METHOD_LABEL[p.method] ?? p.method}</span>
                    {p.invoiceNumber && <span className="text-[11px] text-stone-600 font-mono">{p.invoiceNumber}</span>}
                    {p.refunded && <span className="text-[11px] text-rose-400">refunded</span>}
                    <span className="text-[11px] text-stone-500 ml-auto">{date(p.date)}</span>
                  </div>
                ))}
              </div>
            )
          )}

          {/* ── Credit Notes ── */}
          {tab === "credits" && (
            creditNotes.length === 0 ? <p className="text-sm text-stone-500 py-8 text-center">No credit notes</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-stone-800 text-[11px] text-stone-500">
                    {["Credit note", "Amount", "Reason", "Status", "Created", ""].map(h => <th key={h} className="text-left px-4 py-2.5 font-medium">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {creditNotes.map((c: any) => (
                      <tr key={c.id} className="border-b border-stone-800/50 hover:bg-stone-800/25">
                        <td className="px-4 py-2.5 font-mono text-xs text-stone-300">{c.number ?? c.id.slice(0, 12)}</td>
                        <td className="px-4 py-2.5 tabular-nums text-rose-300">−{money(c.total)}</td>
                        <td className="px-4 py-2.5 text-xs text-stone-400 capitalize">{(c.reason ?? "—").replace(/_/g, " ")}</td>
                        <td className="px-4 py-2.5"><Badge variant={(STATUS_BADGE[c.status] ?? "neutral") as any}>{c.status}</Badge></td>
                        <td className="px-4 py-2.5 text-[11px] text-stone-400">{date(c.created)}</td>
                        <td className="px-4 py-2.5 text-right">{c.pdf && <a href={c.pdf} target="_blank" rel="noreferrer" className="text-stone-500 hover:text-sky-400 inline-block p-1"><ExternalLink size={13} /></a>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </Card>
      </div>

      {/* Change price modal */}
      <Modal open={priceOpen} onClose={() => setPriceOpen(false)} title="Change subscription price"
        footer={<><Button variant="secondary" onClick={() => setPriceOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={submitPrice} disabled={savingPrice}>{savingPrice ? "Saving…" : "Update price"}</Button></>}>
        <div className="px-5 py-5 space-y-4">
          <p className="text-[12px] text-stone-500">The saved card is charged the new amount going forward. Proration credits/charges the difference for the current period.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-stone-400 block mb-1.5">New amount ({ccy})</label>
              <input value={newAmount} onChange={e => setNewAmount(e.target.value)} inputMode="decimal" placeholder="499.00"
                className="w-full px-3 py-2 rounded-lg border border-stone-700 bg-stone-800/60 text-sm text-white focus:border-emerald-500 focus:outline-none" />
            </div>
            <div>
              <label className="text-xs text-stone-400 block mb-1.5">Billing cycle</label>
              <select value={newInterval} onChange={e => setNewInterval(e.target.value as any)}
                className="w-full px-3 py-2 rounded-lg border border-stone-700 bg-stone-800/60 text-sm text-white focus:border-emerald-500 focus:outline-none">
                <option value="month">Monthly</option><option value="year">Yearly</option>
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-stone-300 cursor-pointer">
            <input type="checkbox" checked={prorate} onChange={e => setProrate(e.target.checked)} className="accent-emerald-500" />
            Prorate the change for the current period
          </label>
        </div>
      </Modal>

      <Modal open={!!payInv} onClose={() => setPayInv(null)} title="Record offline payment"
        footer={<><Button variant="secondary" onClick={() => setPayInv(null)}>Cancel</Button>
          <Button variant="primary" onClick={submitMarkPaid} disabled={payingOff || !payDate}>{payingOff ? "Recording…" : "Mark as paid"}</Button></>}>
        <div className="px-5 py-5 space-y-4">
          <p className="text-[12px] text-stone-500">Records payment received outside Stripe (bank transfer, cheque, cash…). The Stripe invoice is marked paid <span className="text-stone-300">out-of-band</span> — no card is charged — and access syncs as normal. Stripe stays the single ledger.</p>
          {payInv && <p className="text-xs text-stone-400">Invoice <span className="font-mono text-stone-200">{payInv.number ?? payInv.id?.slice(0, 12)}</span> · <span className="text-stone-200">{money(payInv.total)}</span></p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-stone-400 block mb-1.5">Method</label>
              <select value={payMethod} onChange={e => setPayMethod(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-stone-700 bg-stone-800/60 text-sm text-white focus:border-emerald-500 focus:outline-none">
                {["bank_transfer", "cheque", "cash", "card_external", "other"].map(m => <option key={m} value={m}>{METHOD_LABEL[m] ?? m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-stone-400 block mb-1.5">Received date</label>
              <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-stone-700 bg-stone-800/60 text-sm text-white focus:border-emerald-500 focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="text-xs text-stone-400 block mb-1.5">Reference / note (optional)</label>
            <input value={payNote} onChange={e => setPayNote(e.target.value)} placeholder="e.g. bank ref 12345 / cheque no."
              className="w-full px-3 py-2 rounded-lg border border-stone-700 bg-stone-800/60 text-sm text-white focus:border-emerald-500 focus:outline-none" />
          </div>
        </div>
      </Modal>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
