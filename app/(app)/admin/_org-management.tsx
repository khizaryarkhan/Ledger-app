"use client";

// Shared org-management UI (helpers + modals). Owned by the Accounts directory
// so org create/edit/delete lives in one place — the single source of truth.
import { useState, useEffect } from "react";
import Link from "next/link";
import { Button, Badge, Input } from "@/components/ui";
import { Plus, Check, X, Eye, EyeOff, AlertTriangle, XCircle, Clock, CheckCircle2, Pencil, Loader2, Trash2, Copy, CheckCheck, ArrowUpRight } from "lucide-react";
import { fmt } from "@/lib/format";

export function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button onClick={copy} title={copied ? "Copied!" : `Copy org ID: ${id}`}
      className="ml-1 p-0.5 rounded text-stone-700 hover:text-stone-400 transition-colors">
      {copied ? <CheckCheck size={10} className="text-emerald-400" /> : <Copy size={10} />}
    </button>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={status === "Active" ? "green" : "neutral"} size="sm">{status}</Badge>;
}

export function RoleBadge({ role, repTier }: { role: string; repTier?: string | null }) {
  const effective = repTier ?? role;
  const map: Record<string, any> = {
    super_admin:   { variant: "purple",  label: "Super Admin"  },
    company_admin: { variant: "blue",    label: "Company Admin" },
    company_user:  { variant: "neutral", label: "User"          },
    rep:           { variant: "orange",  label: "Rep / PM"      },
    rd:            { variant: "blue",    label: "RD"            },
    ed:            { variant: "green",   label: "ED / RM"       },
  };
  const cfg = map[effective] || { variant: "neutral", label: effective };
  return <Badge variant={cfg.variant} size="sm">{cfg.label}</Badge>;
}

export function daysUntil(date: string | Date | null): number | null {
  if (!date) return null;
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000);
}

export function fmtPlan(org: any): string | null {
  if (!org.planAmount || !org.planCurrency) return org.planName ?? null;
  const money = fmt.money(org.planAmount / 100, org.planCurrency.toUpperCase());
  const interval = org.planInterval ? `/${org.planInterval === "month" ? "mo" : org.planInterval}` : "";
  return org.planName ? `${org.planName} · ${money}${interval}` : `${money}${interval}`;
}

export type SubRisk = "none" | "warning" | "critical";

export function getSubRisk(org: any): SubRisk {
  if (!org.subId) return "critical";
  if (org.subStatus === "past_due" || org.subStatus === "unpaid" || org.subStatus === "incomplete") return "critical";
  if (org.subStatus === "cancelled") return "warning";
  if (org.cancelAtPeriodEnd) return "warning";
  if (org.lastPaymentStatus === "failed") return "critical";
  if (org.subStatus === "trialing") {
    const d = daysUntil(org.trialEnd);
    return d !== null && d <= 7 ? "warning" : "none";
  }
  if (org.subSource === "manual" && org.manualExpiresAt) {
    const d = daysUntil(org.manualExpiresAt);
    if (d === null) return "none";
    return d <= 0 ? "critical" : d <= 7 ? "warning" : "none";
  }
  return "none";
}

export function SubStatusBadge({ org }: { org: any }) {
  if (!org.subId) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 bg-amber-500/15 px-2 py-0.5 rounded-full border border-amber-500/20">
        <AlertTriangle size={9} /> No subscription
      </span>
    );
  }
  const s = org.subStatus;
  if (s === "past_due" || s === "unpaid" || s === "incomplete") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-400 bg-rose-500/15 px-2 py-0.5 rounded-full border border-rose-500/20">
        <AlertTriangle size={9} /> Past due
      </span>
    );
  }
  if (org.lastPaymentStatus === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-400 bg-rose-500/15 px-2 py-0.5 rounded-full border border-rose-500/20">
        <XCircle size={9} /> Payment failed
      </span>
    );
  }
  if (s === "cancelled") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-stone-400 bg-stone-700/60 px-2 py-0.5 rounded-full border border-stone-600/30">
        <XCircle size={9} /> Cancelled
      </span>
    );
  }
  if (org.cancelAtPeriodEnd) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 bg-amber-500/15 px-2 py-0.5 rounded-full border border-amber-500/20">
        <Clock size={9} /> Cancelling
      </span>
    );
  }
  if (s === "trialing") {
    const d = daysUntil(org.trialEnd);
    const warn = d !== null && d <= 7;
    return (
      <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${warn ? "text-amber-400 bg-amber-500/15 border-amber-500/20" : "text-blue-400 bg-blue-500/15 border-blue-500/20"}`}>
        <Clock size={9} /> Trial{d !== null ? ` · ${d}d left` : ""}
      </span>
    );
  }
  if (s === "active") {
    if (org.subSource === "manual" && org.manualExpiresAt) {
      const d = daysUntil(org.manualExpiresAt);
      if (d !== null && d <= 0) return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-400 bg-rose-500/15 px-2 py-0.5 rounded-full border border-rose-500/20">
          <AlertTriangle size={9} /> Expired
        </span>
      );
      if (d !== null && d <= 7) return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 bg-amber-500/15 px-2 py-0.5 rounded-full border border-amber-500/20">
          <Clock size={9} /> Expires {d}d
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/15 px-2 py-0.5 rounded-full border border-emerald-500/20">
        <CheckCircle2 size={9} /> Active
      </span>
    );
  }
  return <span className="text-[11px] text-stone-500 capitalize">{s ?? "Unknown"}</span>;
}

export function NextBillingCell({ org }: { org: any }) {
  if (!org.subId) return <span className="text-stone-600 text-xs">—</span>;
  const isManual = org.subSource === "manual";
  const date = isManual ? org.manualExpiresAt : org.currentPeriodEnd;
  if (!date) return <span className="text-stone-600 text-xs">—</span>;
  const d = daysUntil(date);
  const label = new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
  const color = d === null ? "text-stone-400" : d < 0 ? "text-rose-400" : d <= 7 ? "text-amber-400" : "text-stone-400";
  return (
    <span className={`text-xs ${color}`}>
      {label}
      {d !== null && d >= 0 && d <= 14 && <span className="ml-1 text-[10px]">({d}d)</span>}
      {d !== null && d < 0 && <span className="ml-1 text-[10px]">(expired)</span>}
    </span>
  );
}

// ============================================================
// CREATE ORG MODAL (Super Admin only)
// ============================================================
export function CreateOrgModal({ onClose, onCreated }: any) {
  const [form, setForm] = useState({ name: "", slug: "", adminName: "", adminEmail: "", adminPassword: "" });
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [emailExists, setEmailExists] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!form.adminEmail || !/\S+@\S+\.\S+/.test(form.adminEmail)) { setEmailExists(false); return; }
    const timer = setTimeout(async () => {
      setCheckingEmail(true);
      try {
        const res = await fetch(`/api/admin/users?email=${encodeURIComponent(form.adminEmail)}`);
        const data = await res.json();
        setEmailExists(Array.isArray(data) ? data.some((u: any) => u.email === form.adminEmail.toLowerCase()) : false);
      } catch { setEmailExists(false); }
      finally { setCheckingEmail(false); }
    }, 400);
    return () => clearTimeout(timer);
  }, [form.adminEmail]);

  const handleSubmit = async () => {
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/admin/organisations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed"); return; }
      onCreated(data);
      onClose();
    } finally { setSaving(false); }
  };

  const autoSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const canSubmit = !saving && !!form.name && !!form.slug && !!form.adminEmail && (emailExists || !!form.adminPassword);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-stone-900 rounded-xl w-full max-w-md shadow-xl ring-1 ring-stone-800">
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
          <h2 className="font-semibold text-white">Create new organisation</h2>
          <button onClick={onClose} className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-white"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          {error && <div className="text-sm text-rose-400 bg-rose-500/10 px-3 py-2 rounded ring-1 ring-rose-500/30">{error}</div>}
          <div>
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Organisation name</label>
            <Input value={form.name} onChange={(e: any) => { set("name", e.target.value); if (!form.slug) set("slug", autoSlug(e.target.value)); }} placeholder="Acme Ltd" />
          </div>
          <div>
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Slug (URL-safe, unique)</label>
            <Input value={form.slug} onChange={(e: any) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="acme-ltd" />
          </div>
          <div className="pt-2 border-t border-stone-800">
            <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">First Company Admin account</div>
            <div className="space-y-2">
              <Input value={form.adminName} onChange={(e: any) => set("adminName", e.target.value)} placeholder="Admin full name" />
              <div className="relative">
                <Input type="email" value={form.adminEmail} onChange={(e: any) => set("adminEmail", e.target.value)} placeholder="admin@company.com" />
                {checkingEmail && <span className="absolute right-3 top-2.5 text-[10px] text-stone-400">checking…</span>}
              </div>
              {emailExists && (
                <div className="flex items-start gap-2 text-xs bg-blue-500/10 text-blue-300 px-3 py-2 rounded ring-1 ring-blue-500/30">
                  <Check size={13} className="mt-0.5 shrink-0" />
                  <span>This user already exists and will be linked to the new organisation. No new password needed.</span>
                </div>
              )}
              {!emailExists && (
                <div className="relative">
                  <Input type={showPw ? "text" : "password"} value={form.adminPassword} onChange={(e: any) => set("adminPassword", e.target.value)} placeholder="Temporary password (min 8 chars)" />
                  <button onClick={() => setShowPw(p => !p)} className="absolute right-3 top-2.5 text-stone-400 hover:text-stone-300">
                    {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-stone-800 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {saving ? "Creating…" : "Create organisation"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// EDIT ORG MODAL (Super Admin only)
// ============================================================
export function EditOrgModal({ org, onClose, onSaved }: { org: any; onClose: () => void; onSaved: () => void }) {
  const [orgName, setOrgName] = useState(org.name);
  const [orgStatus, setOrgStatus] = useState(org.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [users, setUsers] = useState<any[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);

  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", role: "" });
  const [savingUser, setSavingUser] = useState(false);
  const [userError, setUserError] = useState("");

  const [showAddUser, setShowAddUser] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", email: "", password: "", role: "company_admin" });
  const [addShowPw, setAddShowPw] = useState(false);
  const [addEmailExists, setAddEmailExists] = useState(false);
  const [checkingAddEmail, setCheckingAddEmail] = useState(false);
  const [addingUser, setAddingUser] = useState(false);
  const [addError, setAddError] = useState("");
  const setAdd = (k: string, v: string) => setAddForm(p => ({ ...p, [k]: v }));

  const loadUsers = () => {
    setUsersLoading(true);
    fetch(`/api/admin/users?orgId=${org.id}`)
      .then(async r => { if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || `HTTP ${r.status}`); } return r.json(); })
      .then(data => { setUsers(Array.isArray(data) ? data : []); setUserError(""); setUsersLoading(false); })
      .catch(e => { setUserError(`Could not load users: ${e.message}`); setUsersLoading(false); });
  };

  useEffect(() => { loadUsers(); }, [org.id]);

  useEffect(() => {
    if (!addForm.email || !/\S+@\S+\.\S+/.test(addForm.email)) { setAddEmailExists(false); return; }
    const timer = setTimeout(async () => {
      setCheckingAddEmail(true);
      try {
        const res = await fetch(`/api/admin/users?email=${encodeURIComponent(addForm.email)}`);
        const data = await res.json();
        setAddEmailExists(Array.isArray(data) ? data.some((u: any) => u.email === addForm.email.toLowerCase()) : false);
      } catch { setAddEmailExists(false); }
      finally { setCheckingAddEmail(false); }
    }, 400);
    return () => clearTimeout(timer);
  }, [addForm.email]);

  const handleAddUser = async () => {
    setAddingUser(true); setAddError("");
    try {
      const res = await fetch(`/api/admin/organisations/${org.id}/users`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      const data = await res.json();
      if (!res.ok) { setAddError(data.error || "Failed to add user"); return; }
      setShowAddUser(false);
      setAddForm({ name: "", email: "", password: "", role: "company_admin" });
      setAddEmailExists(false);
      loadUsers();
      onSaved();
    } finally { setAddingUser(false); }
  };

  const saveOrg = async () => {
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/admin/organisations", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: org.id, name: orgName, status: orgStatus }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to update"); return; }
      onSaved();
    } finally { setSaving(false); }
  };

  const startEditUser = (u: any) => {
    setEditingUser(u.id);
    setEditForm({ name: u.name, email: u.email, role: u.role });
    setUserError("");
  };

  const saveUser = async (userId: string) => {
    setSavingUser(true); setUserError("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...editForm }),
      });
      const data = await res.json();
      if (!res.ok) { setUserError(data.error || "Failed to update user"); return; }
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...data } : u));
      setEditingUser(null);
    } finally { setSavingUser(false); }
  };

  const removeUser = async (userId: string, name: string) => {
    if (!confirm(`Remove ${name} from this organisation? They will lose access immediately. If this is their only organisation, their account will be deactivated.`)) return;
    setUserError("");
    try {
      const res = await fetch(`/api/admin/organisations/${org.id}/users?userId=${userId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { setUserError(data.error || "Failed to remove user"); return; }
      setUsers(prev => prev.filter(u => u.id !== userId));
      onSaved();
    } catch (e: any) {
      setUserError(e?.message || "Failed to remove user");
    }
  };

  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState("");
  const resendWelcome = async () => {
    setResending(true); setResendMsg("");
    try {
      const res = await fetch(`/api/admin/organisations/${org.id}/resend-welcome`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      const data = await res.json();
      setResendMsg(res.ok ? `Welcome email sent to ${data.to}` : (data.error || "Failed to send"));
    } catch (e: any) { setResendMsg(e?.message || "Failed to send"); }
    finally { setResending(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-stone-900 rounded-xl w-full max-w-xl shadow-xl ring-1 ring-stone-800 flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-semibold text-white">Edit organisation</h2>
            <p className="text-xs text-stone-500 mt-0.5 font-mono">/{org.slug}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-white"><X size={16} /></button>
        </div>

        <div className="overflow-y-auto flex-1">
          <div className="p-5 space-y-3">
            {error && <div className="text-sm text-rose-400 bg-rose-500/10 px-3 py-2 rounded ring-1 ring-rose-500/30">{error}</div>}
            <div>
              <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Organisation name</label>
              <Input value={orgName} onChange={(e: any) => setOrgName(e.target.value)} placeholder="Organisation name" />
            </div>
            <div>
              <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Status</label>
              <select value={orgStatus} onChange={(e: any) => setOrgStatus(e.target.value)}
                className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-700 focus:ring-emerald-500 focus:outline-none bg-stone-800 text-stone-300">
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <button onClick={resendWelcome} disabled={resending}
                className="text-[12px] text-emerald-400 hover:text-emerald-300 disabled:opacity-50">
                {resending ? "Sending…" : "✉ Resend welcome email"}
              </button>
              <Button onClick={saveOrg} disabled={saving || !orgName.trim()}>
                {saving ? "Saving…" : "Save organisation"}
              </Button>
            </div>
            {resendMsg && <p className="text-[12px] text-stone-400 text-right">{resendMsg}</p>}
          </div>

          <div className="border-t border-stone-800 px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider">Billing</div>
              <Link href="/admin/subscriptions"
                className="text-[11px] text-stone-500 hover:text-stone-200 flex items-center gap-1 transition-colors">
                Manage <ArrowUpRight size={10} />
              </Link>
            </div>
            {org.subId ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                <div>
                  <p className="text-[10px] text-stone-600 uppercase tracking-wider mb-1">Status</p>
                  <SubStatusBadge org={org} />
                </div>
                <div>
                  <p className="text-[10px] text-stone-600 uppercase tracking-wider mb-1">Plan</p>
                  <p className="text-xs text-stone-300">{fmtPlan(org) ?? "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] text-stone-600 uppercase tracking-wider mb-1">
                    {org.cancelAtPeriodEnd ? "Cancels on" : org.subSource === "manual" ? "Expires" : "Next billing"}
                  </p>
                  <NextBillingCell org={org} />
                </div>
                {(org.paymentMethodBrand || org.paymentMethodLast4) && (
                  <div>
                    <p className="text-[10px] text-stone-600 uppercase tracking-wider mb-1">Payment method</p>
                    <p className="text-xs text-stone-300 capitalize">{org.paymentMethodBrand} ••{org.paymentMethodLast4}</p>
                  </div>
                )}
                {org.lastPaymentStatus === "failed" && (
                  <div className="col-span-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/25 text-xs text-rose-300">
                    <AlertTriangle size={12} className="shrink-0" /> Last payment failed — customer needs to update payment method
                  </div>
                )}
                {org.billingEmail && (
                  <div className="col-span-2">
                    <p className="text-[10px] text-stone-600 uppercase tracking-wider mb-1">Billing email</p>
                    <p className="text-xs text-stone-400">{org.billingEmail}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3 px-3 py-3 rounded-lg bg-amber-500/8 border border-amber-500/20">
                <AlertTriangle size={14} className="text-amber-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-amber-300">No subscription set up</p>
                  <p className="text-[11px] text-stone-500 mt-0.5">This organisation has no billing configured. Set it up in the subscriptions page.</p>
                </div>
                <Link href="/admin/subscriptions"
                  className="text-[11px] font-medium text-amber-400 hover:text-amber-200 flex items-center gap-1 shrink-0 transition-colors">
                  Set up <ArrowUpRight size={10} />
                </Link>
              </div>
            )}
          </div>

          <div className="border-t border-stone-800 px-5 pb-5">
            <div className="flex items-center justify-between mt-4 mb-3">
              <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
                Users in this organisation
              </div>
              <button onClick={() => { setShowAddUser(p => !p); setAddError(""); }}
                className="flex items-center gap-1 text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors">
                <Plus size={12} /> Add user
              </button>
            </div>

            {showAddUser && (
              <div className="mb-3 p-3 rounded-lg bg-stone-800/50 ring-1 ring-stone-700 space-y-2">
                <div className="text-xs font-semibold text-stone-400 mb-1">Add / link a user to this organisation</div>
                {addError && <div className="text-xs text-rose-400 bg-rose-500/10 px-2 py-1.5 rounded ring-1 ring-rose-500/30">{addError}</div>}
                <div className="grid grid-cols-2 gap-2">
                  <div className="relative">
                    <Input type="email" value={addForm.email} onChange={(e: any) => setAdd("email", e.target.value)} placeholder="email@company.com" />
                    {checkingAddEmail && <span className="absolute right-2 top-2.5 text-[10px] text-stone-400">checking…</span>}
                  </div>
                  <Input value={addForm.name} onChange={(e: any) => setAdd("name", e.target.value)} placeholder="Full name" disabled={addEmailExists} />
                </div>
                {addEmailExists && (
                  <div className="flex items-start gap-2 text-xs bg-blue-500/10 text-blue-300 px-2 py-1.5 rounded ring-1 ring-blue-500/30">
                    <Check size={12} className="mt-0.5 shrink-0" />
                    <span>User already exists — they will be linked to this organisation.</span>
                  </div>
                )}
                {!addEmailExists && (
                  <div className="relative">
                    <Input type={addShowPw ? "text" : "password"} value={addForm.password} onChange={(e: any) => setAdd("password", e.target.value)} placeholder="Temporary password (min 8 chars)" />
                    <button onClick={() => setAddShowPw(p => !p)} className="absolute right-3 top-2.5 text-stone-400 hover:text-stone-300">
                      {addShowPw ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <select value={addForm.role} onChange={(e: any) => setAdd("role", e.target.value)}
                    className="flex-1 h-9 px-3 text-sm rounded-md ring-1 ring-stone-700 focus:ring-emerald-500 focus:outline-none bg-stone-800 text-stone-300">
                    <option value="company_admin">Company Admin</option>
                    <option value="company_user">User</option>
                  </select>
                  <Button variant="secondary" size="sm" onClick={() => setShowAddUser(false)}>Cancel</Button>
                  <Button size="sm" onClick={handleAddUser}
                    disabled={addingUser || !addForm.email || (!addEmailExists && !addForm.name)}>
                    {addingUser ? "Adding…" : addEmailExists ? "Link user" : "Add user"}
                  </Button>
                </div>
              </div>
            )}

            {usersLoading ? (
              <div className="flex items-center gap-2 text-sm text-stone-400 py-3">
                <Loader2 size={14} className="animate-spin" /> Loading users…
              </div>
            ) : users.length === 0 ? (
              <div className="text-sm text-stone-400 py-3">No users yet. Use "Add user" above to get started.</div>
            ) : (
              <div className="space-y-2">
                {userError && <div className="text-sm text-rose-400 bg-rose-500/10 px-3 py-2 rounded ring-1 ring-rose-500/30">{userError}</div>}
                {users.map(u => (
                  <div key={u.id} className="rounded-lg ring-1 ring-stone-700 overflow-hidden">
                    {editingUser === u.id ? (
                      <div className="p-3 space-y-2 bg-stone-800/60">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Name</label>
                            <Input value={editForm.name} onChange={(e: any) => setEditForm(p => ({ ...p, name: e.target.value }))} placeholder="Full name" />
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Email</label>
                            <Input type="email" value={editForm.email} onChange={(e: any) => setEditForm(p => ({ ...p, email: e.target.value }))} placeholder="email@company.com" />
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Role</label>
                          <select value={editForm.role} onChange={(e: any) => setEditForm(p => ({ ...p, role: e.target.value }))}
                            className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-700 focus:ring-emerald-500 focus:outline-none bg-stone-800 text-stone-300">
                            <option value="company_user">User</option>
                            <option value="company_admin">Company Admin</option>
                          </select>
                        </div>
                        <div className="flex gap-2 justify-end">
                          <Button variant="secondary" size="sm" onClick={() => setEditingUser(null)}>Cancel</Button>
                          <Button size="sm" onClick={() => saveUser(u.id)} disabled={savingUser}>
                            {savingUser ? "Saving…" : "Save"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 px-3 py-2.5">
                        <div className="w-8 h-8 rounded-full bg-stone-700 flex items-center justify-center text-stone-300 text-xs font-semibold shrink-0">
                          {u.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-white truncate">{u.name}</div>
                          <div className="text-[11px] text-stone-400 truncate">{u.email}</div>
                        </div>
                        <RoleBadge role={u.role} />
                        <StatusBadge status={u.status} />
                        <button onClick={() => startEditUser(u)}
                          className="p-1.5 hover:bg-stone-800 rounded text-stone-400 hover:text-stone-200 transition-colors shrink-0"
                          title="Edit user">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => removeUser(u.id, u.name)}
                          className="p-1.5 hover:bg-rose-500/15 rounded text-stone-400 hover:text-rose-400 transition-colors shrink-0"
                          title="Remove from this organisation">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-stone-800 flex justify-end shrink-0">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// DELETE ORG MODAL (Super Admin only)
// ============================================================
export function DeleteOrgModal({ org, onClose, onDeleted }: { org: any; onClose: () => void; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const canDelete = confirm.trim().toLowerCase() === org.name.trim().toLowerCase();

  const handleDelete = async () => {
    if (!canDelete) return;
    setDeleting(true); setError("");
    try {
      const res = await fetch(`/api/admin/organisations?orgId=${org.id}&confirmName=${encodeURIComponent(org.name)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to delete"); return; }
      onDeleted();
      onClose();
    } finally { setDeleting(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-stone-900 rounded-xl w-full max-w-md shadow-xl ring-1 ring-rose-500/30">
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-rose-500/15 flex items-center justify-center">
              <AlertTriangle size={15} className="text-rose-400" />
            </div>
            <h2 className="font-semibold text-white">Delete organisation</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-white"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-rose-500/10 ring-1 ring-rose-500/30 rounded-lg px-4 py-3 text-sm text-rose-300 space-y-1">
            <p className="font-semibold">This action is permanent and cannot be undone.</p>
            <p className="text-rose-400/80 text-xs">All data will be deleted — customers, invoices, contacts, collections, users, email history, integrations, and settings.</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-2">
              Type <span className="text-white font-mono">{org.name}</span> to confirm
            </label>
            <input
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder={org.name}
              className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-300 placeholder-stone-600 focus:ring-rose-500 focus:outline-none"
            />
          </div>
          {error && <div className="text-sm text-rose-400 bg-rose-500/10 px-3 py-2 rounded ring-1 ring-rose-500/30">{error}</div>}
        </div>
        <div className="px-5 py-3 border-t border-stone-800 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <button
            onClick={handleDelete}
            disabled={!canDelete || deleting}
            className="h-9 px-4 text-sm font-semibold rounded-lg transition-colors bg-rose-600 hover:bg-rose-500 disabled:bg-stone-700 disabled:text-stone-500 text-white"
          >
            {deleting ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}
