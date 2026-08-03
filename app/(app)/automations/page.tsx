"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { Card } from "@/components/ui";
import {
  Mail, Search, AlertTriangle, CheckCircle,
  Info, Users, Briefcase, Check, Minus,
  FileText, Plus, Pencil, Trash2, X, ChevronDown,
} from "lucide-react";

// ─────────────────────────────────────────────
// REMINDER PROGRAMME TAB
// ─────────────────────────────────────────────
function ReminderProgramme() {
  const { customers, projects, contacts, invoices, communications, orgSettings, refresh, toast } = useData();

  // Active (visible) collection stages for this org
  const rawStages: any[] = orgSettings?.stages ?? [];
  const orgStages: string[] = rawStages
    .filter((s: any) => typeof s === "string" || s.visible !== false)
    .map((s: any) => (typeof s === "string" ? s : (s.label ?? s.key ?? "")))
    .filter(Boolean);

  const [smtpOk, setSmtpOk] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/email/status")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (data) setSmtpOk(data.configured); })
      .catch(() => {});
  }, []);

  const [search, setSearch]       = useState("");
  const [saving, setSaving]       = useState<Record<string, boolean>>({});
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"Active" | "Inactive" | "On Hold" | "All">("Active");
  const [viewLevel, setViewLevel] = useState<"customer" | "project">(
    orgSettings?.classificationLevel ?? "customer"
  );

  // Per-entity local email values (editable directly)
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [emailDirty, setEmailDirty] = useState<Set<string>>(new Set());

  const isProjectLevel = viewLevel === "project";

  // By Customer → ALL customers (chaseByProject ones shown with violet "By Project" state)
  // By Project  → only projects whose parent customer IS flagged chaseByProject
  const entities: any[] = isProjectLevel
    ? (projects ?? []).filter((p: any) => {
        const cust = (customers ?? []).find((c: any) => c.id === p.customerId);
        return cust?.chaseByProject === true;
      })
    : (customers ?? []);

  // Initialise email inputs (only if not dirty by the user).
  //
  // Project-level fallback chain:
  //   1. Project contact already flagged receivesAuto  (already configured — keep it)
  //   2. billingEmail from the most recent invoice for that project  ← primary default
  //   3. Customer contact flagged receivesAuto
  //   4. Any project Billing contact
  //   5. Any project contact
  //   6. Any customer Billing contact
  //   7. Any customer contact
  //   8. Customer's own email field
  //
  // Customer-level fallback chain:
  //   1. Customer contact flagged receivesAuto
  //   2. billingEmail from the most recent invoice for that customer
  //   3. Any customer Billing contact
  //   4. Any customer contact
  //   5. Customer's own email field
  useEffect(() => {
    setEmails((prev) => {
      const next = { ...prev };
      entities.forEach((entity) => {
        if (emailDirty.has(entity.id)) return;

        if (isProjectLevel) {
          const projContacts = (contacts ?? []).filter((c: any) => c.projectId === entity.id);
          const custContacts = (contacts ?? []).filter((c: any) => c.customerId === entity.customerId && !c.projectId);
          const parentCust   = (customers ?? []).find((c: any) => c.id === entity.customerId);

          // Invoice billingEmail used only when NO contacts exist at all — prevents
          // the invoice email from overwriting a user-edited contact email after
          // the automation is toggled off (receivesAuto becomes false).
          const latestProjInvoiceEmail = (projContacts.length === 0 && custContacts.length === 0)
            ? (invoices ?? [])
                .filter((inv: any) => inv.projectId === entity.id && inv.billingEmail)
                .sort((a: any, b: any) => (b.invoiceDate ?? "").localeCompare(a.invoiceDate ?? ""))[0]
                ?.billingEmail ?? ""
            : "";

          next[entity.id] =
            projContacts.find((c: any) => c.receivesAuto)?.email ||
            custContacts.find((c: any) => c.receivesAuto)?.email ||
            projContacts.find((c: any) => c.type === "Billing")?.email ||
            projContacts[0]?.email ||
            custContacts.find((c: any) => c.type === "Billing")?.email ||
            custContacts[0]?.email ||
            latestProjInvoiceEmail ||
            parentCust?.email ||
            "";
        } else {
          const custContacts = (contacts ?? []).filter((c: any) => c.customerId === entity.id && !c.projectId);

          // Invoice billingEmail used only when there are NO contacts yet — prevents
          // the invoice email from overwriting a user-edited contact email after toggle off.
          const latestCustInvoiceEmail = custContacts.length === 0
            ? (invoices ?? [])
                .filter((inv: any) => inv.customerId === entity.id && !inv.projectId && inv.billingEmail)
                .sort((a: any, b: any) => (b.invoiceDate ?? "").localeCompare(a.invoiceDate ?? ""))[0]
                ?.billingEmail ?? ""
            : "";

          next[entity.id] =
            custContacts.find((c: any) => c.receivesAuto)?.email ||
            custContacts.find((c: any) => c.type === "Billing")?.email ||
            custContacts[0]?.email ||
            latestCustInvoiceEmail ||
            entity.email ||
            "";
        }
      });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, customers, invoices, isProjectLevel]);

  // ── Derived row data ──────────────────────────
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entities
      .filter((e) => !q || e.name.toLowerCase().includes(q) || (e.code ?? "").toLowerCase().includes(q))
      .map((entity) => {
        const entityContacts = (contacts ?? []).filter((c: any) =>
          isProjectLevel ? c.projectId === entity.id : c.customerId === entity.id
        );
        const activeContact = entityContacts.find((c: any) => c.receivesAuto) ?? null;
        const isOn = !!activeContact && !!activeContact.email;
        const localEmail = emails[entity.id] ?? "";
        const isDirty = emailDirty.has(entity.id);

        // Count open invoices with balance > 0 for this entity (CMs excluded — negative total fails > 0)
        const openInvoices = (invoices ?? []).filter((inv: any) => {
          const matchesEntity = isProjectLevel
            ? inv.projectId === entity.id
            : inv.customerId === entity.id;
          return matchesEntity
            && inv.txnType !== "CreditMemo"
            && inv.paymentStatus !== "Paid"
            && inv.paymentStatus !== "Written Off"
            && (inv.total - (inv.paid || 0)) > 0;
        });

        // Compute outstanding and effectiveStatus (same logic as Customers / Projects pages)
        const outstanding = openInvoices.reduce(
          (sum: number, inv: any) => sum + (inv.total - (inv.paid || 0)), 0
        );
        const effectiveStatus: "Active" | "Inactive" | "On Hold" =
          entity.status === "On Hold" ? "On Hold" : outstanding > 0 ? "Active" : "Inactive";

        // Project count for customer-level rows
        const projectCount = !isProjectLevel
          ? (projects ?? []).filter((p: any) => p.customerId === entity.id).length
          : null;

        // Last outbound email sent to this entity
        const entityComms = (communications ?? []).filter((c: any) =>
          c.direction === "Outbound" &&
          c.channel   === "Email" &&
          (isProjectLevel ? c.projectId === entity.id : c.customerId === entity.id)
        );
        const lastSentAt: string | null = entityComms.length > 0
          ? entityComms.reduce((latest: any, c: any) => {
              const t = c.sentAt ?? c.createdAt ?? "";
              return t > (latest.sentAt ?? latest.createdAt ?? "") ? c : latest;
            }).sentAt ?? entityComms[entityComms.length - 1].createdAt ?? null
          : null;

        return { entity, entityContacts, activeContact, isOn, localEmail, isDirty, openInvoices, outstanding, effectiveStatus, projectCount, lastSentAt };
      })
      .filter((r) => statusFilter === "All" || r.effectiveStatus === statusFilter)
      .sort((a, b) => a.entity.name.localeCompare(b.entity.name));
  }, [entities, contacts, emails, emailDirty, search, isProjectLevel, invoices, communications, statusFilter]);

  const onCount  = rows.filter((r) => r.isOn).length;
  const offCount = rows.filter((r) => !r.isOn).length;
  const noEmailCount = rows.filter((r) => !r.localEmail).length;

  // ── Manual trigger ("Run Now") ───────────────
  const [triggerState, setTriggerState] = useState<"idle" | "running" | "done">("idle");
  const [triggerResult, setTriggerResult] = useState<any>(null);

  const handleRunNow = useCallback(async (dryRun: boolean) => {
    setTriggerState("running");
    setTriggerResult(null);
    try {
      const res = await fetch("/api/cron/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? "Failed to trigger", "error");
        setTriggerState("idle");
        return;
      }
      setTriggerResult({ ...data, dryRun });
      setTriggerState("done");
      // Refresh orgSettings so CronStatusBanner shows the latest run stats
      if (!dryRun) refresh();
    } catch {
      toast("Request failed", "error");
      setTriggerState("idle");
    }
  }, [toast, refresh]);

  // ── API helpers ──────────────────────────────
  const patchContact = useCallback(async (contactId: string, data: any) => {
    const res = await fetch(`/api/contacts/${contactId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to update contact");
    return res.json();
  }, []);

  const createContact = useCallback(async (entity: any, email: string) => {
    const body: any = {
      customerId: isProjectLevel ? entity.customerId : entity.id,
      name: entity.name,
      email,
      type: "Billing",
      isPrimary: false,
      receivesAuto: true,
    };
    if (isProjectLevel) body.projectId = entity.id;
    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Failed to create contact");
    return res.json();
  }, [isProjectLevel]);

  // Save the email for an entity (create or update contact)
  const validateEmails = (value: string) => {
    const parts = value.split(",").map((e) => e.trim()).filter(Boolean);
    if (parts.length === 0) return false;
    return parts.every((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  };

  const saveEmail = useCallback(
    async (entity: any, email: string, row: typeof rows[0]) => {
      if (!email.trim() || !validateEmails(email)) {
        toast("Please enter a valid email address (comma-separate multiple)", "error");
        return;
      }
      setSaving((p) => ({ ...p, [entity.id]: true }));
      try {
        if (row.activeContact) {
          await patchContact(row.activeContact.id, { email: email.trim(), receivesAuto: true });
        } else if (row.entityContacts.length > 0) {
          // Update an existing non-auto contact and enable it
          const target =
            row.entityContacts.find((c: any) => c.type === "Billing") ??
            row.entityContacts[0];
          await patchContact(target.id, { email: email.trim(), receivesAuto: true });
        } else {
          // No contact yet — create one
          await createContact(entity, email.trim());
        }
        setEmailDirty((prev) => { const s = new Set(prev); s.delete(entity.id); return s; });
        await refresh();
        toast("Email saved");
      } catch {
        toast("Failed to save email", "error");
      } finally {
        setSaving((p) => ({ ...p, [entity.id]: false }));
      }
    },
    [patchContact, createContact, refresh, toast]
  );

  // Toggle programme ON / OFF
  const handleToggle = useCallback(
    async (entity: any, row: typeof rows[0], turnOn: boolean) => {
      // If turning ON and email in input but not yet saved → save first
      const email = emails[entity.id]?.trim() ?? "";
      if (turnOn && !row.activeContact && !email) {
        toast("Enter an email address first", "error");
        return;
      }
      if (turnOn && email && !validateEmails(email)) {
        toast("One or more email addresses are invalid", "error");
        return;
      }
      setSaving((p) => ({ ...p, [entity.id]: true }));
      try {
        if (!turnOn) {
          await Promise.all(
            row.entityContacts
              .filter((c: any) => c.receivesAuto)
              .map((c: any) => patchContact(c.id, { receivesAuto: false }))
          );
        } else {
          if (row.activeContact) {
            // Already has an active contact — just re-enable it, never touch its email
            await patchContact(row.activeContact.id, { receivesAuto: true });
          } else if (row.entityContacts.length > 0) {
            // Contact exists but receivesAuto is off — re-enable it.
            // Only overwrite email if the user explicitly typed a new one (isDirty).
            // Never silently revert a previously user-edited email.
            const target =
              row.entityContacts.find((c: any) => c.type === "Billing") ?? row.entityContacts[0];
            const patch: Record<string, any> = { receivesAuto: true };
            if (row.isDirty && email) patch.email = email;
            else if (!target.email && email) patch.email = email; // fill only if blank
            await patchContact(target.id, patch);
            setEmailDirty((prev) => { const s = new Set(prev); s.delete(entity.id); return s; });
          } else if (email) {
            // No contact at all — create one with the entered email
            await createContact(entity, email);
            setEmailDirty((prev) => { const s = new Set(prev); s.delete(entity.id); return s; });
          }
        }
        await refresh();
      } catch {
        toast("Failed to update programme", "error");
      } finally {
        setSaving((p) => ({ ...p, [entity.id]: false }));
      }
    },
    [emails, patchContact, createContact, refresh, toast]
  );

  // ── Chase mode (customer-level only) ─────────
  const handleChaseMode = useCallback(
    async (entity: any, row: typeof rows[0], mode: "off" | "on" | "by-project") => {
      setSaving((p) => ({ ...p, [entity.id]: true }));
      try {
        if (mode === "by-project") {
          // Flag customer as chaseByProject, turn off any active contacts
          await fetch(`/api/customers/${entity.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chaseByProject: true }),
          });
          await Promise.all(
            row.entityContacts
              .filter((c: any) => c.receivesAuto)
              .map((c: any) => patchContact(c.id, { receivesAuto: false }))
          );
          await refresh();
          toast("Switched to per-project chasing — set up reminders in the By Project tab");
        } else {
          // Switching back to customer level — clear flag first if set
          if (entity.chaseByProject) {
            await fetch(`/api/customers/${entity.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chaseByProject: false }),
            });
          }
          await refresh();
          // Then handle on/off via toggle (operates on contacts)
          if (mode === "on") await handleToggle(entity, row, true);
          else await handleToggle(entity, row, false);
        }
      } catch {
        toast("Failed to update", "error");
      } finally {
        setSaving((p) => ({ ...p, [entity.id]: false }));
      }
    },
    [patchContact, refresh, toast, handleToggle]
  );

  // ── Switch a customer back to customer-level chasing ──
  const [switchingCustomer, setSwitchingCustomer] = useState<string | null>(null);
  const handleSwitchToCustomerLevel = useCallback(async (customerId: string) => {
    setSwitchingCustomer(customerId);
    try {
      await fetch(`/api/customers/${customerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chaseByProject: false }),
      });
      await refresh();
      toast("Switched back to customer-level chasing");
    } catch {
      toast("Failed to update", "error");
    } finally {
      setSwitchingCustomer(null);
    }
  }, [refresh, toast]);

  // ── Stage change ───────────────────────────────
  const [stageChanging, setStageChanging] = useState<Record<string, boolean>>({});

  const handleStageChange = useCallback(async (entityId: string, openInvoices: any[], newStage: string) => {
    if (!newStage || openInvoices.length === 0) return;
    setStageChanging(p => ({ ...p, [entityId]: true }));
    try {
      await Promise.all(
        openInvoices.map((inv: any) =>
          fetch(`/api/invoices/${inv.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ collectionStage: newStage }),
          })
        )
      );
      await refresh();
    } catch {
      toast("Failed to update stage", "error");
    } finally {
      setStageChanging(p => ({ ...p, [entityId]: false }));
    }
  }, [refresh, toast]);

  // ── Batch actions ──────────────────────────────
  const allSelected  = rows.length > 0 && rows.every((r) => selected.has(r.entity.id));
  const someSelected = rows.some((r) => selected.has(r.entity.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.entity.id)));
    }
  };

  const handleBulk = useCallback(
    async (turnOn: boolean) => {
      const targets = rows.filter((r) => selected.has(r.entity.id));
      if (targets.length === 0) return;

      // Validate: turning ON requires an email
      if (turnOn) {
        const missing = targets.filter((r) => !r.localEmail.trim());
        if (missing.length > 0) {
          toast(`${missing.length} ${missing.length === 1 ? "row has" : "rows have"} no email — enter emails first`, "error");
          return;
        }
      }

      setBulkSaving(true);
      try {
        await Promise.all(
          targets.map(async (r) => {
            if (!turnOn) {
              return Promise.all(
                r.entityContacts
                  .filter((c: any) => c.receivesAuto)
                  .map((c: any) => patchContact(c.id, { receivesAuto: false }))
              );
            } else {
              const email = r.localEmail.trim();
              if (r.activeContact) {
                return patchContact(r.activeContact.id, { receivesAuto: true, email });
              } else if (r.entityContacts.length > 0) {
                const target =
                  r.entityContacts.find((c: any) => c.type === "Billing") ?? r.entityContacts[0];
                return patchContact(target.id, { receivesAuto: true, email });
              } else {
                return createContact(r.entity, email);
              }
            }
          })
        );
        await refresh();
        toast(`${targets.length} ${turnOn ? "turned ON" : "turned OFF"}`);
        setSelected(new Set());
      } catch {
        toast("Bulk update failed", "error");
      } finally {
        setBulkSaving(false);
      }
    },
    [rows, selected, patchContact, createContact, refresh, toast]
  );

  // ── Row renderer (shared by By Customer flat list and By Project grouped list) ──
  const renderRow = (row: typeof rows[0]) => {
    const { entity, entityContacts, activeContact, isOn, localEmail, isDirty, openInvoices, outstanding, effectiveStatus, projectCount, lastSentAt } = row;
    const isSaving      = !!saving[entity.id] || bulkSaving;
    const isStageChange = !!stageChanging[entity.id];
    const isSelected    = selected.has(entity.id);
    const emailVal      = emails[entity.id] ?? "";

    // Derive current stage(s) of open invoices for this entity
    const openInvStages = openInvoices.map((inv: any) => inv.collectionStage).filter(Boolean);
    const uniqueStages  = [...new Set<string>(openInvStages)];
    const isMixed       = uniqueStages.length > 1;
    const currentStage  = uniqueStages.length === 1 ? uniqueStages[0] : null;

    const statusBadge =
      effectiveStatus === "Active"   ? { label: "Active",   cls: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30" } :
      effectiveStatus === "On Hold"  ? { label: "On Hold",  cls: "bg-amber-500/15 text-amber-400 ring-amber-500/30"       } :
                                       { label: "Inactive", cls: "bg-stone-800 text-stone-500 ring-stone-700"              };

    return (
      <div
        key={entity.id}
        className={`grid grid-cols-[40px_1fr_90px_100px_140px_2fr_110px_155px] gap-3 items-center px-4 py-3 border-b border-stone-800 last:border-0 transition-colors ${
          entity.chaseByProject ? "bg-violet-500/5" : isSelected ? "bg-stone-800/40" : ""
        } ${isSaving ? "opacity-60" : ""}`}
      >
        {/* Checkbox */}
        <div className="flex items-center justify-center">
          <button
            onClick={() => setSelected((prev) => { const s = new Set(prev); s.has(entity.id) ? s.delete(entity.id) : s.add(entity.id); return s; })}
            className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${isSelected ? "bg-emerald-500 border-emerald-500" : "border-stone-600 hover:border-stone-400"}`}
          >
            {isSelected && <Check size={10} className="text-white" strokeWidth={3} />}
          </button>
        </div>

        {/* Entity name — no code/QBO ID shown */}
        <div className="min-w-0">
          <div className="text-sm font-medium text-white truncate">{entity.name}</div>
          <div className="flex items-center gap-2 mt-0.5">
            {!isProjectLevel && projectCount !== null && (
              <span className="text-[11px] text-stone-400">
                {projectCount} project{projectCount !== 1 ? "s" : ""}
              </span>
            )}
            {openInvoices.length > 0 && (
              <span className="text-[10px] text-emerald-600">
                {!isProjectLevel ? "· " : ""}{openInvoices.length} open invoice{openInvoices.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>

        {/* Status badge */}
        <div>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ${statusBadge.cls}`}>
            {statusBadge.label}
          </span>
        </div>

        {/* Outstanding */}
        <div className="text-right tabular-nums">
          {outstanding > 0 ? (
            <span className="text-sm font-semibold text-white">
              {new Intl.NumberFormat(undefined, { style: "currency", currency: openInvoices[0]?.currency ?? "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(outstanding)}
            </span>
          ) : (
            <span className="text-[11px] text-stone-500">—</span>
          )}
        </div>

        {/* Stage dropdown */}
        <div>
          {openInvoices.length > 0 && orgStages.length > 0 ? (
            <select
              value={currentStage ?? ""}
              disabled={isStageChange}
              onChange={e => handleStageChange(entity.id, openInvoices, e.target.value)}
              className={`w-full h-8 px-2 text-xs rounded-md border focus:border-emerald-500 focus:outline-none bg-stone-800 disabled:opacity-50 ${
                isMixed ? "text-amber-400 border-amber-500/50" : "text-stone-300 border-stone-700"
              }`}
            >
              {isMixed && <option value="">Mixed stages</option>}
              {!currentStage && !isMixed && <option value="">—</option>}
              {orgStages.map((s: string) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          ) : (
            <span className="text-[11px] text-stone-400">—</span>
          )}
        </div>

        {/* Email input */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative flex-1 min-w-0">
            <input
              type="text"
              value={emailVal}
              disabled={isSaving}
              placeholder="billing@customer.com, cc@customer.com"
              onChange={(e) => {
                const val = e.target.value;
                setEmails((prev) => ({ ...prev, [entity.id]: val }));
                setEmailDirty((prev) => {
                  const s = new Set(prev);
                  if (val !== (activeContact?.email ?? "")) s.add(entity.id);
                  else s.delete(entity.id);
                  return s;
                });
              }}
              onKeyDown={(e) => { if (e.key === "Enter") saveEmail(entity, emailVal, row); }}
              onBlur={() => { if (isDirty && emailVal.trim()) saveEmail(entity, emailVal, row); }}
              className={`w-full h-8 px-2.5 text-sm rounded-md border focus:border-emerald-500 focus:outline-none transition-colors text-white placeholder:text-stone-500 ${
                isDirty ? "border-amber-500/50 bg-amber-500/10" : "border-stone-700 bg-stone-800"
              }`}
            />
            {isDirty && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-amber-400 font-medium pointer-events-none">unsaved</span>
            )}
          </div>
          {!emailVal ? (
            <span title="No email set"><AlertTriangle size={14} className="text-amber-400 shrink-0" /></span>
          ) : isOn ? (
            <span title="Programme active"><CheckCircle size={14} className="text-emerald-500 shrink-0" /></span>
          ) : (
            <div className="w-3.5 h-3.5 shrink-0" />
          )}
        </div>

        {/* Last sent */}
        <div className="text-[11px] leading-tight">
          {lastSentAt ? (() => {
            const d    = new Date(lastSentAt);
            const diff = Date.now() - d.getTime();
            const mins = Math.floor(diff / 60_000);
            const hrs  = Math.floor(diff / 3_600_000);
            const days = Math.floor(diff / 86_400_000);
            const label =
              mins  < 60   ? `${mins}m ago`  :
              hrs   < 24   ? `${hrs}h ago`   :
              days  < 7    ? `${days}d ago`  :
              days  < 30   ? `${Math.floor(days / 7)}w ago` :
                             d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
            return (
              <span className="text-stone-500" title={d.toLocaleString("en-GB")}>
                {label}
              </span>
            );
          })() : (
            <span className="text-stone-300 italic">Never</span>
          )}
        </div>

        {/* Programme control */}
        <div className="flex items-center justify-center">
          {!isProjectLevel ? (
            // By Customer: 3-state dropdown
            <select
              disabled={isSaving}
              value={entity.chaseByProject ? "by-project" : isOn ? "on" : "off"}
              onChange={(e) => {
                const mode = e.target.value as "off" | "on" | "by-project";
                if (mode === "on" && !emailVal && !entity.chaseByProject) { toast("Enter an email address first", "error"); return; }
                handleChaseMode(entity, row, mode);
              }}
              className={`h-8 pl-2.5 pr-6 text-[12px] font-semibold rounded-lg border focus:outline-none appearance-none cursor-pointer transition-colors disabled:opacity-50 ${
                entity.chaseByProject
                  ? "bg-violet-500/15 border-violet-500/30 text-violet-300"
                  : isOn ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400" : "bg-stone-800 border-stone-700 text-stone-400"
              }`}
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center" }}
            >
              <option value="off">Off</option>
              <option value="on">Programme On</option>
              <option value="by-project">By Project ↗</option>
            </select>
          ) : (
            // By Project: ON/OFF toggle
            <div className="flex items-center gap-2">
              <button
                disabled={isSaving}
                onClick={() => handleToggle(entity, row, !isOn)}
                title={isOn ? "Click to turn off" : emailVal ? "Click to turn on" : "Enter email first"}
                className={`relative w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none disabled:cursor-not-allowed ${isOn ? "bg-emerald-500" : "bg-stone-700"}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200 ${isOn ? "translate-x-6" : "translate-x-0"}`} />
              </button>
              <span className={`text-[11px] font-semibold w-7 ${isOn ? "text-emerald-400" : "text-stone-500"}`}>
                {isOn ? "ON" : "OFF"}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">

      {/* ── SMTP health check banner ── */}
      {smtpOk === false && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-5 py-3.5 flex items-center gap-3 mb-4 text-sm">
          <AlertTriangle size={16} className="text-amber-400 shrink-0" />
          <span className="flex-1 text-amber-200">
            <strong>Email is not configured</strong> — automated reminders won&apos;t send.{" "}
            Set up SMTP in Settings → Email to enable sending.
          </span>
          <Link
            href="/settings/company"
            className="shrink-0 text-amber-300 font-semibold hover:underline whitespace-nowrap"
          >
            Go to Settings →
          </Link>
        </div>
      )}

      {/* ── Run Now panel ── */}
      <div className="bg-stone-900 rounded-xl border border-stone-800 px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-sm font-semibold text-white">Manual trigger</div>
          <div className="text-[11px] text-stone-400 mt-0.5">
            Send collection emails now via SMTP using the template assigned to each invoice&apos;s collection stage.
            Use <span className="font-medium text-stone-300">Preview</span> first to see what would be sent.
            Contacts with no matching template are skipped.
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => handleRunNow(true)}
            disabled={triggerState === "running"}
            className="h-8 px-4 text-xs font-medium rounded-md border border-stone-700 text-stone-300 hover:bg-stone-800 disabled:opacity-50 transition-colors"
          >
            {triggerState === "running" ? "Running…" : "Preview"}
          </button>
          <button
            onClick={() => handleRunNow(false)}
            disabled={triggerState === "running"}
            className="h-8 px-4 text-xs font-semibold rounded-md bg-emerald-500 hover:bg-emerald-400 text-white disabled:opacity-50 transition-colors"
          >
            {triggerState === "running" ? "Sending…" : "Send Now"}
          </button>
          {triggerState === "done" && (
            <button onClick={() => { setTriggerState("idle"); setTriggerResult(null); }}
              className="h-8 px-3 text-xs text-stone-500 hover:text-stone-300">✕</button>
          )}
        </div>
      </div>

      {/* ── Trigger result ── */}
      {triggerResult && (
        <div className={`rounded-xl border px-5 py-4 text-sm ${triggerResult.dryRun ? "bg-amber-500/10 border-amber-500/30" : "bg-emerald-500/10 border-emerald-500/30"}`}>
          <div className="flex items-center justify-between mb-3">
            <div className={`font-semibold ${triggerResult.dryRun ? "text-amber-200" : "text-emerald-200"}`}>
              {triggerResult.dryRun
                ? `Preview — ${triggerResult.sent ?? triggerResult.drafted} email${(triggerResult.sent ?? triggerResult.drafted) !== 1 ? "s" : ""} would be sent`
                : `✓ ${triggerResult.sent ?? triggerResult.drafted} email${(triggerResult.sent ?? triggerResult.drafted) !== 1 ? "s" : ""} sent`}
              {triggerResult.skipped > 0 && (
                <span className="ml-2 text-[11px] font-normal text-stone-400">· {triggerResult.skipped} skipped (no pending invoices)</span>
              )}
            </div>
          </div>
          {triggerResult.details?.length > 0 && (
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-stone-500 border-b border-stone-700">
                  <th className="text-left font-semibold pb-1.5 pr-3">Contact</th>
                  <th className="text-left font-semibold pb-1.5 pr-3">Entity</th>
                  <th className="text-left font-semibold pb-1.5 pr-3">Stage</th>
                  <th className="text-left font-semibold pb-1.5 pr-3">Template</th>
                  <th className="text-left font-semibold pb-1.5">Invoices</th>
                  <th className="text-left font-semibold pb-1.5 pl-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {triggerResult.details.map((d: any, i: number) => (
                  <tr key={i} className="border-b border-stone-800 last:border-0">
                    <td className="py-1.5 pr-3 text-stone-300 font-mono text-[10px]">{d.contact}</td>
                    <td className="py-1.5 pr-3 text-stone-300">{d.entity}</td>
                    <td className="py-1.5 pr-3">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-stone-800 text-stone-200 border border-stone-700">{d.stage}</span>
                    </td>
                    <td className="py-1.5 pr-3 text-stone-400 text-[10px]">{d.templateName}</td>
                    <td className="py-1.5 text-stone-300">{d.invoices?.join(", ")}</td>
                    <td className="py-1.5 pl-3">
                      {d.error
                        ? <span className="text-rose-400">✗ {d.error}</span>
                        : triggerResult.dryRun
                          ? <span className="text-amber-400">would be sent</span>
                          : <span className="text-emerald-400">✓ sent</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {triggerResult.details?.length === 0 && (
            <div className="text-stone-400 text-[12px]">No pending reminders — all invoices are either not yet due, already paid, or paused.</div>
          )}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Programme ON",   value: onCount,      color: "text-emerald-400" },
          { label: "Programme OFF",  value: offCount,     color: "text-stone-400"   },
          { label: "No email set",   value: noEmailCount, color: "text-amber-400"   },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-stone-900 rounded-lg border border-stone-800 px-4 py-3 text-center">
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
            <div className="text-[11px] text-stone-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Level toggle */}
        <div className="flex items-center gap-1 bg-stone-800 rounded-lg p-1">
            <button onClick={() => { setViewLevel("customer"); setSelected(new Set()); setStatusFilter("Active"); }}
            title="Customers chased at account level"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${viewLevel === "customer" ? "bg-stone-700 text-white shadow-sm" : "text-stone-400 hover:text-stone-200"}`}>
            <Users size={12} /> By Customer
          </button>
          <button onClick={() => { setViewLevel("project"); setSelected(new Set()); setStatusFilter("Active"); }}
            title="Projects for customers flagged 'Chase by Project'"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${viewLevel === "project" ? "bg-stone-700 text-white shadow-sm" : "text-stone-400 hover:text-stone-200"}`}>
            <Briefcase size={12} /> By Project
          </button>
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as any); setSelected(new Set()); }}
          className="h-9 px-2.5 pr-7 text-sm rounded-md border border-stone-700 focus:border-emerald-500 focus:outline-none bg-stone-800 text-stone-300"
        >
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
          <option value="On Hold">On Hold</option>
          <option value="All">All statuses</option>
        </select>

        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${isProjectLevel ? "projects" : "customers"}…`}
            className="w-full h-9 pl-8 pr-3 text-sm rounded-md border border-stone-700 focus:border-emerald-500 focus:outline-none bg-stone-800 text-stone-300 placeholder-stone-500" />
        </div>

        <div className="ml-auto text-[11px] text-stone-500">{rows.length} {isProjectLevel ? "projects" : "customers"}</div>
      </div>

      {/* Bulk action bar */}
      {someSelected && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-stone-900 text-white rounded-lg">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => handleBulk(true)}
              disabled={bulkSaving}
              className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
            >
              Turn ON ({selected.size})
            </button>
            <button
              onClick={() => handleBulk(false)}
              disabled={bulkSaving}
              className="px-3 py-1.5 bg-stone-700 hover:bg-stone-600 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
            >
              Turn OFF ({selected.size})
            </button>
            <button onClick={() => setSelected(new Set())}
              className="px-2 py-1.5 text-stone-400 hover:text-white text-sm rounded-md transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <Card padding="none">
        {/* Header */}
        <div className="grid grid-cols-[40px_1fr_90px_100px_140px_2fr_110px_155px] gap-3 px-4 py-2.5 border-b border-stone-800 bg-stone-900/60">
          {/* Select all */}
          <div className="flex items-center justify-center">
            <button
              onClick={toggleSelectAll}
              className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                allSelected
                  ? "bg-emerald-500 border-emerald-500"
                  : someSelected
                  ? "bg-stone-500 border-stone-500"
                  : "border-stone-600 hover:border-stone-400"
              }`}
            >
              {allSelected && <Check size={10} className="text-white" strokeWidth={3} />}
              {someSelected && !allSelected && <Minus size={10} className="text-white" strokeWidth={3} />}
            </button>
          </div>
          <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">
            {isProjectLevel ? "Project" : "Customer"}
          </div>
          <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">
            Status
          </div>
          <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider text-right">
            Outstanding
          </div>
          <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">
            Stage
          </div>
          <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">
            Reminder Email
          </div>
          <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">
            Last Sent
          </div>
          <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider text-center">
            Programme
          </div>
        </div>

        {rows.length === 0 && (
          <div className="py-12 text-center text-sm text-stone-500">
            {search
              ? "No results match your search"
              : isProjectLevel
              ? <span>No projects set to per-project chasing.<br /><span className="text-[11px] text-stone-400">Open a customer and enable <strong className="text-stone-500">Chase by Project</strong> to see their projects here.</span></span>
              : "No customers found"}
          </div>
        )}

        {/* By Project: group rows under their parent customer with a switch-back header */}
        {isProjectLevel && (() => {
          // Group projects by customerId
          const groups: { customerId: string; customerName: string; rows: typeof rows }[] = [];
          rows.forEach((r) => {
            const cid = r.entity.customerId ?? "unknown";
            const existing = groups.find((g) => g.customerId === cid);
            if (existing) { existing.rows.push(r); }
            else {
              const cust = (customers ?? []).find((c: any) => c.id === cid);
              groups.push({ customerId: cid, customerName: cust?.name ?? cid, rows: [r] });
            }
          });
          return groups.map(({ customerId, customerName, rows: groupRows }) => (
            <div key={customerId}>
              {/* Customer group header */}
              <div className="flex items-center gap-2 px-4 py-2 bg-violet-500/10 border-b border-violet-500/20">
                <Users size={12} className="text-violet-400 shrink-0" />
                <span className="text-[12px] font-semibold text-violet-300">{customerName}</span>
                <span className="text-[11px] text-violet-500">{groupRows.length} project{groupRows.length !== 1 ? "s" : ""}</span>
              </div>
              {groupRows.map((row) => renderRow(row))}
            </div>
          ));
        })()}

        {/* By Customer: flat list */}
        {!isProjectLevel && rows.map((row) => renderRow(row))}


      </Card>

      {/* Footer note */}
      <div className="flex items-start gap-2 px-1 text-[12px] text-stone-500">
        <Info size={13} className="mt-0.5 shrink-0" />
        <span>
          Emails are sent only for <strong className="text-stone-300">open invoices with an outstanding balance</strong>.
          Invoices in Disputed or Promise to Pay stages are always skipped.
          Email subjects include the project/customer reference and invoice numbers.
          Type directly in the email field — it saves automatically on Enter or when you click away.
          <strong className="text-stone-300"> Multiple recipients supported</strong> — just separate addresses with a comma.
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// EMAIL TEMPLATES TAB
// ─────────────────────────────────────────────

type EmailTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
  collectionStage: string | null;
  isActive: boolean;
  isDefault: boolean;
  sendIntervalDays: number;
};

const FREQUENCY_OPTIONS = [
  { label: "Every week",       days: 7   },
  { label: "Every 2 weeks",    days: 14  },
  { label: "Every month",      days: 30  },
  { label: "Every 3 months",   days: 90  },
  { label: "Custom",           days: 0   }, // 0 = custom input
];

const BLANK_TEMPLATE: Omit<EmailTemplate, "id" | "isActive"> = {
  name: "",
  subject: "",
  body: "",
  collectionStage: null,
  isDefault: false,
  sendIntervalDays: 7,
};

const PLACEHOLDER_HELP = [
  { key: "{name}",         desc: "Contact's first name (e.g. John)" },
  { key: "{invoiceLines}", desc: "Bullet list of invoice number, balance & overdue status" },
  { key: "{ref}",          desc: "Customer / project code (e.g. ACME-001)" },
];


function EmailTemplates() {
  const { orgSettings, toast } = useData();

  // All org collection stages (customisable) — fall back to common defaults.
  // stages may be stored as plain strings OR as objects {key, label, color, visible, ...}
  // Only show stages that are visible (active) — hidden stages are excluded.
  const rawStages: any[] = orgSettings?.stages ?? [
    "New", "Open", "1st Reminder Sent", "2nd Reminder Sent", "Final Demand Sent",
    "Disputed", "On Hold", "Promise to Pay", "Escalated", "Legal",
  ];
  const orgStages: string[] = rawStages
    .filter((s) => typeof s === "string" || s.visible !== false)
    .map((s) => (typeof s === "string" ? s : (s.label ?? s.key ?? "")))
    .filter(Boolean);

  const [templates, setTemplates]   = useState<EmailTemplate[]>([]);
  const [loading, setLoading]       = useState(true);
  const [editing, setEditing]       = useState<EmailTemplate | null>(null);  // null = closed
  const [isNew, setIsNew]           = useState(false);
  const [saving, setSaving]         = useState(false);
  const [deleting, setDeleting]     = useState<string | null>(null);
  const [showHelp, setShowHelp]     = useState(false);

  // ── Load ──────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/email-templates");
      if (res.ok) setTemplates(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Helpers ───────────────────────────────
  const openNew = () => {
    setEditing({ id: "", ...BLANK_TEMPLATE, isActive: true });
    setIsNew(true);
  };

  const openEdit = (t: EmailTemplate) => {
    setEditing({ ...t });
    setIsNew(false);
  };

  const closeEditor = () => { setEditing(null); setIsNew(false); };

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name.trim())    { toast("Template name is required", "error"); return; }
    if (!editing.subject.trim()) { toast("Subject is required", "error"); return; }
    if (!editing.body.trim())    { toast("Body is required", "error"); return; }

    setSaving(true);
    try {
      const payload = {
        name:             editing.name.trim(),
        subject:          editing.subject.trim(),
        body:             editing.body.trim(),
        collectionStage:  editing.collectionStage || null,
        isActive:         editing.isActive,
        sendIntervalDays: editing.sendIntervalDays ?? 7,
      };

      if (isNew) {
        const res = await fetch("/api/email-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Failed to create template");
        toast("Template created");
      } else {
        const res = await fetch(`/api/email-templates/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Failed to save template");
        toast("Template saved");
      }

      await load();
      closeEditor();
    } catch (e: any) {
      toast(e.message ?? "Failed to save", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await fetch(`/api/email-templates/${id}`, { method: "DELETE" });
      toast("Template deleted");
      await load();
    } catch {
      toast("Failed to delete", "error");
    } finally {
      setDeleting(null);
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await fetch(`/api/email-templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      toast("Default template updated");
      await load();
    } catch {
      toast("Failed to update default", "error");
    }
  };

  // Stages already assigned to a template (for warning duplicate assignment)
  const assignedStages = new Set(
    templates.filter((t) => t.collectionStage && t.id !== (editing?.id ?? "")).map((t) => t.collectionStage!)
  );

  // ── Render ────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Info banner */}
      <div className="rounded-xl bg-blue-500/10 border border-blue-500/30 p-4">
        <div className="flex items-start gap-3">
          <Info size={18} className="text-blue-400 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-blue-200">
            <div className="font-medium mb-1">You control every word — we never decide for you</div>
            <div className="text-blue-300">
              Write your own email for each collection stage. When an email is sent, the tool looks at the
              invoice's current <strong className="text-blue-200">collection stage</strong> and uses the matching template.
              No wording is ever chosen based on age numbers.
            </div>
          </div>
        </div>
      </div>

      {/* Placeholder reference — collapsible */}
      <div className="rounded-xl border border-stone-800 bg-stone-900 overflow-hidden">
        <button
          onClick={() => setShowHelp((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-stone-300 hover:bg-stone-800 transition-colors"
        >
          <span className="flex items-center gap-2"><FileText size={14} className="text-stone-500" /> Template placeholder reference</span>
          <ChevronDown size={14} className={`text-stone-500 transition-transform ${showHelp ? "rotate-180" : ""}`} />
        </button>
        {showHelp && (
          <div className="px-4 pb-4 border-t border-stone-800">
            <p className="text-[12px] text-stone-400 mt-3 mb-2">Use these placeholders anywhere in your subject or body — they are replaced automatically when an email is sent:</p>
            <div className="space-y-1.5">
              {PLACEHOLDER_HELP.map(({ key, desc }) => (
                <div key={key} className="flex items-start gap-3">
                  <code className="text-[12px] font-mono bg-stone-800 px-2 py-0.5 rounded text-emerald-400 shrink-0">{key}</code>
                  <span className="text-[12px] text-stone-300">{desc}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-stone-500 mt-3">
              The invoice reference and entity code are automatically appended to the subject line — you don&apos;t need to add those manually.
            </p>
          </div>
        )}
      </div>

      {/* Template list */}
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-white">
          {templates.length === 0 ? "No templates yet" : `${templates.length} template${templates.length !== 1 ? "s" : ""}`}
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-md bg-emerald-500 hover:bg-emerald-400 text-white transition-colors"
        >
          <Plus size={13} /> New Template
        </button>
      </div>

      {loading && <div className="text-sm text-stone-400 py-8 text-center">Loading…</div>}

      {!loading && templates.length === 0 && (
        <Card>
          <div className="py-8 text-center">
            <Mail size={28} className="mx-auto text-stone-600 mb-3" />
            <div className="text-sm font-medium text-stone-300 mb-1">No email templates yet</div>
            <div className="text-[12px] text-stone-500 mb-4 max-w-xs mx-auto">
              Create a template for each collection stage you use — e.g. &ldquo;1st Reminder Sent&rdquo;, &ldquo;Final Demand Sent&rdquo;.
            </div>
            <button onClick={openNew} className="flex items-center gap-1.5 h-8 px-4 text-xs font-semibold rounded-md bg-emerald-500 hover:bg-emerald-400 text-white transition-colors mx-auto">
              <Plus size={13} /> Create first template
            </button>
          </div>
        </Card>
      )}

      {!loading && templates.map((t) => (
        <Card key={t.id} padding="none">
          <div className="px-4 py-3 flex items-start gap-3">
            {/* Stage badge / unassigned */}
            <div className="shrink-0 mt-0.5">
              {t.collectionStage ? (
                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  {t.collectionStage}
                </span>
              ) : (
                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-semibold bg-stone-800 text-stone-500 border border-stone-700">
                  Unassigned
                </span>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-white">{t.name}</span>
                {t.isDefault && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">Default</span>
                )}
                {!t.isActive && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-stone-800 text-stone-500 border border-stone-700">Inactive</span>
                )}
              </div>
              <div className="text-[12px] text-stone-400 mt-0.5 truncate">
                <strong className="text-stone-300">Subject:</strong> {t.subject}
              </div>
              <div className="text-[11px] text-stone-500 mt-1 line-clamp-2 whitespace-pre-wrap leading-relaxed">
                {t.body.slice(0, 180)}{t.body.length > 180 ? "…" : ""}
              </div>
              {t.sendIntervalDays && (
                <div className="flex items-center gap-1 mt-1.5">
                  <span className="text-[10px] text-stone-500 font-medium">Sends</span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-stone-800 text-stone-300 border border-stone-700">
                    {FREQUENCY_OPTIONS.find(o => o.days === t.sendIntervalDays)?.label
                      ?? `every ${t.sendIntervalDays} days`}
                  </span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 shrink-0">
              {!t.isDefault && (
                <button
                  onClick={() => handleSetDefault(t.id)}
                  className="h-8 px-2 flex items-center gap-1 text-[10px] font-medium rounded-md hover:bg-emerald-500/15 text-stone-500 hover:text-emerald-400 transition-colors"
                  title="Use as default email when sending invoices"
                >
                  Set default
                </button>
              )}
              <button
                onClick={() => openEdit(t)}
                className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-stone-800 text-stone-500 hover:text-stone-300 transition-colors"
                title="Edit template"
              >
                <Pencil size={13} />
              </button>
              <button
                onClick={() => handleDelete(t.id)}
                disabled={deleting === t.id}
                className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-rose-500/15 text-stone-500 hover:text-rose-400 transition-colors disabled:opacity-40"
                title="Delete template"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        </Card>
      ))}

      {/* ── Editor modal ── */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-stone-900 border border-stone-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-stone-800">
              <h2 className="text-base font-semibold text-white">
                {isNew ? "New email template" : "Edit template"}
              </h2>
              <button onClick={closeEditor} className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-stone-800 text-stone-500 hover:text-stone-300">
                <X size={16} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* Template name */}
              <div>
                <label className="block text-[12px] font-semibold text-stone-400 mb-1">Template name</label>
                <input
                  type="text"
                  value={editing.name}
                  onChange={(e) => setEditing((p) => p && ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Friendly Reminder, Final Demand"
                  className="w-full h-9 px-3 text-sm rounded-lg border border-stone-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none bg-stone-800/60 text-white placeholder-stone-500"
                />
              </div>

              {/* Collection stage */}
              <div>
                <label className="block text-[12px] font-semibold text-stone-400 mb-1">Collection stage</label>
                <p className="text-[11px] text-stone-500 mb-1.5">
                  Choose the invoice stage that triggers this template. Only one template per stage.
                </p>
                <select
                  value={editing.collectionStage ?? ""}
                  onChange={(e) => setEditing((p) => p && ({ ...p, collectionStage: e.target.value || null }))}
                  className="w-full h-9 px-3 text-sm rounded-lg border border-stone-700 focus:border-emerald-500 focus:outline-none bg-stone-800 text-white"
                >
                  <option value="">— Not assigned —</option>
                  {orgStages.map((s) => (
                    <option key={s} value={s} disabled={assignedStages.has(s)}>
                      {s}{assignedStages.has(s) ? " (already assigned)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Subject */}
              <div>
                <label className="block text-[12px] font-semibold text-stone-400 mb-1">Email subject</label>
                <p className="text-[11px] text-stone-500 mb-1.5">Supports <code className="font-mono bg-stone-800 px-1 rounded text-emerald-400">{"{ref}"}</code> placeholder. Invoice numbers are appended automatically.</p>
                <input
                  type="text"
                  value={editing.subject}
                  onChange={(e) => setEditing((p) => p && ({ ...p, subject: e.target.value }))}
                  placeholder="e.g. Payment Reminder | {ref}"
                  className="w-full h-9 px-3 text-sm rounded-lg border border-stone-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none bg-stone-800/60 text-white placeholder-stone-500"
                />
              </div>

              {/* Body */}
              <div>
                <label className="block text-[12px] font-semibold text-stone-400 mb-1">Email body</label>
                <p className="text-[11px] text-stone-500 mb-1.5">
                  Use <code className="font-mono bg-stone-800 px-1 rounded text-emerald-400">{"{name}"}</code> for the contact&apos;s first name,{" "}
                  <code className="font-mono bg-stone-800 px-1 rounded text-emerald-400">{"{invoiceLines}"}</code> for the invoice list,{" "}
                  <code className="font-mono bg-stone-800 px-1 rounded text-emerald-400">{"{ref}"}</code> for the entity code.
                </p>
                <textarea
                  value={editing.body}
                  onChange={(e) => setEditing((p) => p && ({ ...p, body: e.target.value }))}
                  rows={10}
                  placeholder={`Hi {name},\n\nI hope you are well. Please find the following invoices outstanding on your account:\n\n{invoiceLines}\n\nPlease don't hesitate to get in touch if you have any queries.\n\nMany thanks`}
                  className="w-full px-3 py-2.5 text-sm rounded-lg border border-stone-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none bg-stone-800/60 text-white placeholder-stone-500 resize-none font-mono leading-relaxed"
                />
              </div>

              {/* Active toggle */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setEditing((p) => p && ({ ...p, isActive: !p.isActive }))}
                  className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${editing.isActive ? "bg-emerald-500" : "bg-stone-700"}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200 ${editing.isActive ? "translate-x-5" : "translate-x-0"}`} />
                </button>
                <span className="text-sm text-stone-300">{editing.isActive ? "Active — will be used when emails are sent" : "Inactive — will be skipped"}</span>
              </div>

              {/* Send frequency */}
              <div className="border-t border-stone-800 pt-4">
                <label className="block text-[12px] font-semibold text-stone-400 mb-1">Send frequency</label>
                <p className="text-[11px] text-stone-500 mb-3">
                  How often to re-send reminders to this contact after the first email goes out.
                </p>
                {(() => {
                  const presets = FREQUENCY_OPTIONS.filter(o => o.days > 0);
                  const isCustom = !presets.some(o => o.days === editing.sendIntervalDays);
                  return (
                    <div className="flex flex-wrap gap-2 items-center">
                      {presets.map((opt) => (
                        <button
                          key={opt.days}
                          type="button"
                          onClick={() => setEditing((p) => p && ({ ...p, sendIntervalDays: opt.days }))}
                          className={`px-3 py-1.5 text-[12px] font-medium rounded-lg border transition-colors ${
                            editing.sendIntervalDays === opt.days
                              ? "bg-emerald-500 text-white border-emerald-500"
                              : "bg-stone-800 text-stone-300 border-stone-700 hover:border-stone-500"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                      {/* Custom button — activates the number input */}
                      <button
                        type="button"
                        onClick={() => {
                          if (!isCustom) setEditing((p) => p && ({ ...p, sendIntervalDays: 21 }));
                        }}
                        className={`px-3 py-1.5 text-[12px] font-medium rounded-lg border transition-colors ${
                          isCustom
                            ? "bg-emerald-500 text-white border-emerald-500"
                            : "bg-stone-800 text-stone-300 border-stone-700 hover:border-stone-500"
                        }`}
                      >
                        Custom
                      </button>
                      {/* Number input — only visible when Custom is active */}
                      {isCustom && (
                        <div className="flex items-center gap-1.5 ml-1">
                          <input
                            type="number"
                            min={1}
                            autoFocus
                            value={editing.sendIntervalDays}
                            onChange={(e) => {
                              const n = parseInt(e.target.value, 10);
                              if (!isNaN(n) && n >= 1) setEditing((p) => p && ({ ...p, sendIntervalDays: n }));
                            }}
                            className="w-16 h-8 px-2 text-sm rounded-md border-2 border-emerald-500 focus:outline-none bg-stone-800 text-white text-center font-medium"
                          />
                          <span className="text-[12px] text-stone-500">days</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-stone-800">
              <button onClick={closeEditor} className="h-9 px-4 text-sm rounded-lg border border-stone-700 text-stone-400 hover:bg-stone-800 transition-colors">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="h-9 px-5 text-sm font-semibold rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white disabled:opacity-50 transition-colors"
              >
                {saving ? "Saving…" : isNew ? "Create template" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// PAGE
// ─── Cron status banner ───────────────────────────────────────────────────────
function CronStatusBanner() {
  const { orgSettings } = useData() as any;
  const { lastCronRun, lastCronStats } = orgSettings ?? {};

  if (!lastCronRun) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-stone-800/50 border border-stone-700 text-[12px] text-stone-400">
        <span className="w-2 h-2 rounded-full bg-stone-600 flex-shrink-0" />
        Automated emails have not run yet. Cron fires daily at 9 AM UTC.
      </div>
    );
  }

  const runDate   = new Date(lastCronRun);
  const minsAgo   = Math.floor((Date.now() - runDate.getTime()) / 60_000);
  const timeLabel = minsAgo < 60
    ? `${minsAgo}m ago`
    : minsAgo < 1440
    ? `${Math.floor(minsAgo / 60)}h ago`
    : `${Math.floor(minsAgo / 1440)}d ago`;

  const hasErrors = (lastCronStats?.errors?.length ?? 0) > 0;

  return (
    <div className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-[12px] ${hasErrors ? "bg-rose-500/10 border-rose-500/30" : "bg-emerald-500/10 border-emerald-500/30"}`}>
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${hasErrors ? "bg-rose-400" : "bg-emerald-500"}`} />
      <span className={hasErrors ? "text-rose-300" : "text-emerald-300"}>
        Last run <strong>{timeLabel}</strong>
        {lastCronStats && (
          <> — {lastCronStats.emailsSent} email{lastCronStats.emailsSent !== 1 ? "s" : ""} sent
          {hasErrors && `, ${lastCronStats.errors.length} error${lastCronStats.errors.length !== 1 ? "s" : ""}`}</>
        )}
      </span>
      {hasErrors && (
        <details className="ml-auto cursor-pointer">
          <summary className="text-[11px] text-rose-600 font-medium list-none hover:underline">View errors</summary>
          <ul className="mt-1 space-y-0.5 text-[11px] text-rose-600">
            {lastCronStats.errors.map((e: string, i: number) => <li key={i}>• {e}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
export default function AutomationsPage() {
  const [tab, setTab] = useState<"templates" | "programme">("templates");

  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold text-white tracking-tight">Automations</h1>
        <p className="text-sm text-stone-400 mt-1">Your email templates and reminder programme</p>
      </div>
      <div className="mb-5">
        <CronStatusBanner />
      </div>

      <div className="flex items-center gap-1 mb-5 border-b border-stone-800">
        {(["templates", "programme"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? "border-emerald-500 text-white" : "border-transparent text-stone-500 hover:text-stone-300"
            }`}>
            {t === "templates" ? "Email Templates" : "Reminder Programme"}
          </button>
        ))}
      </div>

      {tab === "templates" && <EmailTemplates />}
      {tab === "programme" && <ReminderProgramme />}
    </div>
  );
}
