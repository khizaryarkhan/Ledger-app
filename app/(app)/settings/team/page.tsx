"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useData } from "@/components/data-provider";
import { Card, Button } from "@/components/ui";
import {
  ChevronLeft, Users, Plus, Trash2, Shield, UserPlus,
  ChevronDown, Briefcase, X, MapPin, KeyRound,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
type TeamUser = {
  id: string;
  orgId: string;
  name: string;
  email: string;
  role: string;
  repId: string | null;
  repTier: string | null;
  repManagerId: string | null;
  status: string;
  createdAt: string;
};

function virtualRole(u: TeamUser): string {
  if (u.role === "rep") return (u.repTier === "ed" || u.repTier === "rd") ? "ed" : "rep";
  return u.role;
}

const ROLE_LABEL: Record<string, string> = {
  company_admin: "Admin",
  company_user:  "Full Access",
  rep:           "Rep / PM",
  ed:            "ED / RM",
  super_admin:   "Super Admin",
};

const ROLE_COLOR: Record<string, string> = {
  company_admin: "bg-violet-500/15 text-violet-400 ring-violet-500/30",
  company_user:  "bg-blue-500/15 text-blue-400 ring-blue-500/30",
  rep:           "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30",
  ed:            "bg-orange-500/15 text-orange-400 ring-orange-500/30",
  super_admin:   "bg-rose-500/15 text-rose-400 ring-rose-500/30",
};

// ── Dropdown that closes on outside click ──────────────────────────────────────
function PopoverMenu({ trigger, children }: { trigger: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <div onClick={() => setOpen(p => !p)}>{trigger}</div>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-[200] bg-stone-900 rounded-lg shadow-xl ring-1 ring-stone-700 py-1 min-w-[150px]"
          onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function TeamSettingsPage() {
  const { data: session } = useSession();
  const { regions, addRegion, deleteRegion, updateRepManager, refresh } = useData();

  const currentUserId = (session?.user as any)?.id;
  const sessionRole   = (session?.user as any)?.role;
  const isAdmin = sessionRole === "company_admin" || sessionRole === "super_admin";
  const isSuper = sessionRole === "super_admin";

  // ── Users ─────────────────────────────────────────────────────────────────────
  const [members,        setMembers]        = useState<TeamUser[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  const loadMembers = async () => {
    setLoadingMembers(true);
    try {
      const res = await fetch("/api/org/users");
      if (res.ok) setMembers(await res.json());
    } finally { setLoadingMembers(false); }
  };
  useEffect(() => {
    if (isAdmin) {
      loadMembers();
      refresh(); // Sync DataProvider so rep filter dropdowns across the app are up to date
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // ── Create user ───────────────────────────────────────────────────────────────
  const [newUser,     setNewUser]     = useState({ name: "", email: "", password: "", role: "company_user" });
  const [addingUser,  setAddingUser]  = useState(false);
  const [createError, setCreateError] = useState("");

  const createUser = async () => {
    setCreateError("");
    if (!newUser.name.trim())             { setCreateError("Name is required"); return; }
    if (!/.+@.+\..+/.test(newUser.email)) { setCreateError("Valid email required"); return; }
    if (newUser.password.length < 8)      { setCreateError("Password must be 8+ characters"); return; }
    setAddingUser(true);
    try {
      const res  = await fetch("/api/org/users", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      });
      const data = await res.json();
      if (!res.ok) { setCreateError(data?.error || "Failed to create user"); return; }
      setNewUser({ name: "", email: "", password: "", role: "company_user" });
      await loadMembers();
      // Refresh DataProvider so new rep/ed immediately appears in project/customer dropdowns
      if (["rep", "ed"].includes(newUser.role)) await refresh();
    } finally { setAddingUser(false); }
  };

  // ── User actions ──────────────────────────────────────────────────────────────
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [roleSaving,    setRoleSaving]    = useState<string | null>(null);
  const [managerSaving, setManagerSaving] = useState<string | null>(null);

  const toggleStatus = async (m: TeamUser) => {
    await fetch("/api/org/users", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: m.id, status: m.status === "Active" ? "Inactive" : "Active" }),
    });
    await loadMembers();
  };

  const changeRole = async (m: TeamUser, newVirtualRole: string) => {
    setRoleSaving(m.id);
    try {
      await fetch("/api/org/users", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: m.id, role: newVirtualRole }),
      });
      await loadMembers();
      // Refresh DataProvider when a user gains or loses a rep/ed role
      const prevVRole = virtualRole(m);
      const repRoles  = ["rep", "ed"];
      if (repRoles.includes(newVirtualRole) || repRoles.includes(prevVRole)) await refresh();
    } finally { setRoleSaving(null); }
  };

  const deleteUser = async (userId: string) => {
    await fetch(`/api/org/users?userId=${userId}`, { method: "DELETE" });
    setConfirmDelete(null);
    await loadMembers();
  };

  // ── Password reset (admin) ──────────────────────────────────────────────────
  const [pwUser,   setPwUser]   = useState<string | null>(null); // open panel for this user
  const [pwValue,  setPwValue]  = useState("");
  const [pwBusy,   setPwBusy]   = useState(false);
  const [pwMsg,    setPwMsg]    = useState<{ id: string; text: string; ok: boolean } | null>(null);

  const openPwPanel = (id: string) => { setPwUser(p => p === id ? null : id); setPwValue(""); setPwMsg(null); };

  const resetPassword = async (m: TeamUser, mode: "link" | "set") => {
    if (mode === "set" && pwValue.trim().length < 8) {
      setPwMsg({ id: m.id, text: "Password must be at least 8 characters.", ok: false });
      return;
    }
    setPwBusy(true);
    try {
      const res = await fetch("/api/org/users/reset-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: m.id, mode, password: mode === "set" ? pwValue : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setPwMsg({ id: m.id, text: data.error || "Failed", ok: false }); return; }
      setPwMsg({ id: m.id, text: mode === "link" ? `Reset link sent to ${m.email}.` : "Password updated.", ok: true });
      setPwValue("");
    } finally { setPwBusy(false); }
  };

  const addReportee = async (repUser: TeamUser, edRepId: string) => {
    if (!repUser.repId) return;
    setManagerSaving(repUser.id);
    try {
      await updateRepManager(repUser.repId, edRepId);
      await loadMembers();
    } finally { setManagerSaving(null); }
  };

  const removeReportee = async (repUser: TeamUser) => {
    if (!repUser.repId) return;
    setManagerSaving(repUser.id);
    try {
      await updateRepManager(repUser.repId, null);
      await loadMembers();
    } finally { setManagerSaving(null); }
  };

  // ── Regions ───────────────────────────────────────────────────────────────────
  const [newRegion,    setNewRegion]    = useState("");
  const [addingRegion, setAddingRegion] = useState(false);

  const handleAddRegion = async () => {
    if (!newRegion.trim()) return;
    setAddingRegion(true);
    try {
      await addRegion({ name: newRegion.trim() });
      setNewRegion("");
    } finally { setAddingRegion(false); }
  };

  // ── Derived ───────────────────────────────────────────────────────────────────
  const visible    = members.filter(m => m.role !== "super_admin");
  const repPmUsers = members.filter(m => virtualRole(m) === "rep");
  const edRmUsers  = members.filter(m => virtualRole(m) === "ed");

  return (
    <div className="p-6 max-w-[820px] mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link href="/settings"
          className="inline-flex items-center gap-1 text-[13px] text-stone-500 hover:text-stone-200 mb-3 transition-colors">
          <ChevronLeft size={14} /> Settings
        </Link>
        <h1 className="text-2xl font-semibold text-white tracking-tight">Team</h1>
        <p className="text-sm text-stone-400 mt-1">Manage users, access levels and regions.</p>
      </div>

      {/* ── Role overview ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {[
          { icon: Shield,    color: "text-violet-500",  label: "Admin",       desc: "Full access — can create, edit and delete any user or data." },
          { icon: Users,     color: "text-blue-500",    label: "Full Access", desc: "Can do everything except create or delete users." },
          { icon: Briefcase, color: "text-emerald-500", label: "Rep / PM",    desc: "Portal login — sees only projects assigned to them." },
          { icon: Shield,    color: "text-orange-500",  label: "ED / RM",     desc: "Portal login — sees all projects for Reps reporting to them." },
        ].map(({ icon: Icon, color, label, desc }) => (
          <div key={label} className="flex items-start gap-3 p-3 rounded-lg bg-stone-800/40 ring-1 ring-stone-700">
            <Icon size={15} className={`${color} shrink-0 mt-0.5`} />
            <div>
              <div className="text-sm font-semibold text-white">{label}</div>
              <div className="text-[11px] text-stone-500 mt-0.5 leading-relaxed">{desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Users list ─────────────────────────────────────────────────────────── */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <UserPlus size={15} className="text-stone-400" />
          <h3 className="text-sm font-semibold text-white">Users</h3>
          <span className="ml-auto text-[11px] text-stone-400">{visible.length}</span>
        </div>
        <p className="text-[12px] text-stone-500 mb-4">
          All team members. Rep / PM and ED / RM users get portal access and appear in project assignment dropdowns.
        </p>

        <div className="space-y-2 mb-5">
          {loadingMembers && <div className="text-sm text-stone-400 py-2">Loading…</div>}
          {!loadingMembers && visible.length === 0 && (
            <div className="text-sm text-stone-400 py-2">No users yet.</div>
          )}

          {visible.map(m => {
            const vRole    = virtualRole(m);
            const canEdit  = isAdmin && m.id !== currentUserId && m.role !== "super_admin";
            const isActive = m.status === "Active";

            // ED/RM: find reps reporting to this ED
            const reporteeUsers = vRole === "ed" && m.repId
              ? repPmUsers.filter(r => r.repManagerId === m.repId)
              : [];

            // Reps not yet assigned to any ED (can be added to this ED)
            const addableReps = vRole === "ed" && m.repId
              ? repPmUsers.filter(r => !r.repManagerId)
              : [];

            return (
              <div key={m.id}
                className={`rounded-lg ring-1 px-3 py-2.5 space-y-2 ${isActive ? "bg-stone-900 ring-stone-700" : "bg-stone-800/40 ring-stone-700 opacity-60"}`}>

                {/* Main row */}
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-stone-700 flex items-center justify-center text-[11px] font-semibold text-stone-300 shrink-0">
                    {m.name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-white truncate">{m.name}</span>

                      {/* Role badge — click dropdown for admins */}
                      {canEdit ? (
                        <PopoverMenu
                          trigger={
                            <button
                              className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded ring-1 cursor-pointer ${ROLE_COLOR[vRole] || "bg-stone-100 text-stone-600 ring-stone-200"} ${roleSaving === m.id ? "opacity-50 pointer-events-none" : ""}`}>
                              {ROLE_LABEL[vRole] || vRole}
                              <ChevronDown size={9} />
                            </button>
                          }>
                          {[
                            { v: "company_user", label: "Full Access" },
                            { v: "company_admin", label: "Admin" },
                            { v: "rep", label: "Rep / PM" },
                            { v: "ed",  label: "ED / RM" },
                          ].map(({ v, label }) => (
                            <button key={v} onClick={() => changeRole(m, v)}
                              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-stone-800 transition-colors ${vRole === v ? "font-semibold text-white" : "text-stone-400"}`}>
                              {label}
                            </button>
                          ))}
                        </PopoverMenu>
                      ) : (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ring-1 ${ROLE_COLOR[vRole] || "bg-stone-100 text-stone-600 ring-stone-200"}`}>
                          {ROLE_LABEL[vRole] || vRole}
                        </span>
                      )}

                      {!isActive && <span className="text-[10px] text-stone-400 italic">Inactive</span>}
                    </div>
                    <div className="text-[11px] text-stone-500">{m.email}</div>
                  </div>

                  {canEdit && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => openPwPanel(m.id)} title="Reset password"
                        className={`p-1.5 rounded ring-1 transition-colors ${pwUser === m.id ? "ring-emerald-600 text-emerald-400 bg-emerald-500/10" : "ring-stone-700 text-stone-400 hover:bg-stone-800"}`}>
                        <KeyRound size={13} />
                      </button>
                      <button onClick={() => toggleStatus(m)}
                        className="text-[11px] px-2 py-1 rounded ring-1 ring-stone-700 text-stone-400 hover:bg-stone-800 transition-colors">
                        {isActive ? "Deactivate" : "Activate"}
                      </button>
                      {confirmDelete === m.id ? (
                        <div className="flex items-center gap-1">
                          <span className="text-[11px] text-rose-400 font-medium">Sure?</span>
                          <button onClick={() => deleteUser(m.id)}
                            className="text-[11px] px-2 py-1 rounded bg-rose-600 text-white hover:bg-rose-700">Yes</button>
                          <button onClick={() => setConfirmDelete(null)}
                            className="text-[11px] px-2 py-1 rounded ring-1 ring-stone-700 text-stone-500 hover:bg-stone-800">No</button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmDelete(m.id)}
                          className="p-1.5 text-stone-400 hover:text-rose-600 rounded transition-colors">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Reset-password panel */}
                {canEdit && pwUser === m.id && (
                  <div className="mt-2 pl-11 space-y-2">
                    <div className="rounded-lg ring-1 ring-stone-700 bg-stone-900/60 p-3 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] font-medium text-stone-200">Reset password for {m.name}</span>
                        <button onClick={() => setPwUser(null)} className="text-stone-500 hover:text-stone-300"><X size={13} /></button>
                      </div>
                      {/* Option 1 — email a reset link */}
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[11px] text-stone-400">Email <span className="text-stone-300">{m.email}</span> a secure 1-hour reset link. They set their own password.</div>
                        <button onClick={() => resetPassword(m, "link")} disabled={pwBusy}
                          className="shrink-0 text-[11px] font-semibold px-2.5 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                          Send reset link
                        </button>
                      </div>
                      <div className="border-t border-stone-800" />
                      {/* Option 2 — set a password manually */}
                      <div>
                        <div className="text-[11px] text-stone-400 mb-1.5">Or set a password manually (for users without working email) — share it securely and ask them to change it.</div>
                        <div className="flex items-center gap-1.5">
                          <input type="text" value={pwValue} onChange={e => setPwValue(e.target.value)} placeholder="New password (min 8 chars)"
                            className="flex-1 text-[12px] border border-stone-700 rounded px-2.5 py-1.5 bg-stone-800 text-stone-200 placeholder-stone-600 outline-none focus:ring-1 focus:ring-emerald-500 font-mono" />
                          <button onClick={() => resetPassword(m, "set")} disabled={pwBusy || pwValue.trim().length < 8}
                            className="shrink-0 text-[11px] font-semibold px-2.5 py-1.5 rounded ring-1 ring-stone-600 text-stone-200 hover:bg-stone-800 disabled:opacity-50">
                            Set password
                          </button>
                        </div>
                      </div>
                      {pwMsg && pwMsg.id === m.id && (
                        <div className={`text-[11px] ${pwMsg.ok ? "text-emerald-400" : "text-rose-400"}`}>{pwMsg.text}</div>
                      )}
                    </div>
                  </div>
                )}

                {/* ED/RM: Reporting reps section */}
                {vRole === "ed" && isAdmin && (
                  <div className="pl-11 space-y-1.5">
                    <div className="text-[11px] text-stone-400 font-medium">Reporting Reps / PMs</div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {reporteeUsers.map(r => (
                        <span key={r.id}
                          className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30">
                          <Briefcase size={9} />
                          {r.name}
                          <button
                            disabled={managerSaving === r.id}
                            onClick={() => removeReportee(r)}
                            className="ml-0.5 text-emerald-400 hover:text-rose-600 transition-colors disabled:opacity-40">
                            <X size={9} />
                          </button>
                        </span>
                      ))}

                      {/* Add reportee — state-driven popover */}
                      {addableReps.length > 0 && (
                        <PopoverMenu
                          trigger={
                            <button className="inline-flex items-center gap-0.5 text-[11px] px-2 py-0.5 rounded-full ring-1 ring-dashed ring-stone-600 text-stone-500 hover:ring-stone-400 hover:text-stone-300 transition-colors cursor-pointer">
                              <Plus size={9} /> Add
                            </button>
                          }>
                          {addableReps.map(r => (
                            <button key={r.id}
                              disabled={managerSaving === r.id}
                              onClick={() => m.repId && addReportee(r, m.repId)}
                              className="w-full text-left px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-800 transition-colors disabled:opacity-40">
                              {r.name}
                            </button>
                          ))}
                        </PopoverMenu>
                      )}

                      {reporteeUsers.length === 0 && addableReps.length === 0 && (
                        <span className="text-[11px] text-stone-400 italic">No reps assigned yet</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Add User form */}
        {isAdmin && (
          <div className="pt-4 border-t border-stone-800">
            <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-3">Add user</div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input value={newUser.name} onChange={e => setNewUser({ ...newUser, name: e.target.value })}
                placeholder="Full name *"
                className="h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-300 placeholder-stone-600 focus:ring-2 focus:ring-emerald-500 focus:outline-none" />
              <input value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                placeholder="Email *"
                className="h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-300 placeholder-stone-600 focus:ring-2 focus:ring-emerald-500 focus:outline-none" />
              <input type="password" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                placeholder="Password (8+ chars) *"
                className="h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-300 placeholder-stone-600 focus:ring-2 focus:ring-emerald-500 focus:outline-none" />
              <select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}
                className="h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none">
                <option value="company_user">Full Access</option>
                <option value="company_admin">Admin</option>
                <option value="rep">Rep / PM</option>
                <option value="ed">ED / RM</option>
              </select>
            </div>
            {createError && (
              <div className="text-xs text-rose-400 bg-rose-500/10 ring-1 ring-rose-500/30 rounded px-2 py-1.5 mb-2">{createError}</div>
            )}
            <Button size="sm" icon={Plus} disabled={addingUser} onClick={createUser}>
              {addingUser ? "Adding…" : "Add user"}
            </Button>
            <p className="text-[10px] text-stone-400 mt-1.5">
              Rep / PM and ED / RM users get portal access — share the email + password with them.
            </p>
          </div>
        )}
      </Card>

      {/* ── Regions ────────────────────────────────────────────────────────────── */}
      <Card>
        <div className="flex items-center gap-2 mb-1">
          <MapPin size={15} className="text-stone-400" />
          <h3 className="text-sm font-semibold text-white">Regions</h3>
          <span className="ml-auto text-[11px] text-stone-400">{(regions ?? []).length}</span>
        </div>
        <p className="text-[12px] text-stone-500 mb-4">
          Geographic regions for grouping customers and projects.
        </p>

        <div className="space-y-1.5 mb-4">
          {(regions ?? []).length === 0 && (
            <div className="text-sm text-stone-400 py-1">No regions defined yet.</div>
          )}
          {(regions ?? []).map((r: any) => (
            <div key={r.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-stone-800/40 ring-1 ring-stone-700">
              <div className="flex items-center gap-2">
                <MapPin size={12} className="text-stone-400" />
                <span className="text-sm text-stone-200">{r.name}</span>
              </div>
              {isAdmin && (
                <button onClick={() => deleteRegion(r.id)}
                  className="p-1 text-stone-400 hover:text-rose-600 rounded transition-colors">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>

        {isAdmin && (
          <div className="flex gap-2 pt-3 border-t border-stone-800">
            <input value={newRegion} onChange={e => setNewRegion(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAddRegion()}
              placeholder="Region name"
              className="flex-1 h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-300 placeholder-stone-600 focus:ring-2 focus:ring-emerald-500 focus:outline-none" />
            <Button size="sm" icon={Plus} disabled={addingRegion || !newRegion.trim()} onClick={handleAddRegion}>
              {addingRegion ? "Adding…" : "Add"}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
