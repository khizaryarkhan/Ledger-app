"use client";

import { useEffect, useMemo, useState } from "react";
import { Network, Plus, Star, Trash2, Building2, Loader2, ChevronDown, ChevronRight, X } from "lucide-react";

type Member = { id: string; name: string; slug: string; status: string };
type Group = { id: string; name: string; currency: string; headOfficeOrgId: string | null; members: Member[] };
type Org = { id: string; name: string };

export default function GroupAccountsPage() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCurrency, setNewCurrency] = useState("EUR");
  const [busy, setBusy] = useState(false);

  async function load() {
    setError(null);
    try {
      const [g, o] = await Promise.all([
        fetch("/api/admin/org-groups").then((r) => r.json()),
        fetch("/api/admin/organisations").then((r) => r.json()),
      ]);
      if (g.error) throw new Error(g.error);
      setGroups(g);
      setOrgs(Array.isArray(o) ? o.map((x: any) => ({ id: x.id, name: x.name })) : []);
    } catch (e: any) {
      setError(e.message || "Failed to load groups");
      setGroups([]);
    }
  }
  useEffect(() => { load(); }, []);

  // Orgs not already in any group — the pool that can be added.
  const groupedIds = useMemo(() => new Set((groups ?? []).flatMap((g) => g.members.map((m) => m.id))), [groups]);
  const availableOrgs = useMemo(() => orgs.filter((o) => !groupedIds.has(o.id)).sort((a, b) => a.name.localeCompare(b.name)), [orgs, groupedIds]);

  async function createGroup() {
    if (!newName.trim()) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/admin/org-groups", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), currency: newCurrency }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to create group");
      setNewName(""); setNewCurrency("EUR"); setCreating(false);
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function addMember(groupId: string, orgId: string) {
    if (!orgId) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/admin/org-groups/${groupId}/members`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed to add");
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function removeMember(groupId: string, orgId: string) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/admin/org-groups/${groupId}/members?orgId=${orgId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed to remove");
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function setHeadOffice(groupId: string, orgId: string | null) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/admin/org-groups/${groupId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ headOfficeOrgId: orgId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed to update");
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function deleteGroup(groupId: string, name: string) {
    if (!confirm(`Delete the group "${name}"? Its branches are un-grouped but never deleted.`)) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/admin/org-groups/${groupId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed to delete");
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-emerald-500/15 flex items-center justify-center">
          <Network size={18} className="text-emerald-400" />
        </div>
        <h1 className="text-xl font-semibold text-stone-100">Group Accounts</h1>
      </div>
      <p className="text-sm text-stone-400 mb-6 ml-12">Group a Head Office and its branches under one account. Create a group, then map organisations into it. This structures the hierarchy — consolidated views build on top of it.</p>

      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error}</div>}

      {/* Create */}
      {creating ? (
        <div className="mb-6 p-4 rounded-xl bg-stone-900 border border-stone-800 flex flex-wrap items-end gap-3">
          <label className="text-[12px] text-stone-400">Group name
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Reddy Group"
              className="mt-1 block w-64 bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-100" />
          </label>
          <label className="text-[12px] text-stone-400">Currency
            <input value={newCurrency} onChange={(e) => setNewCurrency(e.target.value.toUpperCase())} maxLength={8}
              className="mt-1 block w-24 bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-100" />
          </label>
          <button onClick={createGroup} disabled={busy || !newName.trim()} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Create group
          </button>
          <button onClick={() => { setCreating(false); setNewName(""); }} className="px-3 py-2 rounded-lg text-stone-400 hover:text-stone-200 text-sm">Cancel</button>
        </div>
      ) : (
        <button onClick={() => setCreating(true)} className="mb-6 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-100 text-sm font-medium">
          <Plus size={15} /> New Group Account
        </button>
      )}

      {/* List */}
      {groups === null ? (
        <div className="text-sm text-stone-500 flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Loading…</div>
      ) : groups.length === 0 ? (
        <div className="text-sm text-stone-500 py-10 text-center border border-dashed border-stone-800 rounded-xl">No group accounts yet. Create one, then map branches into it.</div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const open = expanded.has(g.id);
            return (
              <div key={g.id} className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-stone-800/40" onClick={() => toggle(g.id)}>
                  {open ? <ChevronDown size={16} className="text-stone-500" /> : <ChevronRight size={16} className="text-stone-500" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-stone-100">{g.name}</div>
                    <div className="text-[12px] text-stone-500">{g.members.length} {g.members.length === 1 ? "organisation" : "organisations"} · {g.currency}</div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); deleteGroup(g.id, g.name); }} className="p-1.5 rounded-md text-stone-500 hover:text-rose-400 hover:bg-rose-500/10" title="Delete group"><Trash2 size={15} /></button>
                </div>

                {open && (
                  <div className="px-4 pb-4 pt-1 border-t border-stone-800">
                    {g.members.length === 0 ? (
                      <p className="text-[13px] text-stone-500 py-2">No organisations mapped yet — add one below.</p>
                    ) : (
                      <div className="divide-y divide-stone-800/70">
                        {g.members.map((m) => {
                          const isHO = g.headOfficeOrgId === m.id;
                          return (
                            <div key={m.id} className="flex items-center gap-3 py-2.5">
                              <Building2 size={15} className="text-stone-500 shrink-0" />
                              <span className="text-[13px] text-stone-200 flex-1 min-w-0 truncate">{m.name}</span>
                              {isHO && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 inline-flex items-center gap-1"><Star size={9} /> Head Office</span>}
                              <button onClick={() => setHeadOffice(g.id, isHO ? null : m.id)} disabled={busy}
                                className={`p-1.5 rounded-md ${isHO ? "text-emerald-400" : "text-stone-500 hover:text-emerald-400"} hover:bg-emerald-500/10`}
                                title={isHO ? "Unset Head Office" : "Set as Head Office"}>
                                <Star size={14} fill={isHO ? "currentColor" : "none"} />
                              </button>
                              <button onClick={() => removeMember(g.id, m.id)} disabled={busy} className="p-1.5 rounded-md text-stone-500 hover:text-rose-400 hover:bg-rose-500/10" title="Remove from group"><X size={15} /></button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Add member */}
                    <div className="mt-3 flex items-center gap-2">
                      <select
                        disabled={busy || availableOrgs.length === 0}
                        defaultValue=""
                        onChange={(e) => { if (e.target.value) { addMember(g.id, e.target.value); e.target.value = ""; } }}
                        className="text-[13px] bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-stone-200 disabled:opacity-50 max-w-xs">
                        <option value="">{availableOrgs.length === 0 ? "No un-grouped organisations left" : "+ Add organisation…"}</option>
                        {availableOrgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                      <span className="text-[11px] text-stone-600">Adding moves an org into this group.</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
