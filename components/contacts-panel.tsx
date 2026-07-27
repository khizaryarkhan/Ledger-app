"use client";

import { useState, useEffect, useRef } from "react";
import { Phone, Mail, Copy, Plus, Pencil, Trash2, Check, X, Users, ChevronDown } from "lucide-react";
import { useData } from "@/components/data-provider";

// ── Call-app registry ─────────────────────────────────────────────────────────
// Each entry maps to a URI scheme the OS can hand off to an installed app.
// WhatsApp needs digits-only (no +); Teams/Skype/FaceTime keep the full number.
type CallApp = { id: string; label: string; color: string; url: (phone: string) => string };

const CALL_APPS: CallApp[] = [
  {
    id: "phone",
    label: "Phone / Dialer",
    color: "text-emerald-400",
    url: p => `tel:${p}`,
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    color: "text-green-400",
    url: p => `https://wa.me/${p.replace(/\D/g, "")}`,
  },
  {
    id: "teams",
    label: "MS Teams",
    color: "text-blue-400",
    url: p => `msteams://l/call/0/0?users=4:${p}`,
  },
  {
    id: "skype",
    label: "Skype",
    color: "text-sky-400",
    url: p => `skype:${p}?call`,
  },
  {
    id: "facetime",
    label: "FaceTime",
    color: "text-stone-300",
    url: p => `facetime:${p}`,
  },
];

const CALL_PREF_KEY = "prime_call_app";

// App icons as inline SVGs (avoids external dependencies)
function AppIcon({ id, size = 14 }: { id: string; size?: number }) {
  if (id === "whatsapp") return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );
  if (id === "teams") return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.625 7.5h-4.5v1.875H18v6.75h-1.875V18H18a1.875 1.875 0 001.875-1.875v-6.75A1.875 1.875 0 0020.625 7.5zM9.375 7.5a3.375 3.375 0 100 6.75 3.375 3.375 0 000-6.75zm0 5.625a2.25 2.25 0 110-4.5 2.25 2.25 0 010 4.5zM14.625 4.5a2.625 2.625 0 100 5.25 2.625 2.625 0 000-5.25zm0 3.75a1.125 1.125 0 110-2.25 1.125 1.125 0 010 2.25zM3.75 13.5a.75.75 0 000 1.5h1.5v3.75A1.5 1.5 0 006.75 20.25h5.25a1.5 1.5 0 001.5-1.5V15h1.5a.75.75 0 000-1.5H3.75z"/>
    </svg>
  );
  if (id === "skype") return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.56 14.672c.07-.453.11-.916.11-1.388 0-4.534-3.674-8.209-8.208-8.209-.382 0-.76.027-1.13.077A4.974 4.974 0 0010.5 4.5a4.977 4.977 0 00-4.977 4.977c0 .85.214 1.65.592 2.35A8.235 8.235 0 001.44 9.57a8.209 8.209 0 008.209 8.209c.463 0 .916-.038 1.357-.112A4.977 4.977 0 0013.5 18.67a4.977 4.977 0 004.977-4.977 4.953 4.953 0 00-.917-2.92zM12 16.5c-2.76 0-4.5-1.35-4.5-2.7 0-.72.54-1.08 1.08-1.08.54 0 .9.36 1.17.72.45.72.99 1.08 2.25 1.08 1.17 0 2.07-.54 2.07-1.35 0-.63-.45-.99-1.53-1.26l-1.89-.45C8.91 10.89 8.1 10.08 8.1 8.7c0-1.98 1.8-3.15 4.05-3.15 2.34 0 3.87 1.17 3.87 2.52 0 .72-.54 1.08-1.08 1.08s-.81-.27-1.08-.63c-.36-.54-.9-.99-1.98-.99-1.08 0-1.8.54-1.8 1.26 0 .54.36.9 1.26 1.17l1.98.54c1.8.45 2.7 1.35 2.7 2.79 0 2.07-1.71 3.24-4.32 3.24z"/>
    </svg>
  );
  // Default: phone icon
  return <Phone size={size} />;
}

/**
 * Split-button for calling a contact.
 *
 * - Left side: calls via the last-used app immediately (or shows picker on first use)
 * - Right side (▾): always opens the app picker
 * - Preference is stored in localStorage so it persists across sessions
 */
function CallButton({ phone }: { phone: string }) {
  const [open, setOpen] = useState(false);
  const [pref, setPref] = useState<string | null>(null);
  // Fixed positioning to escape overflow:hidden/auto containers (e.g. board-list popovers)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const chevronRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { setPref(localStorage.getItem(CALL_PREF_KEY)); } catch {}
  }, []);

  // Close on outside click or scroll
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onMouseDown = (e: MouseEvent) => {
      if (
        dropRef.current && !dropRef.current.contains(e.target as Node) &&
        chevronRef.current && !chevronRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  const openPicker = () => {
    if (chevronRef.current) {
      const r = chevronRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
    setOpen(v => !v);
  };

  // Anchor-click is more reliable than window.open for custom URL schemes (tel:, msteams://, etc.)
  const launch = (app: CallApp) => {
    const a = document.createElement("a");
    a.href = app.url(phone);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    try { localStorage.setItem(CALL_PREF_KEY, app.id); } catch {}
    setPref(app.id);
    setOpen(false);
  };

  const preferred = CALL_APPS.find(a => a.id === pref) ?? null;

  return (
    <div className="relative inline-flex items-center">
      {/* Main call button */}
      <button
        type="button"
        onClick={() => preferred ? launch(preferred) : openPicker()}
        title={preferred ? `Call via ${preferred.label}` : "Choose calling app"}
        className="flex items-center gap-1 text-[12px] text-stone-200 hover:text-white font-mono pr-0.5 transition-colors"
      >
        <Phone size={11} className="text-stone-500 shrink-0" />
        {phone}
      </button>
      {/* Dropdown arrow */}
      <button
        ref={chevronRef}
        type="button"
        onClick={openPicker}
        title="Choose calling app"
        className="p-0.5 text-stone-600 hover:text-stone-300 transition-colors"
      >
        <ChevronDown size={11} />
      </button>

      {/* App picker — fixed to viewport so it escapes overflow clipping */}
      {open && pos && (
        <div
          ref={dropRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999 }}
          className="w-48 bg-stone-900 border border-stone-700 rounded-lg shadow-2xl overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-stone-800">
            <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider">Call via…</div>
          </div>
          {CALL_APPS.map(app => (
            <button
              key={app.id}
              type="button"
              onClick={() => launch(app)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-[12px] hover:bg-stone-800 transition-colors text-left ${
                pref === app.id ? "text-white bg-stone-800/60" : "text-stone-300"
              }`}
            >
              <span className={`shrink-0 ${app.color}`}>
                <AppIcon id={app.id} size={14} />
              </span>
              {app.label}
              {pref === app.id && <Check size={11} className="ml-auto text-emerald-400" />}
            </button>
          ))}
          <div className="px-3 py-1.5 border-t border-stone-800 text-[10px] text-stone-600">
            Your preference is remembered
          </div>
        </div>
      )}
    </div>
  );
}

const TYPES = ["Billing", "Finance", "Project", "Escalation", "Legal", "Other"];

// Must be literal class strings — no runtime concatenation (Tailwind scanner requirement)
const TYPE_COLOR: Record<string, string> = {
  Billing:    "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20",
  Finance:    "text-blue-400 bg-blue-500/10 border border-blue-500/20",
  Project:    "text-purple-400 bg-purple-500/10 border border-purple-500/20",
  Escalation: "text-rose-400 bg-rose-500/10 border border-rose-500/20",
  Legal:      "text-amber-400 bg-amber-500/10 border border-amber-500/20",
  Other:      "text-stone-400 bg-stone-500/10 border border-stone-500/20",
};

const initials = (name: string) =>
  name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();

type CF = {
  name: string; title: string; email: string; phone: string;
  type: string; isPrimary: boolean; isEscalation: boolean; receivesAuto: boolean;
};
const blank = (): CF => ({
  name: "", title: "", email: "", phone: "",
  type: "Billing", isPrimary: false, isEscalation: false, receivesAuto: true,
});

function ContactForm({
  value, onChange, onSubmit, onCancel, saving, submitLabel,
}: {
  value: CF;
  onChange: (v: CF) => void;
  onSubmit: () => void;
  onCancel: () => void;
  saving: boolean;
  submitLabel: string;
}) {
  const set = (k: keyof CF) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange({ ...value, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });

  return (
    <div className="rounded-lg border border-stone-700 bg-stone-800/60 p-3 space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] font-medium text-stone-500">Name *</label>
          <input value={value.name} onChange={set("name")} placeholder="Jane Smith" autoFocus
            className="w-full mt-0.5 text-[12px] border border-stone-700 rounded px-2 py-1.5 bg-stone-900 text-stone-200 outline-none focus:ring-1 focus:ring-emerald-500 placeholder:text-stone-600" />
        </div>
        <div>
          <label className="text-[10px] font-medium text-stone-500">Title / Role</label>
          <input value={value.title} onChange={set("title")} placeholder="Finance Manager"
            className="w-full mt-0.5 text-[12px] border border-stone-700 rounded px-2 py-1.5 bg-stone-900 text-stone-200 outline-none focus:ring-1 focus:ring-emerald-500 placeholder:text-stone-600" />
        </div>
      </div>
      <div>
        <label className="text-[10px] font-medium text-stone-500">Email *</label>
        <input type="email" value={value.email} onChange={set("email")} placeholder="jane@company.com"
          className="w-full mt-0.5 text-[12px] border border-stone-700 rounded px-2 py-1.5 bg-stone-900 text-stone-200 outline-none focus:ring-1 focus:ring-emerald-500 placeholder:text-stone-600" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] font-medium text-stone-500">Phone</label>
          <input value={value.phone} onChange={set("phone")} placeholder="+1 555 000 0000"
            className="w-full mt-0.5 text-[12px] border border-stone-700 rounded px-2 py-1.5 bg-stone-900 text-stone-200 outline-none focus:ring-1 focus:ring-emerald-500 placeholder:text-stone-600" />
        </div>
        <div>
          <label className="text-[10px] font-medium text-stone-500">Type</label>
          <select value={value.type} onChange={set("type")}
            className="w-full mt-0.5 text-[12px] border border-stone-700 rounded px-2 py-1.5 bg-stone-900 text-stone-200 outline-none focus:ring-1 focus:ring-emerald-500">
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {(["isPrimary", "isEscalation", "receivesAuto"] as const).map(k => {
          const label = k === "isPrimary" ? "Primary" : k === "isEscalation" ? "Escalation" : "Receives emails";
          return (
            <label key={k} className="flex items-center gap-1.5 text-[11px] text-stone-400 cursor-pointer select-none">
              <input type="checkbox" checked={value[k] as boolean}
                onChange={e => onChange({ ...value, [k]: e.target.checked })}
                className="rounded border-stone-600 accent-emerald-500" />
              {label}
            </label>
          );
        })}
      </div>
      <div className="flex items-center gap-2 justify-end pt-0.5">
        <button onClick={onCancel} className="text-[11px] text-stone-500 hover:text-stone-300 px-2 py-1">Cancel</button>
        <button onClick={onSubmit} disabled={saving || !value.name.trim() || !value.email.trim()}
          className="text-[11px] font-semibold bg-emerald-600 text-white rounded px-3 py-1.5 hover:bg-emerald-700 disabled:opacity-40 transition-colors">
          {saving ? "Saving…" : submitLabel}
        </button>
      </div>
    </div>
  );
}

function ContactCard({
  c, onEdit, onDelete, copiedId, onCopy,
}: {
  c: any;
  onEdit: () => void;
  onDelete: () => void;
  copiedId: string | null;
  onCopy: (text: string, id: string) => void;
}) {
  return (
    <div className="rounded-lg border border-stone-800 bg-stone-800/30 overflow-hidden group">
      <div className="p-3 flex items-start gap-2.5">
        {/* Avatar */}
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 select-none ${
          c.isPrimary ? "bg-emerald-800 text-emerald-100" : "bg-stone-700 text-stone-300"
        }`}>
          {initials(c.name)}
        </div>

        <div className="flex-1 min-w-0">
          {/* Name + badges */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[13px] font-semibold text-stone-100 leading-tight">{c.name}</span>
            {c.isPrimary && (
              <span className="text-[10px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-1.5 py-0.5 leading-none">Primary</span>
            )}
            {c.isEscalation && (
              <span className="text-[10px] font-medium text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded px-1.5 py-0.5 leading-none">Escalation</span>
            )}
            <span className={`text-[10px] font-medium rounded px-1.5 py-0.5 leading-none ${TYPE_COLOR[c.type] ?? TYPE_COLOR.Other}`}>
              {c.type}
            </span>
          </div>

          {/* Title */}
          {c.title && <div className="text-[11px] text-stone-500 mt-0.5 truncate">{c.title}</div>}

          {/* Phone — split button: click number to call, ▾ to choose app */}
          {c.phone && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <CallButton phone={c.phone} />
              <button onClick={() => onCopy(c.phone, `phone-${c.id}`)} title="Copy phone number"
                className="text-stone-600 hover:text-stone-300 transition-colors ml-0.5">
                {copiedId === `phone-${c.id}` ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
              </button>
            </div>
          )}

          {/* Email */}
          <div className="flex items-center gap-1.5 mt-1">
            <Mail size={11} className="text-stone-500 shrink-0" />
            <a href={`mailto:${c.email}`} className="text-[12px] text-stone-400 hover:text-stone-200 truncate transition-colors">{c.email}</a>
            <button onClick={() => onCopy(c.email, `email-${c.id}`)} title="Copy email"
              className="text-stone-600 hover:text-stone-300 transition-colors flex-shrink-0 ml-0.5">
              {copiedId === `email-${c.id}` ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
            </button>
          </div>
        </div>

        {/* Edit / Delete (visible on hover) */}
        <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button onClick={onEdit} title="Edit contact"
            className="p-1 text-stone-500 hover:text-stone-200 rounded hover:bg-stone-700 transition-colors">
            <Pencil size={12} />
          </button>
          <button onClick={onDelete} title="Remove contact"
            className="p-1 text-stone-500 hover:text-rose-400 rounded hover:bg-stone-700 transition-colors">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Reusable contacts panel.
 *
 * Used in:
 *  - Invoice detail page: comms tab sidebar (full CRUD, phone + email copy)
 *  - Invoice detail page: overview tab contacts card
 *  - Collections Board: per-row contacts popover
 *  - Customer detail page: contacts tab (existing page can import this)
 *
 * Reads contacts from useData() so no prop drilling needed — just pass
 * customerId and optionally projectId to scope the view.
 */
export function ContactsPanel({
  customerId,
  projectId,
}: {
  customerId: string;
  projectId?: string | null;
}) {
  const { contacts, addContact, refresh, toast } = useData() as any;

  const allForCustomer: any[] = (contacts ?? []).filter((c: any) => c.customerId === customerId);
  const projContacts = projectId ? allForCustomer.filter(c => c.projectId === projectId) : [];
  const compContacts = allForCustomer.filter(c => !c.projectId);

  const sort = (arr: any[]) =>
    [...arr].sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const [addFor, setAddFor] = useState<"project" | "company" | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [addForm, setAddForm] = useState<CF>(blank());
  const [editForm, setEditForm] = useState<CF>(blank());
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedId(id);
    toast?.("Copied");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleAdd = async (forProject: boolean) => {
    setSaving(true);
    try {
      await addContact({
        customerId,
        ...(forProject && projectId ? { projectId } : {}),
        name: addForm.name.trim(),
        title: addForm.title.trim() || undefined,
        email: addForm.email.trim(),
        phone: addForm.phone.trim() || undefined,
        type: addForm.type,
        isPrimary: addForm.isPrimary,
        isEscalation: addForm.isEscalation,
        receivesAuto: addForm.receivesAuto,
      });
      toast?.("Contact added");
      setAddForm(blank());
      setAddFor(null);
      refresh();
    } catch {
      toast?.("Failed to add contact", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (id: string) => {
    setSaving(true);
    try {
      await fetch(`/api/contacts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name.trim(),
          title: editForm.title.trim() || null,
          email: editForm.email.trim(),
          phone: editForm.phone.trim() || null,
          type: editForm.type,
          isPrimary: editForm.isPrimary,
          isEscalation: editForm.isEscalation,
          receivesAuto: editForm.receivesAuto,
        }),
      });
      toast?.("Contact updated");
      setEditId(null);
      refresh();
    } catch {
      toast?.("Failed to update contact", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Remove ${name}?`)) return;
    await fetch(`/api/contacts/${id}`, { method: "DELETE" });
    toast?.("Contact removed");
    refresh();
  };

  const openEdit = (c: any) => {
    setEditId(c.id);
    setEditForm({
      name: c.name, title: c.title ?? "", email: c.email,
      phone: c.phone ?? "", type: c.type ?? "Billing",
      isPrimary: c.isPrimary, isEscalation: c.isEscalation, receivesAuto: c.receivesAuto,
    });
  };

  // Defined as a plain function (not a JSX component) so React never treats it as
  // a separate component type — avoids unmount/remount on every state change which
  // would cause autoFocus to re-fire and steal the cursor on every keystroke.
  const renderSection = (title: string, ctList: any[], scope: "project" | "company") => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider">{title}</span>
        {addFor !== scope && (
          <button
            type="button"
            onClick={() => { setAddFor(scope); setAddForm(blank()); setEditId(null); }}
            className="flex items-center gap-0.5 text-[11px] text-stone-500 hover:text-stone-200 transition-colors">
            <Plus size={12} /> Add
          </button>
        )}
      </div>

      {addFor === scope && (
        <ContactForm
          value={addForm} onChange={setAddForm}
          onSubmit={() => handleAdd(scope === "project")}
          onCancel={() => { setAddFor(null); setAddForm(blank()); }}
          saving={saving} submitLabel="Add contact"
        />
      )}

      {ctList.length === 0 && addFor !== scope ? (
        <p className="text-[12px] text-stone-600 italic py-1">
          {scope === "project"
            ? "No project-specific contacts — company contacts apply"
            : "No contacts yet"}
        </p>
      ) : (
        sort(ctList).map(c =>
          editId === c.id ? (
            <ContactForm key={c.id}
              value={editForm} onChange={setEditForm}
              onSubmit={() => handleUpdate(c.id)}
              onCancel={() => setEditId(null)}
              saving={saving} submitLabel="Save changes"
            />
          ) : (
            <ContactCard key={c.id} c={c}
              onEdit={() => { openEdit(c); setAddFor(null); }}
              onDelete={() => handleDelete(c.id, c.name)}
              copiedId={copiedId} onCopy={copy}
            />
          )
        )
      )}
    </div>
  );

  const isEmpty = allForCustomer.length === 0;

  return (
    <div className="space-y-4">
      {isEmpty && !addFor && (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <Users size={24} className="text-stone-600" />
          <div className="text-[12px] text-stone-500">No contacts on file</div>
          <button
            type="button"
            onClick={() => { setAddFor("company"); setAddForm(blank()); }}
            className="flex items-center gap-1 text-[12px] text-emerald-400 hover:text-emerald-300 font-medium mt-1">
            <Plus size={13} /> Add first contact
          </button>
          {addFor === "company" && (
            <div className="w-full mt-2">
              <ContactForm value={addForm} onChange={setAddForm}
                onSubmit={() => handleAdd(false)}
                onCancel={() => { setAddFor(null); setAddForm(blank()); }}
                saving={saving} submitLabel="Add contact" />
            </div>
          )}
        </div>
      )}

      {projectId && renderSection("This Project", projContacts, "project")}

      {(!isEmpty || addFor) && renderSection(projectId ? "Company" : "Contacts", compContacts, "company")}
    </div>
  );
}
