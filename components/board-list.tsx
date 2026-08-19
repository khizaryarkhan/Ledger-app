"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import { STAGE_COLOR_CLASSES, Stage } from "@/lib/stages";
import { fmt } from "@/lib/format";
import { Send, X, AlertTriangle, CalendarClock, AlertOctagon, Check, Pencil, Download, MessageSquare, FileText, Globe, StickyNote, CheckCircle2, XCircle, Clock, Mail, ChevronUp, ChevronDown, ChevronsUpDown, CornerUpLeft, ArrowDownRight, ArrowUpRight, Flag, UserCheck, Filter, Users, SlidersHorizontal, Phone, Voicemail, Zap, TrendingUp, Eye, EyeOff } from "lucide-react";
import { computeNextAction, NEXT_ACTION_FILTERS, type NextActionType } from "@/lib/next-action";
import { useSession } from "next-auth/react";
import { SendInvoicesModal } from "@/components/send-invoices-modal";
import { exportChaseReport, exportStatement, exportAgeingChaseReport, exportCommentTemplate } from "@/lib/export-report";
import { exportStatementPdf } from "@/lib/statement-pdf";
import { EmailComposer } from "@/components/feature";
import { ESCALATION_TYPES, escalationTypeByLabel } from "@/lib/escalation-types";
import { classifyComposition } from "@/lib/receivable-composition";
import { useData } from "@/components/data-provider";
import { ContactsPanel } from "@/components/contacts-panel";

export type BoardRow = {
  inv: any;
  custId: string;
  custName: string;
  projName: string | null;
  regionName: string | null;
  repName: string | null;
  stageLabel: string;
  bal: number;
  days: number;
  email: string | null;
  lastSent: string | null; // ISO date of last outbound email, or null
  lastRef: string | null;  // reference number of the last outbound email
};

const DISPUTE_CATEGORIES = ["Wrong Amount", "Already Paid", "Goods/Service", "Duplicate", "Other"];
const todayStr = () => new Date().toISOString().slice(0, 10);
const uniqEmails = (vals: (string | null)[]) => {
  const set = new Set<string>();
  vals.forEach(v => (v || "").split(/[,;]/).map(e => e.trim().toLowerCase()).filter(e => e.includes("@")).forEach(e => set.add(e)));
  return [...set];
};

export function BoardList({ rows, stages, updateInvoice, refresh, toast, comments = [], orgName, orgLogoUrl, isGroup = false, orgNames = {} }: {
  rows: BoardRow[];
  stages: Stage[];
  updateInvoice: (id: string, patch: any) => Promise<any>;
  refresh: () => Promise<any> | void;
  toast?: (m: string, t?: string) => void;
  comments?: any[];
  orgName?: string;
  orgLogoUrl?: string | null;
  isGroup?: boolean;                       // consolidated Head-Office view
  orgNames?: Record<string, string>;       // orgId → branch name (group mode)
}) {
  const { data: session } = useSession();
  const { contacts: allContacts } = useData() as any;
  const userName = (session?.user?.name as string) || "User";
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [notesOpenId, setNotesOpenId] = useState<string | null>(null);
  const [contactsOpenId, setContactsOpenId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [replyContext, setReplyContext] = useState<any>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [chaseOpenId, setChaseOpenId] = useState<string | null>(null);
  const [chaseDate, setChaseDate] = useState(todayStr());
  const [chaseRef, setChaseRef] = useState("");
  const [chaseMemo, setChaseMemo] = useState("");
  const [savingChase, setSavingChase] = useState(false);

  // Toolbar dropdown menus (View / Export) — one open at a time
  const [toolbarMenu, setToolbarMenu] = useState<"view" | "export" | null>(null);
  const [compositionOpen, setCompositionOpen] = useState(true);

  // Batch operations state
  const [batchPanel, setBatchPanel] = useState<"stage" | "chase" | null>(null);
  const [batchStageVal, setBatchStageVal] = useState("");
  const [batchEscTarget, setBatchEscTarget] = useState("");
  const [batchEscType, setBatchEscType] = useState("");
  const [batchEscNote, setBatchEscNote] = useState("");
  const [batchCommitDate, setBatchCommitDate] = useState("");
  const [batchChaseDate, setBatchChaseDate] = useState(todayStr());
  const [batchChaseRef, setBatchChaseRef] = useState("");
  const [batchChaseMemo, setBatchChaseMemo] = useState("");
  const [batchBusy, setBatchBusy] = useState(false);

  // Notify Owners (escalation digest) state — checked at the invoice level so
  // you can notify one owner, or an owner about only some of their invoices.
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyInvChecked, setNotifyInvChecked] = useState<Set<string>>(new Set()); // invoice ids
  const [notifyExpanded, setNotifyExpanded] = useState<Set<string>>(new Set());     // owner emails
  const [notifyPortal, setNotifyPortal] = useState(true);
  const [notifyMessage, setNotifyMessage] = useState("");
  const [notifySending, setNotifySending] = useState(false);

  // Activity feed grouped by invoice — includes all human-relevant events:
  // internal notes, customer portal messages, dispute events, promise events.
  const ACTIVITY_CHANNELS = new Set(["Note", "Portal", "Dispute", "Promise", "Email", "Chase", "StageChange"]);
  const notesByInv = useMemo(() => {
    const m: Record<string, any[]> = {};
    (comments ?? []).forEach((c: any) => {
      if (!ACTIVITY_CHANNELS.has(c.channel) || !c.invoiceId) return;
      (m[c.invoiceId] ??= []).push(c);
    });
    Object.values(m).forEach(list => list.sort((a, b) => new Date(b.sentAt ?? b.createdAt).getTime() - new Date(a.sentAt ?? a.createdAt).getTime()));
    return m;
  }, [comments]);

  // ── Account comments (the collaboration hub) ──────────────────────────────
  // A comment logged at the Customer or Project level, NOT tied to one invoice.
  //   • Customer comment = customerId set, NO projectId, NO invoiceId → matchedBy "CustomerNote"
  //   • Project comment  = projectId set,  NO invoiceId              → matchedBy "ProjectNote"
  // One source of truth: comments show on their band, feed the A/R Ageing
  // report's Comments column, and are mirrored into every invoice chatbox in
  // scope (context flows down without duplication).
  const projectNotesById = useMemo(() => {
    const m: Record<string, any[]> = {};
    (comments ?? []).forEach((c: any) => {
      if (c.invoiceId || !c.projectId) return;
      if (c.channel !== "Note" && c.channel !== "ProjectNote" && c.channel !== "Chase") return;
      (m[c.projectId] ??= []).push(c);
    });
    Object.values(m).forEach(list => list.sort((a, b) => new Date(b.sentAt ?? b.createdAt).getTime() - new Date(a.sentAt ?? a.createdAt).getTime()));
    return m;
  }, [comments]);

  const customerNotesById = useMemo(() => {
    const m: Record<string, any[]> = {};
    (comments ?? []).forEach((c: any) => {
      if (c.invoiceId || c.projectId || !c.customerId) return;
      if (c.channel === "Chase" || c.matchedBy === "CustomerNote") {
        (m[c.customerId] ??= []).push(c);
      }
    });
    Object.values(m).forEach(list => list.sort((a, b) => new Date(b.sentAt ?? b.createdAt).getTime() - new Date(a.sentAt ?? a.createdAt).getTime()));
    return m;
  }, [comments]);

  // Unified open-state keyed "cust:<id>" | "proj:<id>" so one popover impl serves both bands.
  const [noteHub, setNoteHub] = useState<string | null>(null);
  const [hubText, setHubText] = useState("");
  const [savingHub, setSavingHub] = useState(false);
  const [hubActivityType, setHubActivityType] = useState<"Note" | "Call" | "Email" | "Meeting" | "Voicemail">("Note");
  const [bandStagePicker, setBandStagePicker] = useState<string | null>(null);
  const [bandStageBusy, setBandStageBusy] = useState(false);

  async function addHubNote(opts: { customerId: string; projectId: string | null }) {
    const body = hubText.trim();
    if (!body) return;
    setSavingHub(true);
    try {
      const isChase = hubActivityType !== "Note";
      await fetch("/api/communications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: opts.customerId, projectId: opts.projectId, invoiceId: null,
          direction: "Outbound", channel: isChase ? "Chase" : "Note",
          subject: isChase ? hubActivityType : (opts.projectId ? "Project note" : "Customer note"),
          body, sender: userName, matchedBy: opts.projectId ? "ProjectNote" : "CustomerNote",
        }),
      });
      setHubText(""); setHubActivityType("Note");
      await refresh();
    } finally { setSavingHub(false); }
  }

  // ── Bulk comment import (spreadsheet folks mark up in meetings) ────────────
  const commentFileRef = useRef<HTMLInputElement>(null);
  const [importingComments, setImportingComments] = useState(false);

  async function handleCommentImport(file: File) {
    setImportingComments(true);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      // raw:false → date cells come back as their FORMATTED text (dd/mm/yyyy),
      // rendered from the serial number so there's no timezone day-shift.
      const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
      const hIdx = aoa.findIndex(row => Array.isArray(row) && row.some(c => String(c).trim().toLowerCase() === "comment"));
      if (hIdx < 0) { toast?.("Couldn't find a 'Comment' column in that file", "error"); return; }
      const header = aoa[hIdx].map((c: any) => String(c).trim().toLowerCase());
      const col = (...names: string[]) => { for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; } return -1; };
      const cDate = col("date of comment", "date");
      const cCust = col("customer", "customers");
      const cProj = col("project", "projects");
      const cBody = col("comment");
      const cCid  = col("customerid");
      const cPid  = col("projectid");
      const cell = (row: any[], i: number) => (i >= 0 ? row[i] : undefined);
      // Normalise the date cell to an unambiguous ISO string (YYYY-MM-DD):
      //  • a real Excel date → read from LOCAL components (avoids the UTC
      //    off-by-one that toISOString() causes in negative timezones)
      //  • ISO text (YYYY-MM-DD) → kept as-is
      //  • other text (dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy) → read DAY-FIRST
      //    so "07/08/2026" means 7 Aug, never 8 Jul
      const pad = (n: string | number) => String(n).padStart(2, "0");
      const normDate = (v: any): string => {
        if (v instanceof Date && !isNaN(v.getTime()))
          return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
        const s = String(v ?? "").trim();
        if (!s) return "";
        let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
        m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
        if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${pad(m[2])}-${pad(m[1])}`; }
        return s; // unrecognised — server will try to parse, else fall back to today
      };
      const out: any[] = [];
      for (let i = hIdx + 1; i < aoa.length; i++) {
        const row = aoa[i]; if (!Array.isArray(row)) continue;
        const body = String(cell(row, cBody) ?? "").trim();
        if (!body) continue;
        out.push({
          customerId:   String(cell(row, cCid) ?? "").trim() || null,
          projectId:    String(cell(row, cPid) ?? "").trim() || null,
          customerName: String(cell(row, cCust) ?? "").trim(),
          projectName:  String(cell(row, cProj) ?? "").trim(),
          date:         normDate(cell(row, cDate)),
          body,
        });
      }
      if (!out.length) { toast?.("No comments to import — type into the Comment column first", "error"); return; }
      const res = await fetch("/api/communications/import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: out }),
      });
      const data = await res.json();
      if (!res.ok) { toast?.(data?.error || "Import failed", "error"); return; }
      const bits = [`Imported ${data.imported} comment${data.imported !== 1 ? "s" : ""}`];
      if (data.skippedDupes)   bits.push(`${data.skippedDupes} already logged`);
      if (data.skippedInvalid) bits.push(`${data.skippedInvalid} unmatched`);
      toast?.(bits.join(" · "), data.imported ? "success" : "error");
      if (data.imported) await refresh();
    } catch (e: any) {
      toast?.(e?.message || "Couldn't read that spreadsheet", "error");
    } finally {
      setImportingComments(false);
      if (commentFileRef.current) commentFileRef.current.value = "";
    }
  }

  // An invoice's chat feed = its own events + the project comments for its
  // project + the customer comments for its customer (account context flows down).
  const feedForInv = (inv: any): any[] => {
    const invNotes  = notesByInv[inv.id] ?? [];
    const projNotes = inv.projectId ? (projectNotesById[inv.projectId] ?? []) : [];
    const custNotes = inv.customerId ? (customerNotesById[inv.customerId] ?? []) : [];
    return projNotes.length || custNotes.length ? [...invNotes, ...projNotes, ...custNotes] : invNotes;
  };

  // Activity type metadata for the chase log composer and thread display.
  const ACTIVITY_TYPES = [
    { key: "Note" as const,      Icon: MessageSquare, label: "Note",      color: "text-stone-400" },
    { key: "Call" as const,      Icon: Phone,         label: "Call",      color: "text-emerald-400" },
    { key: "Email" as const,     Icon: Mail,          label: "Email",     color: "text-blue-400" },
    { key: "Meeting" as const,   Icon: Users,         label: "Meeting",   color: "text-amber-400" },
    { key: "Voicemail" as const, Icon: Voicemail,     label: "Voicemail", color: "text-violet-400" },
  ] as const;
  const activityIcon = (type: string) => {
    const found = ACTIVITY_TYPES.find(a => a.key === type);
    if (!found) return <MessageSquare size={10} className="text-stone-400" />;
    const { Icon, color } = found;
    return <Icon size={10} className={color} />;
  };

  // One comment-hub UI for both the Customer band and the Project band. Renders
  // a pill (count + latest inline) and, when open, a popover thread + composer
  // with activity type selector (Call / Email / Meeting / Voicemail / Note).
  // Must live inside a `position: relative` cell.
  const renderCommentHub = (o: {
    kind: "cust" | "proj"; customerId: string; projectId: string | null;
    notes: any[]; title: string; scopeCount: number;
    compact?: boolean; popoverAlign?: "right";
  }) => {
    const key = `${o.kind}:${o.projectId ?? o.customerId}`;
    const open = noteHub === key;
    const latest = o.notes[0];
    const pillOn  = o.kind === "cust" ? "border-violet-800 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20" : "border-sky-800 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20";
    // Latest chase entry for inline preview
    const latestChase = o.notes.find(n => n.channel === "Chase");
    const latestNote  = o.notes.find(n => n.channel === "Note");
    const inlineNote  = latestChase ?? latestNote;
    return (
      <>
        <span className={`inline-flex items-center gap-2 ${o.compact ? "" : "ml-3"} align-middle`} onClick={e => e.stopPropagation()}>
          <button
            onClick={() => { setNoteHub(open ? null : key); setHubText(""); setHubActivityType("Note"); }}
            title={`${o.kind === "cust" ? "Customer" : "Project"} activity log — calls, emails, meetings, notes`}
            className={`inline-flex items-center gap-1 text-[10px] rounded-full px-1.5 py-0.5 border transition-colors ${o.notes.length ? pillOn : "border-stone-700 text-stone-500 hover:text-stone-300"}`}>
            {o.notes.length ? activityIcon(latestChase?.subject ?? "Note") : <MessageSquare size={10} />}
            <span>{o.notes.length || "Activity"}</span>
          </button>
          {inlineNote && !open && !o.compact && (
            <span className="text-[11px] text-stone-500 italic truncate max-w-[300px]" title={inlineNote.body}>
              {inlineNote.channel === "Chase" ? `[${inlineNote.subject}] ` : ""}{inlineNote.body}
            </span>
          )}
        </span>
        {open && (
          <div className={`absolute ${o.popoverAlign === "right" ? "right-0" : "left-6"} top-8 z-30 w-[460px] bg-stone-950 rounded-xl shadow-2xl ring-1 ring-stone-700 text-left flex flex-col`} style={{ maxHeight: "500px" }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-800">
              <div className="flex items-center gap-2">
                <TrendingUp size={13} className={o.kind === "cust" ? "text-violet-400" : "text-sky-400"} />
                <span className="text-[12px] font-semibold text-stone-200">Activity Log · {o.title}</span>
              </div>
              <button onClick={() => setNoteHub(null)} className="text-stone-500 hover:text-stone-200"><X size={14} /></button>
            </div>
            <div className="px-4 py-1.5 text-[10px] text-stone-500 border-b border-stone-800/60">
              Entity-level — visible across all {o.scopeCount} invoice{o.scopeCount !== 1 ? "s" : ""} for this {o.kind === "cust" ? "customer" : "project"}.
            </div>
            {/* Thread */}
            <div className="flex-1 overflow-auto p-3 space-y-2 min-h-0">
              {o.notes.length === 0 ? (
                <div className="text-[12px] text-stone-600 text-center py-5">No activity logged yet</div>
              ) : [...o.notes].reverse().map((n: any) => {
                const ts = new Date(n.sentAt ?? n.createdAt);
                const isChaseEntry = n.channel === "Chase";
                const entryType = isChaseEntry ? (n.subject ?? "Chase") : "Note";
                const borderCls = isChaseEntry
                  ? entryType === "Call" ? "border-emerald-600 bg-emerald-950/20"
                  : entryType === "Email" ? "border-blue-600 bg-blue-950/20"
                  : entryType === "Meeting" ? "border-amber-600 bg-amber-950/20"
                  : entryType === "Voicemail" ? "border-violet-600 bg-violet-950/20"
                  : "border-stone-600 bg-stone-900/40"
                  : o.kind === "cust" ? "border-violet-600 bg-violet-950/20" : "border-sky-600 bg-sky-950/20";
                return (
                  <div key={n.id} className={`rounded-lg px-3 py-2 border-l-2 ${borderCls}`}>
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <div className="flex items-center gap-1.5">
                        {activityIcon(entryType)}
                        <span className="text-[10px] font-semibold text-stone-300">{entryType}</span>
                        <span className="text-[10px] text-stone-600">· {n.sender || "Staff"}</span>
                      </div>
                      <span className="text-[10px] text-stone-600 tabular-nums shrink-0">{ts.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })} {ts.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <div className="text-[12px] text-stone-300 whitespace-pre-wrap leading-relaxed">{n.body}</div>
                  </div>
                );
              })}
            </div>
            {/* Composer */}
            <div className="p-2.5 border-t border-stone-800 space-y-1.5">
              {/* Activity type selector */}
              <div className="flex items-center gap-1">
                {ACTIVITY_TYPES.map(({ key: aKey, Icon: AIcon, label: aLabel, color: aColor }) => (
                  <button key={aKey} onClick={() => setHubActivityType(aKey)}
                    title={aLabel}
                    className={`flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md border transition-colors ${
                      hubActivityType === aKey
                        ? aKey === "Call" ? "border-emerald-700 bg-emerald-500/15 text-emerald-300"
                        : aKey === "Email" ? "border-blue-700 bg-blue-500/15 text-blue-300"
                        : aKey === "Meeting" ? "border-amber-700 bg-amber-500/15 text-amber-300"
                        : aKey === "Voicemail" ? "border-violet-700 bg-violet-500/15 text-violet-300"
                        : "border-stone-600 bg-stone-700/40 text-stone-300"
                        : "border-stone-800 text-stone-600 hover:text-stone-400"
                    }`}>
                    <AIcon size={9} className={hubActivityType === aKey ? aColor : ""} />
                    {aLabel}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <input value={hubText} onChange={e => setHubText(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addHubNote({ customerId: o.customerId, projectId: o.projectId }); } }}
                  placeholder={hubActivityType === "Note" ? `Add a ${o.kind === "cust" ? "customer" : "project"} note…` : `Log ${hubActivityType.toLowerCase()} details…`}
                  autoFocus
                  className={`flex-1 text-[12px] border border-stone-700 rounded-lg px-2.5 py-1.5 bg-stone-900 text-stone-300 placeholder-stone-600 outline-none focus:ring-1 ${o.kind === "cust" ? "focus:ring-violet-500" : "focus:ring-sky-500"}`} />
                <button onClick={() => addHubNote({ customerId: o.customerId, projectId: o.projectId })} disabled={savingHub || !hubText.trim()}
                  className={`text-[11px] font-semibold text-white rounded-lg px-3 py-1.5 disabled:opacity-40 ${o.kind === "cust" ? "bg-violet-600 hover:bg-violet-700" : "bg-sky-600 hover:bg-sky-700"}`}>
                  {savingHub ? "…" : "Log"}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  };

  // Unread inbound tracking — a customer reply (or owner-portal comment) newer
  // than the last time this invoice's activity panel was opened shows a dot.
  const NOTES_SEEN_KEY = "board-notes-seen";
  const [notesSeen, setNotesSeen] = useState<Record<string, number>>({});
  useEffect(() => {
    try { setNotesSeen(JSON.parse(localStorage.getItem(NOTES_SEEN_KEY) ?? "{}")); } catch {}
  }, []);
  const hasUnreadReply = (invId: string): boolean => {
    const latestInbound = (notesByInv[invId] ?? []).find((c: any) => c.direction === "Inbound");
    if (!latestInbound) return false;
    return new Date(latestInbound.sentAt ?? latestInbound.createdAt).getTime() > (notesSeen[invId] ?? 0);
  };
  const markNotesSeen = (invId: string) => {
    setNotesSeen(p => {
      const n = { ...p, [invId]: Date.now() };
      try { localStorage.setItem(NOTES_SEEN_KEY, JSON.stringify(n)); } catch {}
      return n;
    });
  };

  async function addNote(row: BoardRow) {
    if (!noteText.trim()) return;
    setSavingNote(true);
    try {
      await fetch("/api/communications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: row.custId, invoiceId: row.inv.id, projectId: row.inv.projectId ?? null,
          direction: "Outbound", channel: "Note", subject: "Internal note",
          body: noteText.trim(), sender: userName, matchedBy: "Manual",
        }),
      });
      setNoteText(""); await refresh();
    } finally { setSavingNote(false); }
  }

  async function addChase(row: BoardRow) {
    setSavingChase(true);
    try {
      const memo = chaseMemo.trim() || "Chased outside the app";
      await fetch("/api/communications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: row.custId, invoiceId: row.inv.id, projectId: row.inv.projectId ?? null,
          direction: "Outbound", channel: "Chase",
          subject: "Manual chase",
          body: memo,
          sender: userName, matchedBy: "Manual",
          sentAt: new Date(chaseDate).toISOString(),
          refNumber: chaseRef.trim() || row.lastRef || undefined,
        }),
      });
      setChaseOpenId(null); setChaseMemo(""); setChaseDate(todayStr()); setChaseRef("");
      await refresh();
    } finally { setSavingChase(false); }
  }
  async function runBatchStage() {
    if (!batchStageVal || selectedRows.length === 0) return;
    setBatchBusy(true);
    try {
      const isEscalated = batchStageVal === "Escalated";
      const isCommitted = batchStageVal === "Committed";
      const escalateTarget = isEscalated ? escalateTargets.find(t => t.id === batchEscTarget) : undefined;
      const res = await fetch("/api/invoices/batch-update", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids:   selectedRows.map(r => r.inv.id),
          patch: {
            collectionStage:   batchStageVal,
            ...(isEscalated && escalateTarget ? {
              escalatedToUserId: escalateTarget.id,
              escalatedToName:   escalateTarget.name,
              escalatedToEmail:  escalateTarget.email,
              escalationType:    batchEscType || null,
              escalationNote:    batchEscNote.trim() || null,
            } : {}),
            ...(isCommitted && batchCommitDate ? { promiseDate: batchCommitDate } : {}),
          },
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast?.(d.error || "Batch update failed", "error");
        return;
      }
      const { updated } = await res.json();
      setBatchPanel(null); setBatchStageVal(""); setBatchEscTarget(""); setBatchEscType(""); setBatchEscNote(""); setBatchCommitDate("");
      setSelected(new Set());
      await refresh();
      toast?.(`Stage updated for ${updated} invoice${updated !== 1 ? "s" : ""}`, "success");
    } finally { setBatchBusy(false); }
  }

  async function runBatchChase() {
    if (selectedRows.length === 0) return;
    setBatchBusy(true);
    try {
      const memo = batchChaseMemo.trim() || "Chased outside the app";
      const res = await fetch("/api/communications/batch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceIds: selectedRows.map(r => r.inv.id),
          channel:    "Chase",
          direction:  "Outbound",
          subject:    "Manual chase",
          body:       memo,
          sentAt:     new Date(batchChaseDate).toISOString(),
          refNumber:  batchChaseRef.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast?.(d.error || "Batch chase failed", "error");
        return;
      }
      const { created } = await res.json();
      setBatchPanel(null); setBatchChaseMemo(""); setBatchChaseDate(todayStr()); setBatchChaseRef("");
      setSelected(new Set());
      await refresh();
      toast?.(`Chase logged on ${created} invoice${created !== 1 ? "s" : ""}`, "success");
    } finally { setBatchBusy(false); }
  }

  async function changeBandStage(bandKey: string, ids: string[], newStage: string) {
    if (!newStage || ids.length === 0) return;
    setBandStageBusy(true);
    try {
      const toChange = rows.filter(r =>
        ids.includes(r.inv.id) &&
        r.stageLabel !== "Escalated" &&
        !r.inv.hasOpenDispute &&
        r.stageLabel !== newStage
      );
      if (toChange.length > 0) {
        await Promise.all(toChange.map(r => updateInvoice(r.inv.id, { collectionStage: newStage })));
        await refresh();
        toast?.(`Stage → ${newStage} for ${toChange.length} invoice${toChange.length !== 1 ? "s" : ""}`, "success");
      }
    } finally {
      setBandStageBusy(false);
      setBandStagePicker(null);
    }
  }

  const [downloadingPdf, setDownloadingPdf] = useState(false);

  async function downloadPdfs() {
    if (selected.size === 0) return;
    setDownloadingPdf(true);
    try {
      const res = await fetch("/api/invoices/download-pdfs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceIds: [...selected] }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast?.(d.error || "Failed to download PDFs", "error");
        return;
      }
      const skipped = Number(res.headers.get("X-Skipped-Count") ?? 0);
      const blob = await res.blob();
      const cd   = res.headers.get("Content-Disposition") ?? "";
      const match = cd.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? "invoices.zip";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      if (skipped > 0) toast?.(`${skipped} invoice(s) skipped — not found in QuickBooks`, "error");
    } finally { setDownloadingPdf(false); }
  }

  const [busyId, setBusyId] = useState<string | null>(null);
  // Optimistic response overrides per invoice (instant UI feedback until refetch)
  const [opt, setOpt] = useState<Record<string, { hasOpenDispute?: boolean; promiseDate?: string | null; disputeReason?: string | null }>>({});
  const [emailEdit, setEmailEdit] = useState<string | null>(null);
  const [emailVal, setEmailVal] = useState("");
  const [showSend, setShowSend] = useState(false);
  // Quick-send (per-row Send icon) temporarily narrows the selection to one
  // invoice; the user's curated selection is restored if they cancel.
  const [preQuickSendSelection, setPreQuickSendSelection] = useState<Set<string> | null>(null);

  // Escalation picker state
  const [pendingEscalation, setPendingEscalation] = useState<{ invoiceId: string; prevStage: string } | null>(null);
  const [escalateTargets, setEscalateTargets] = useState<{ id: string; name: string; email: string }[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<string>("");
  const [selectedEscType, setSelectedEscType] = useState<string>("");
  const [escNoteVal, setEscNoteVal] = useState<string>("");

  function openEscalationPicker(invoiceId: string, prevStage: string, currentAssigneeId?: string, currentType?: string, currentNote?: string) {
    setPendingEscalation({ invoiceId, prevStage });
    setSelectedTarget(currentAssigneeId ?? "");
    setSelectedEscType(currentType ?? "");
    setEscNoteVal(currentNote ?? "");
    if (!escalateTargets.length) {
      fetch("/api/org/escalate-targets")
        .then(r => r.json())
        .then(d => setEscalateTargets(d.targets ?? []));
    }
  }

  // Commitment-date picker state — mirrors the escalation picker above.
  // Moving a row to "Committed" needs a promiseDate; without one the stage
  // pill would say "Committed" while none of the Response/composition logic
  // (which reads promiseDate, not collectionStage) would treat it as such.
  const [pendingCommit, setPendingCommit] = useState<{ invoiceId: string; prevStage: string } | null>(null);
  const [commitDateVal, setCommitDateVal] = useState<string>("");

  function openCommitPicker(invoiceId: string, prevStage: string, currentDate?: string | null) {
    setPendingCommit({ invoiceId, prevStage });
    setCommitDateVal(currentDate ?? "");
  }

  // Dispute picker state — selecting "Disputed" from the stage dropdown opens
  // this inline (category + reason), same pattern as escalation/commitment.
  const [pendingDispute, setPendingDispute] = useState<{ invoiceId: string; prevStage: string } | null>(null);
  const [disputeCat, setDisputeCat] = useState<string>(DISPUTE_CATEGORIES[0]);
  const [disputeReasonVal, setDisputeReasonVal] = useState<string>("");

  function openDisputePicker(invoiceId: string, prevStage: string, currentReason?: string | null) {
    setPendingDispute({ invoiceId, prevStage });
    setDisputeCat(DISPUTE_CATEGORIES[0]);
    setDisputeReasonVal(currentReason ?? "");
  }

  // ── Column filters ─────────────────────────────────────────────────────
  // Values are strings; multi-selects join values with \x1F. Persisted to
  // localStorage so the working view survives navigation and reloads.
  const MULTI_SEP = "\x1F";
  const VIEW_STORAGE_KEY = "board-list-view";
  const SAVED_VIEWS_KEY = "board-list-saved-views";

  // Migrate the pre-popover filter format: stage used to be a single value,
  // optionally "!"-prefixed for exclusion. Left as-is it matches nothing in
  // the multi-select logic and silently hides every row.
  const migrateCf = (stored: Record<string, string>) => {
    const n = { ...stored };
    if (typeof n.stage === "string" && n.stage.startsWith("!")) {
      n.stageMode = "not";
      n.stage = n.stage.slice(1);
    }
    delete n.due; // old free-text YYYY-MM filter no longer exists
    return n;
  };

  // localStorage is hydrated in an effect (not state initializers) so the
  // first client render matches the server render — avoids hydration errors.
  const [cf, setCf] = useState<Record<string, string>>({});
  const [groupByCustomer, setGroupByCustomer] = useState(true);
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set(["region", "rep"]));
  const [viewHydrated, setViewHydrated] = useState(false);
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(VIEW_STORAGE_KEY) ?? "{}");
      if (stored.cf) setCf(migrateCf(stored.cf));
      if ("groupByCustomer" in stored) setGroupByCustomer(!!stored.groupByCustomer);
      if (stored.overdueOnly) setOverdueOnly(true);
      if (stored.hiddenCols) setHiddenCols(new Set(stored.hiddenCols));
    } catch {}
    setViewHydrated(true);
  }, []);
  const setFilter = (k: string, v: string) => setCf(p => {
    const n = { ...p };
    if (v) n[k] = v; else delete n[k];
    return n;
  });
  const multiVals = (k: string): Set<string> => new Set((cf[k] ?? "").split(MULTI_SEP).filter(Boolean));
  const toggleMulti = (k: string, v: string) => {
    const s = multiVals(k);
    s.has(v) ? s.delete(v) : s.add(v);
    setFilter(k, [...s].join(MULTI_SEP));
  };
  // Which column's filter popover is open
  const [filterOpen, setFilterOpen] = useState<string | null>(null);

  const distinct = (vals: (string | null)[]) => [...new Set(vals.filter(Boolean) as string[])].sort();
  const regionOpts = useMemo(() => distinct(rows.map(r => r.regionName)), [rows]);
  const repOpts    = useMemo(() => distinct(rows.map(r => r.repName)), [rows]);
  const stageOpts  = useMemo(() => distinct(rows.map(r => r.stageLabel)), [rows]);
  const ownerOpts  = useMemo(() => distinct(rows.map(r => r.inv.escalatedToName ?? null)), [rows]);
  const escTypeOpts = useMemo(() => distinct(rows.map(r => r.inv.escalationType ?? null)), [rows]);

  const bucketOf = (days: number) => days <= 0 ? "current" : days <= 30 ? "d30" : days <= 60 ? "d60" : days <= 90 ? "d90" : "d90p";
  const BUCKETS: { key: string; label: string }[] = [
    { key: "current", label: "Current" }, { key: "d30", label: "1–30 days" }, { key: "d60", label: "31–60 days" },
    { key: "d90", label: "61–90 days" }, { key: "d90p", label: "90+ days" },
  ];

  // ── Next Best Action ─────────────────────────────────────────────────────
  // Chase count per invoice = outbound Email/Chase comms. Feeds the
  // Email → Call → Escalate ladder in lib/next-action.ts.
  const chaseCountByInv = useMemo(() => {
    const m: Record<string, number> = {};
    (comments ?? []).forEach((c: any) => {
      if (!c.invoiceId || c.isDraft) return;
      if (c.direction === "Outbound" && (c.channel === "Email" || c.channel === "Chase")) {
        m[c.invoiceId] = (m[c.invoiceId] ?? 0) + 1;
      }
    });
    return m;
  }, [comments]);

  // Latest CHASE-only timestamp per invoice — used by the band-level
  // "last contact" indicator. Only channel "Chase" (manual log or app
  // send) counts; plain invoice-send emails (channel "Email") do NOT.
  const lastChaseByInv = useMemo(() => {
    const m: Record<string, number> = {};
    (comments ?? []).forEach((c: any) => {
      if (!c.invoiceId || c.channel !== "Chase" || c.direction !== "Outbound") return;
      const t = new Date(c.sentAt ?? c.createdAt).getTime();
      if (!m[c.invoiceId] || t > m[c.invoiceId]) m[c.invoiceId] = t;
    });
    return m;
  }, [comments]);

  const nextActionByInv = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const m: Record<string, ReturnType<typeof computeNextAction>> = {};
    rows.forEach(r => {
      m[r.inv.id] = computeNextAction({
        days: r.days,
        email: r.email,
        promiseDate: r.inv.promiseDate,
        hasOpenDispute: r.inv.hasOpenDispute,
        stageLabel: r.stageLabel,
        escalatedToName: r.inv.escalatedToName,
        daysSinceChase: r.lastSent ? Math.floor((Date.now() - new Date(r.lastSent).getTime()) / 86400000) : null,
        chaseCount: chaseCountByInv[r.inv.id] ?? 0,
        unreadReply: hasUnreadReply(r.inv.id),
        todayStr: today,
      });
    });
    return m;
  }, [rows, chaseCountByInv, notesByInv, notesSeen]);

  const filteredRows = useMemo(() => {
    const has = (v: string | null, q: string) => (v ?? "").toLowerCase().includes(q.toLowerCase());
    const today = new Date().toISOString().slice(0, 10);
    return rows.filter(r => {
      if (overdueOnly && r.days <= 0) return false;
      if (cf.invoice && !has(r.inv.invoiceNumber, cf.invoice)) return false;
      if (cf.customer && !has(r.custName, cf.customer)) return false;
      if (cf.project && !has(r.projName, cf.project)) return false;
      if (cf.region && !multiVals("region").has(r.regionName ?? "")) return false;
      if (cf.rep && !multiVals("rep").has(r.repName ?? "")) return false;
      if (cf.stage) {
        const sel = multiVals("stage");
        const match = sel.has(r.stageLabel);
        if (cf.stageMode === "not" ? match : !match) return false;
      }
      if (cf.owner && !multiVals("owner").has(r.inv.escalatedToName ?? "")) return false;
      if (cf.escType && !multiVals("escType").has(r.inv.escalationType ?? "")) return false;
      // Separate from the multi-select above — "" is never addable to a
      // multiVals set (split().filter(Boolean) strips empty strings), so
      // "escalation type is blank" needs its own flag rather than an entry
      // in cf.escType.
      if (cf.escTypeState === "untyped" && r.inv.escalationType) return false;
      // Commitment sub-filter (Stage popover). A broken commitment is a
      // promise whose date has passed and isn't superseded by a dispute.
      if (cf.commitment === "broken"   && !(r.inv.promiseDate && r.inv.promiseDate < today && !r.inv.hasOpenDispute)) return false;
      if (cf.commitment === "upcoming" && !(r.inv.promiseDate && r.inv.promiseDate >= today && !r.inv.hasOpenDispute)) return false;
      if (cf.commitment === "disputed" && !r.inv.hasOpenDispute) return false;
      if (cf.email === "has" && !r.email) return false;
      if (cf.email === "none" && r.email) return false;
      if (cf.emailText) {
        // Match against each address individually (the cell can hold a
        // comma-separated list); trim the query so stray spaces don't kill it.
        const q = cf.emailText.trim().toLowerCase();
        const addrs = (r.email ?? "").toLowerCase().split(/[,;]/).map(s => s.trim());
        if (q && !addrs.some(a => a.includes(q))) return false;
      }
      if (cf.lastSent === "sent" && !r.lastSent) return false;
      if (cf.lastSent === "never" && r.lastSent) return false;
      if (cf.lastSent === "not-today" && r.lastSent?.slice(0, 10) === today) return false;
      if (cf.lastSent === "cutoff" && cf.lastSentBefore && r.lastSent && r.lastSent.slice(0, 10) > cf.lastSentBefore) return false;
      if (cf.lastRef && !has(r.lastRef, cf.lastRef)) return false;
      if (cf.bucket && !multiVals("bucket").has(bucketOf(r.days))) return false;
      if (cf.minAmount && r.bal < Number(cf.minAmount)) return false;
      if (cf.maxAmount && r.bal > Number(cf.maxAmount)) return false;
      if (cf.action && !multiVals("action").has(nextActionByInv[r.inv.id]?.type ?? "none")) return false;
      return true;
    });
  }, [rows, cf, overdueOnly, nextActionByInv]);

  // ── Receivable Composition strip ────────────────────────────────────────
  // Same classifier as the Dashboard widget (lib/receivable-composition.ts),
  // computed from the FULL board (not the currently filtered rows) so a
  // segment always shows what clicking it will select, unaffected by
  // whatever filter happens to be active right now.
  const composition = useMemo(() => {
    const items = rows.map(r => ({
      escalationType:  r.inv.escalationType ?? null,
      collectionStage: r.inv.collectionStage ?? null,
      hasOpenDispute:  r.inv.hasOpenDispute,
      promiseDate:     r.inv.promiseDate,
      overdueDays:     r.days,
      amount:          r.bal,
    }));
    return classifyComposition(items);
  }, [rows]);

  const compositionCcy = useMemo(() => {
    const byCcy: Record<string, number> = {};
    rows.forEach(r => { const c = r.inv.currency || "EUR"; byCcy[c] = (byCcy[c] || 0) + r.bal; });
    return Object.entries(byCcy).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "EUR";
  }, [rows]);

  // Clicking a composition segment replaces the working filter set with
  // exactly the filter(s) that reproduce that segment — a fresh "show me
  // this bucket" action rather than a filter merge.
  function applyCompositionFilter(key: string) {
    const next: Record<string, string> = {};
    switch (key) {
      case "legal":               next.stage = "Escalated"; next.escType = ["Legal Review", "Insolvency Risk"].join(MULTI_SEP); break;
      case "disputed":            next.response = "Disputed"; break;
      case "finalAccount":        next.stage = "Escalated"; next.escType = "Final Account Agreement"; break;
      case "retention":           next.stage = "Retention"; break;
      case "forwardInvoicing":    next.stage = "Escalated"; next.escType = "Forward Invoicing"; break;
      case "handedOver":          next.stage = "Escalated"; next.escType = "Handed Over"; break;
      case "certification":       next.stage = "Escalated"; next.escType = "Certification Pending"; break;
      case "paymentPlan":         next.stage = "Escalated"; next.escType = "Payment Plan"; break;
      case "escalatedOtherType":  next.stage = "Escalated"; next.escType = "Other"; break;
      case "escalatedUntyped":    next.stage = "Escalated"; next.escTypeState = "untyped"; break;
      case "committed":           next.response = "Committed"; break;
      case "inCollection":        next.stage = "Escalated"; next.stageMode = "not"; break;
      case "current":             next.bucket = "current"; break;
    }
    setOverdueOnly(key === "inCollection");
    setCf(next);
  }

  // Persist the working view (filters + grouping + overdue) across visits.
  // Only after hydration — otherwise the initial empty state would clobber
  // the stored view before it loads.
  useEffect(() => {
    if (!viewHydrated) return;
    try { localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify({ cf, groupByCustomer, overdueOnly, hiddenCols: [...hiddenCols] })); } catch {}
  }, [cf, groupByCustomer, overdueOnly, hiddenCols, viewHydrated]);

  // ── Saved views ─────────────────────────────────────────────────────────
  type SavedView = { name: string; cf: Record<string, string>; overdueOnly: boolean; groupByCustomer?: boolean };
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  useEffect(() => {
    try { setSavedViews(JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) ?? "[]")); } catch {}
  }, []);
  const persistViews = (views: SavedView[]) => {
    setSavedViews(views);
    try { localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views)); } catch {}
  };
  function saveCurrentView() {
    const name = prompt("Name this view (e.g. 'Morning chase list'):")?.trim();
    if (!name) return;
    persistViews([...savedViews.filter(v => v.name !== name), { name, cf, overdueOnly, groupByCustomer }]);
  }
  function applyView(v: SavedView) {
    setCf(migrateCf(v.cf));
    setOverdueOnly(v.overdueOnly);
    if (v.groupByCustomer !== undefined) setGroupByCustomer(v.groupByCustomer);
  }
  function deleteView(name: string) { persistViews(savedViews.filter(v => v.name !== name)); }

  // Human-readable chips for every active filter.
  const filterChips = useMemo(() => {
    const chips: { key: string; label: string }[] = [];
    const multiLabel = (k: string, prefix: string) => {
      const vals = [...multiVals(k)];
      if (vals.length) chips.push({ key: k, label: `${prefix}: ${vals.length > 2 ? `${vals.length} selected` : vals.join(", ")}` });
    };
    if (cf.invoice) chips.push({ key: "invoice", label: `Invoice ~ "${cf.invoice}"` });
    if (cf.customer) chips.push({ key: "customer", label: `Customer ~ "${cf.customer}"` });
    if (cf.project) chips.push({ key: "project", label: `Project ~ "${cf.project}"` });
    multiLabel("region", "Region"); multiLabel("rep", "Rep");
    if (cf.stage) {
      const vals = [...multiVals("stage")];
      chips.push({ key: "stage", label: `Stage ${cf.stageMode === "not" ? "is not" : "is"}: ${vals.join(", ")}` });
    }
    multiLabel("owner", "Owner");
    multiLabel("escType", "Escalation");
    if (cf.escTypeState === "untyped") chips.push({ key: "escTypeState", label: "Escalation type: Untyped" });
    if (cf.commitment) chips.push({ key: "commitment", label: cf.commitment === "broken" ? "Broken commitments" : cf.commitment === "upcoming" ? "Upcoming commitments" : "Disputed" });
    if (cf.email) chips.push({ key: "email", label: cf.email === "has" ? "Has email" : "No email" });
    if (cf.emailText) chips.push({ key: "emailText", label: `Email ~ "${cf.emailText}"` });
    if (cf.lastSent === "cutoff" && cf.lastSentBefore) chips.push({ key: "lastSent", label: `Not chased since ${cf.lastSentBefore}` });
    else if (cf.lastSent) chips.push({ key: "lastSent", label: cf.lastSent === "not-today" ? "Not sent today" : cf.lastSent === "never" ? "Never sent" : "Sent" });
    if (cf.lastRef) chips.push({ key: "lastRef", label: `Ref ~ "${cf.lastRef}"` });
    if (cf.bucket) chips.push({ key: "bucket", label: `Aging: ${[...multiVals("bucket")].map(b => BUCKETS.find(x => x.key === b)?.label ?? b).join(", ")}` });
    if (cf.minAmount || cf.maxAmount) chips.push({ key: "amount", label: `Amount ${cf.minAmount ? `≥ ${cf.minAmount}` : ""}${cf.minAmount && cf.maxAmount ? " " : ""}${cf.maxAmount ? `≤ ${cf.maxAmount}` : ""}` });
    if (cf.action) { const vals = [...multiVals("action")]; chips.push({ key: "action", label: `Action: ${vals.map(v => NEXT_ACTION_FILTERS.find(f => f.key === v)?.label ?? v).join(", ")}` }); }
    return chips;
  }, [cf]);
  function clearChip(key: string) {
    setCf(p => {
      const n = { ...p };
      if (key === "stage") { delete n.stage; delete n.stageMode; }
      else if (key === "lastSent") { delete n.lastSent; delete n.lastSentBefore; }
      else if (key === "amount") { delete n.minAmount; delete n.maxAmount; }
      else delete n[key];
      return n;
    });
  }

  // ── Column sort ────────────────────────────────────────────────────────────
  const [sortCol, setSortCol] = useState<string>("customer");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const handleSort = (col: string) => {
    setSortDir(prev => sortCol === col ? (prev === "asc" ? "desc" : "asc") : "asc");
    setSortCol(col);
  };

  const sortedRows = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const cmp = (a: string | number | null | undefined, b: string | number | null | undefined): number => {
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      return a < b ? -1 : a > b ? 1 : 0;
    };
    return [...filteredRows].sort((a, b) => {
      let primary = 0;
      switch (sortCol) {
        case "invoice":     primary = cmp(a.inv.invoiceNumber, b.inv.invoiceNumber); break;
        case "customer":    primary = cmp(a.custName, b.custName); break;
        case "project":     primary = cmp(a.projName, b.projName); break;
        case "region":      primary = cmp(a.regionName, b.regionName); break;
        case "rep":         primary = cmp(a.repName, b.repName); break;
        case "stage":       primary = cmp(a.stageLabel, b.stageLabel); break;
        case "lastSent":    primary = cmp(a.lastSent, b.lastSent); break;
        case "action":      primary = cmp(nextActionByInv[a.inv.id]?.rank ?? 0, nextActionByInv[b.inv.id]?.rank ?? 0); break;
        case "due":         primary = cmp(a.inv.dueDate, b.inv.dueDate); break;
        case "outstanding": primary = cmp(a.bal, b.bal); break;
        case "days":        primary = cmp(a.days, b.days); break;
      }
      if (primary !== 0) return primary * dir;
      // Secondary: always customer → project → due date for grouping
      const s1 = cmp(a.custName, b.custName); if (s1 !== 0) return s1;
      const s2 = cmp(a.projName, b.projName); if (s2 !== 0) return s2;
      return cmp(a.inv.dueDate, b.inv.dueDate);
    });
  }, [filteredRows, sortCol, sortDir, nextActionByInv]);

  // Rows to render — flat, or Customer → Project bands (both levels sorted by
  // subtotal desc, both collapsible) interleaved with their rows.
  const [collapsedCust, setCollapsedCust] = useState<Set<string>>(new Set());
  const [expandedProj, setExpandedProj] = useState<Set<string>>(new Set()); // "custId|projName" — empty = all collapsed (default)

  type DisplayItem =
    | { type: "row"; r: BoardRow }
    | { type: "band"; custId: string; custName: string; orgId: string | null; count: number; total: Record<string, number>; ids: string[]; maxDays: number; collapsed: boolean; dominantStage: string; bandNBA: { label: string; detail: string | null } | null; lastChaseInfo: { days: number; activityType: string } | null }
    | { type: "projBand"; key: string; custId: string; projectId: string | null; projName: string; count: number; total: Record<string, number>; ids: string[]; maxDays: number; collapsed: boolean; dominantStage: string; bandNBA: { label: string; detail: string | null } | null; lastChaseInfo: { days: number; activityType: string } | null };

  const displayRows = useMemo((): DisplayItem[] => {
    if (!groupByCustomer) return sortedRows.map(r => ({ type: "row" as const, r }));

    type ProjG = { projName: string; rows: BoardRow[]; total: Record<string, number>; sortTotal: number; maxDays: number };
    type CustG = { custName: string; projects: Map<string, ProjG>; total: Record<string, number>; sortTotal: number; count: number; maxDays: number };
    const groups = new Map<string, CustG>();
    sortedRows.forEach(r => {
      if (!groups.has(r.custId)) groups.set(r.custId, { custName: r.custName, projects: new Map(), total: {}, sortTotal: 0, count: 0, maxDays: 0 });
      const g = groups.get(r.custId)!;
      const c = r.inv.currency ?? "EUR";
      g.total[c] = (g.total[c] ?? 0) + r.bal;
      g.sortTotal += r.bal;
      g.count++;
      g.maxDays = Math.max(g.maxDays, r.days);
      const pKey = r.projName ?? "";
      if (!g.projects.has(pKey)) g.projects.set(pKey, { projName: r.projName ?? "No project", rows: [], total: {}, sortTotal: 0, maxDays: 0 });
      const p = g.projects.get(pKey)!;
      p.rows.push(r);
      p.total[c] = (p.total[c] ?? 0) + r.bal;
      p.sortTotal += r.bal;
      p.maxDays = Math.max(p.maxDays, r.days);
    });

    const stageRank: Record<string, number> = { Escalated: 100, Disputed: 90, Committed: 70 };
    const computeDominantStage = (bandRows: BoardRow[]) => {
      let bestRank = -1; let bestStage = "";
      const counts: Record<string, number> = {};
      bandRows.forEach(r => {
        const stage = r.inv.hasOpenDispute ? "Disputed" : r.stageLabel;
        const rank = stageRank[stage] ?? 0;
        counts[stage] = (counts[stage] ?? 0) + 1;
        if (rank > bestRank) { bestRank = rank; bestStage = stage; }
      });
      if (bestRank > 0) return bestStage;
      return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    };
    const computeBandNBA = (bandRows: BoardRow[]) => {
      let best: { label: string; detail: string | null; rank: number } | null = null;
      bandRows.forEach(r => {
        const na = nextActionByInv[r.inv.id];
        if (na && (!best || na.rank > best.rank)) best = { label: na.label, detail: (na as any).detail ?? null, rank: na.rank };
      });
      return best ? { label: (best as any).label, detail: (best as any).detail } : null;
    };
    const computeLastChaseInfo = (bandRows: BoardRow[], custId: string, projId?: string | null) => {
      // Entity-level activity hub entries (Notes + Chase logs on the band itself).
      // Only logged CHASES count toward "Last Email Ref" — internal notes
      // (channel "Note"/"ProjectNote"/CustomerNote) must NOT bump it, matching
      // the invoice-level rule (lastChaseByInv is Chase-only).
      const entityNotes = projId ? (projectNotesById[projId] ?? []) : (customerNotesById[custId] ?? []);
      const latestEntity = entityNotes.find((n: any) => n.channel === "Chase");
      const entityMs = latestEntity ? new Date(latestEntity.sentAt ?? latestEntity.createdAt).getTime() : 0;
      const entityType = latestEntity?.subject ?? "Chase";
      // Invoice-level chase-only timestamps (only channel "Chase", not plain email sends)
      const invChaseMs = Math.max(0, ...bandRows.map(r => lastChaseByInv[r.inv.id] ?? 0));
      const latestMs = Math.max(entityMs, invChaseMs);
      return latestMs > 0 ? { days: Math.floor((Date.now() - latestMs) / 86400000), activityType: entityMs >= invChaseMs ? entityType : "Chase" } : null;
    };

    const out: DisplayItem[] = [];
    for (const [custId, g] of [...groups.entries()].sort((a, b) => b[1].sortTotal - a[1].sortTotal)) {
      const allIds = [...g.projects.values()].flatMap(p => p.rows.map(r => r.inv.id));
      const allRows = [...g.projects.values()].flatMap(p => p.rows);
      const custCollapsed = collapsedCust.has(custId);
      out.push({ type: "band", custId, custName: g.custName, orgId: allRows[0]?.inv?.orgId ?? null, count: g.count, total: g.total, ids: allIds, maxDays: g.maxDays, collapsed: custCollapsed,
        dominantStage: computeDominantStage(allRows),
        bandNBA: computeBandNBA(allRows),
        lastChaseInfo: computeLastChaseInfo(allRows, custId, null),
      });
      if (custCollapsed) continue;
      const projGroups = [...g.projects.values()].sort((a, b) => b.sortTotal - a.sortTotal);
      const showProjBands = projGroups.length > 1 || projGroups[0]?.projName !== "No project";
      for (const p of projGroups) {
        const projKey = `${custId}|${p.projName}`;
        const projCollapsed = !expandedProj.has(projKey);
        if (showProjBands) {
          out.push({ type: "projBand", key: projKey, custId, projectId: p.rows[0]?.inv.projectId ?? null, projName: p.projName, count: p.rows.length, total: p.total, ids: p.rows.map(r => r.inv.id), maxDays: p.maxDays, collapsed: projCollapsed,
            dominantStage: computeDominantStage(p.rows),
            bandNBA: computeBandNBA(p.rows),
            lastChaseInfo: computeLastChaseInfo(p.rows, custId, p.rows[0]?.inv.projectId),
          });
          if (projCollapsed) continue;
        }
        p.rows.forEach(r => out.push({ type: "row", r }));
      }
    }
    return out;
  }, [sortedRows, groupByCustomer, collapsedCust, expandedProj, nextActionByInv, customerNotesById, projectNotesById, lastChaseByInv]);

  const allCustIds = useMemo(() => [...new Set(sortedRows.map(r => r.custId))], [sortedRows]);
  const allProjKeys = useMemo(() => {
    const seen = new Set<string>();
    sortedRows.forEach(r => seen.add(`${r.custId}|${r.projName ?? ""}`));
    return [...seen];
  }, [sortedRows]);

  const stageLabels = stages.filter(s => s.visible).map(s => s.label);
  const stageColor = (label: string) => STAGE_COLOR_CLASSES[stages.find(s => s.label === label)?.color ?? "stone"]?.badge ?? "bg-stone-100 text-stone-700";
  const fmtSent = (d: string | null) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }) : null;
  // Relative "Nd ago" — the actionable number for chasing; exact date on hover.
  const daysAgo = (d: string) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  const agoCls = (n: number) => n >= 14 ? "text-rose-400" : n >= 7 ? "text-amber-400" : "text-stone-400";

  const allSelected = sortedRows.length > 0 && sortedRows.every(r => selected.has(r.inv.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(sortedRows.map(r => r.inv.id)));
  const toggleOne = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const selectedRows = useMemo(() => rows.filter(r => selected.has(r.inv.id)), [rows, selected]);
  // stageMode alone (no stages picked) isn't an active filter.
  const anyFilter = Object.entries(cf).some(([k, v]) => v && !(k === "stageMode" && !cf.stage));

  // Prune the selection when filters hide rows — batch actions must never
  // silently operate on invoices the user can no longer see.
  useEffect(() => {
    const visible = new Set(filteredRows.map(r => r.inv.id));
    setSelected(prev => {
      if (![...prev].some(id => !visible.has(id))) return prev;
      return new Set([...prev].filter(id => visible.has(id)));
    });
  }, [filteredRows]);

  // Escalated invoices grouped by owner — source for the Notify Owners digest.
  // Uses the selection if any, otherwise everything currently visible.
  const ownerGroups = useMemo(() => {
    const src = selected.size ? rows.filter(r => selected.has(r.inv.id)) : rows;
    const m = new Map<string, { name: string; email: string; items: BoardRow[]; total: Record<string, number> }>();
    src.forEach(r => {
      if (r.inv.collectionStage !== "Escalated" || !r.inv.escalatedToEmail) return;
      const email = String(r.inv.escalatedToEmail).toLowerCase();
      if (!m.has(email)) m.set(email, { name: r.inv.escalatedToName ?? email, email, items: [], total: {} });
      const g = m.get(email)!;
      g.items.push(r);
      const c = r.inv.currency ?? "EUR";
      g.total[c] = (g.total[c] ?? 0) + r.bal;
    });
    return [...m.values()].sort((a, b) => b.items.length - a.items.length);
  }, [rows, selected]);

  async function sendOwnerDigests() {
    if (notifyInvChecked.size === 0) return;
    setNotifySending(true);
    try {
      const res = await fetch("/api/board/notify-owners", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceIds: [...notifyInvChecked],
          includePortal: notifyPortal,
          message: notifyMessage.trim() || undefined,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast?.(d.error || "Failed to send digests", "error"); return; }
      if (d.failed > 0) {
        const firstErr = (d.results ?? []).find((r: any) => !r.sent)?.error;
        toast?.(`${d.sent} sent · ${d.failed} failed${firstErr ? ` — ${firstErr}` : ""}`, "error");
        if (d.sent === 0) return; // keep the modal open so the user can retry
      } else {
        toast?.(`Digest sent to ${d.sent} owner${d.sent !== 1 ? "s" : ""}`, "success");
      }
      setNotifyOpen(false); setNotifyMessage("");
      await refresh();
    } finally { setNotifySending(false); }
  }

  const thCls = "px-2 py-2 text-[11px] font-medium text-stone-500 whitespace-nowrap";
  const inputCls = "w-full text-[11px] border border-stone-700 rounded px-1.5 py-1 bg-stone-800 text-stone-300 outline-none focus:ring-1 focus:ring-emerald-500";

  const showRegion   = !hiddenCols.has("region");
  const showRep      = !hiddenCols.has("rep");
  const showEmail    = !hiddenCols.has("email");
  // In grouped mode Customer + Project are implicit from band headers — hide both
  const showCustomer = !groupByCustomer;
  const showProject  = !groupByCustomer;
  const toggleCol = (key: string) => setHiddenCols(prev => {
    const n = new Set(prev);
    n.has(key) ? n.delete(key) : n.add(key);
    return n;
  });
  const selectedCustomers = useMemo(() => new Set(selectedRows.map(r => r.custId)), [selectedRows]);

  async function save(id: string, patch: any) {
    setBusyId(id);
    // No full refresh() here — updateInvoice patches the invoices state in the
    // data provider (and pulls fresh communications on stage changes), so the
    // row updates instantly instead of waiting on an 8-endpoint reload.
    try { await updateInvoice(id, patch); }
    finally { setBusyId(null); }
  }

  async function postResponse(id: string, payload: any) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/invoices/${id}/response`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast?.(d.error || `Update failed (${res.status})`, "error");
        return;
      }
      // Optimistic: reflect the change instantly, then reconcile with the refetch
      const override = payload.type === "clear"
        ? { hasOpenDispute: false, promiseDate: null, disputeReason: null }
        : payload.type === "promise"
        ? { hasOpenDispute: false, promiseDate: payload.promiseDate, disputeReason: null }
        : { hasOpenDispute: true, disputeReason: payload.reason ?? "Disputed" };
      setOpt(prev => ({ ...prev, [id]: override }));
      await refresh();
      setOpt(prev => { const n = { ...prev }; delete n[id]; return n; });
    } catch (e: any) {
      toast?.(e?.message || "Network error", "error");
    } finally { setBusyId(null); }
  }


  // Export selected (or all filtered) rows to an Excel-compatible CSV.
  function exportExcel() {
    const src = selected.size ? sortedRows.filter(r => selected.has(r.inv.id)) : sortedRows;
    const headers = ["Invoice", "Customer", "Project", "Region", "Rep", "Stage", "Owner", "Escalation type", "Response", "Email", "Last sent", "Last ref", "Next action", "Due", "Days overdue", "Outstanding"];
    const esc = (v: any) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [headers.join(",")];
    src.forEach(r => {
      const resp = r.inv.hasOpenDispute ? `Disputed${r.inv.disputeReason ? ": " + r.inv.disputeReason : ""}`
        : r.inv.promiseDate ? `Committed ${r.inv.promiseDate}` : "";
      lines.push([
        r.inv.invoiceNumber, r.custName, r.projName ?? "", r.regionName ?? "", r.repName ?? "",
        r.stageLabel, r.inv.escalatedToName ?? "", r.inv.escalationType ?? "", resp, r.email ?? "", r.lastSent ? fmtSent(r.lastSent) : "", r.lastRef ?? "",
        (() => { const na = nextActionByInv[r.inv.id]; return na ? `${na.label}${na.detail ? " (" + na.detail + ")" : ""}` : ""; })(), r.inv.dueDate, r.days > 0 ? r.days : 0, r.bal,
      ].map(esc).join(","));
    });
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `collections-${todayStr()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Selection action bar */}
      {selected.size > 0 && (
        <div className="flex flex-col bg-stone-900 text-white border-b border-stone-800">
          {/* Action bar row */}
          <div className="flex items-center gap-3 px-4 py-2.5 flex-wrap">
            <span className="text-sm font-medium">{selected.size} selected · {(() => {
              const m: Record<string,number> = {};
              selectedRows.forEach(r => { const c = r.inv.currency ?? "USD"; m[c] = (m[c]||0) + r.bal; });
              return Object.entries(m).sort((a,b)=>b[1]-a[1]).map(([c,v]) => fmt.money(v,c)).join(" · ");
            })()}</span>
            {selectedCustomers.size > 1 && (
              <span className="flex items-center gap-1.5 text-[12px] text-amber-300 bg-amber-500/15 px-2 py-1 rounded">
                <AlertTriangle size={13} /> {selectedCustomers.size} different customers
              </span>
            )}
            <div className="flex-1" />
            <button
              onClick={() => { setBatchPanel(p => p === "stage" ? null : "stage"); if (!escalateTargets.length) fetch("/api/org/escalate-targets").then(r => r.json()).then(d => setEscalateTargets(d.targets ?? [])); }}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border transition-colors ${batchPanel === "stage" ? "bg-emerald-600 text-white border-emerald-600" : "border-stone-600 text-stone-300 hover:bg-stone-800"}`}>
              <Pencil size={13} /> Change Stage
            </button>
            <button
              onClick={() => { setBatchPanel(p => p === "chase" ? null : "chase"); setBatchChaseDate(todayStr()); }}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border transition-colors ${batchPanel === "chase" ? "bg-amber-600 text-white border-amber-600" : "border-stone-600 text-stone-300 hover:bg-stone-800"}`}>
              <ArrowUpRight size={13} /> Log Chase
            </button>
            <button onClick={() => setSelected(new Set())} className="text-stone-400 hover:text-white p-1"><X size={15} /></button>
            <button onClick={() => setShowSend(true)}
              className="flex items-center gap-1.5 bg-white text-stone-900 text-sm font-semibold px-3 py-1.5 rounded-md hover:bg-stone-100">
              <Send size={14} /> Send
            </button>
          </div>

          {/* Batch Stage panel */}
          {batchPanel === "stage" && (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-stone-800/60 border-t border-stone-700 flex-wrap">
              <span className="text-[12px] text-stone-400">Move {selected.size} invoice{selected.size !== 1 ? "s" : ""} to:</span>
              <select
                value={batchStageVal}
                onChange={e => { setBatchStageVal(e.target.value); if (e.target.value === "Escalated" && !escalateTargets.length) fetch("/api/org/escalate-targets").then(r => r.json()).then(d => setEscalateTargets(d.targets ?? [])); }}
                className="text-[12px] border border-stone-600 rounded px-2 py-1 bg-stone-900 text-stone-200 outline-none focus:ring-1 focus:ring-emerald-500">
                <option value="">Pick a stage…</option>
                {stageLabels.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {batchStageVal === "Escalated" && (
                <>
                  <select
                    value={batchEscTarget}
                    onChange={e => setBatchEscTarget(e.target.value)}
                    className="text-[12px] border border-stone-600 rounded px-2 py-1 bg-stone-900 text-stone-200 outline-none focus:ring-1 focus:ring-emerald-500">
                    <option value="">Assign to…</option>
                    {escalateTargets.map(t => <option key={t.id} value={t.id}>{t.name} ({t.email})</option>)}
                  </select>
                  <select
                    value={batchEscType}
                    onChange={e => setBatchEscType(e.target.value)}
                    title={escalationTypeByLabel(batchEscType)?.description}
                    className="text-[12px] border border-stone-600 rounded px-2 py-1 bg-stone-900 text-stone-200 outline-none focus:ring-1 focus:ring-emerald-500">
                    <option value="">Escalation type…</option>
                    {ESCALATION_TYPES.map(t => <option key={t.key} value={t.label} title={t.description}>{t.label}</option>)}
                  </select>
                  <input
                    value={batchEscNote}
                    onChange={e => setBatchEscNote(e.target.value)}
                    placeholder="Note for the assignee (optional)…"
                    maxLength={2000}
                    className="text-[12px] border border-stone-600 rounded px-2 py-1 bg-stone-900 text-stone-200 outline-none focus:ring-1 focus:ring-emerald-500 flex-1 min-w-[160px] placeholder:text-stone-600"
                  />
                </>
              )}
              {batchStageVal === "Escalated" && batchEscType && (
                <span className="basis-full text-[10px] text-stone-500 leading-snug">
                  {escalationTypeByLabel(batchEscType)?.description}
                </span>
              )}
              {batchStageVal === "Committed" && (
                <>
                  <span className="text-[12px] text-stone-400">Promised date:</span>
                  <input
                    type="date"
                    value={batchCommitDate}
                    onChange={e => setBatchCommitDate(e.target.value)}
                    className="text-[12px] border border-stone-600 rounded px-2 py-1 bg-stone-900 text-stone-200 outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </>
              )}
              <button
                disabled={!batchStageVal || batchBusy || (batchStageVal === "Escalated" && !!batchEscTarget && !batchEscType) || (batchStageVal === "Committed" && !batchCommitDate)}
                onClick={runBatchStage}
                className="flex items-center gap-1.5 text-[12px] font-semibold bg-emerald-600 text-white rounded-md px-3 py-1.5 disabled:opacity-40 hover:bg-emerald-700">
                {batchBusy ? <><span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</> : <><Check size={13} /> Apply</>}
              </button>
              <button onClick={() => setBatchPanel(null)} className="text-[12px] text-stone-500 hover:text-stone-300">Cancel</button>
            </div>
          )}

          {/* Batch Chase panel */}
          {batchPanel === "chase" && (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-stone-800/60 border-t border-stone-700 flex-wrap">
              <span className="text-[12px] text-stone-400">Log chase on {selected.size} invoice{selected.size !== 1 ? "s" : ""}:</span>
              <input type="date" value={batchChaseDate} max={todayStr()} onChange={e => setBatchChaseDate(e.target.value)}
                className="text-[12px] border border-stone-600 rounded px-2 py-1 bg-stone-900 text-stone-200 outline-none focus:ring-1 focus:ring-amber-500 w-36" />
              <input placeholder="Ref (optional)" value={batchChaseRef} onChange={e => setBatchChaseRef(e.target.value)}
                className="text-[12px] border border-stone-600 rounded px-2 py-1 bg-stone-900 text-stone-200 outline-none focus:ring-1 focus:ring-amber-500 w-32" />
              <input placeholder="Memo (optional)" value={batchChaseMemo} onChange={e => setBatchChaseMemo(e.target.value)}
                className="text-[12px] border border-stone-600 rounded px-2 py-1 bg-stone-900 text-stone-200 outline-none focus:ring-1 focus:ring-amber-500 flex-1 min-w-[160px]" />
              <button
                disabled={batchBusy}
                onClick={runBatchChase}
                className="flex items-center gap-1.5 text-[12px] font-semibold bg-amber-600 text-white rounded-md px-3 py-1.5 disabled:opacity-40 hover:bg-amber-700">
                {batchBusy ? <><span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</> : <><ArrowUpRight size={13} /> Log</>}
              </button>
              <button onClick={() => setBatchPanel(null)} className="text-[12px] text-stone-500 hover:text-stone-300">Cancel</button>
            </div>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-stone-800 bg-stone-900 shrink-0 flex-wrap gap-y-1.5">
        <span className="text-[12px] text-stone-400">
          <span className="font-semibold text-stone-200">{sortedRows.length}</span> invoice{sortedRows.length !== 1 ? "s" : ""}
          {" · "}
          <span className="font-semibold text-stone-200 tabular-nums">
            {(() => {
              const m: Record<string, number> = {};
              sortedRows.forEach(r => { const c = r.inv.currency ?? "EUR"; m[c] = (m[c] || 0) + r.bal; });
              return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([c, v]) => fmt.money(v, c)).join(" · ") || "—";
            })()}
          </span>
          {(anyFilter || overdueOnly) && <span className="text-stone-600"> (filtered)</span>}
          {selected.size ? ` · ${selected.size} selected` : ""}
        </span>
        <div className="flex items-center gap-2">
          {/* View menu — grouping, collapse, overdue */}
          <div className="relative">
            <button onClick={() => setToolbarMenu(m => m === "view" ? null : "view")}
              className={`flex items-center gap-1.5 text-xs font-medium rounded-md px-2.5 py-1.5 border transition-colors ${
                toolbarMenu === "view" || groupByCustomer || overdueOnly || hiddenCols.size > 0
                  ? "text-white border-stone-500 bg-stone-800"
                  : "text-stone-400 border-stone-700 hover:bg-stone-800"}`}>
              <SlidersHorizontal size={13} /> View
              {(groupByCustomer || overdueOnly || hiddenCols.size > 0) && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
              <ChevronDown size={12} className={`transition-transform ${toolbarMenu === "view" ? "rotate-180" : ""}`} />
            </button>
            {toolbarMenu === "view" && (
              <div className="absolute right-0 top-full mt-1 z-30 w-56 bg-stone-900 border border-stone-700 rounded-lg shadow-2xl p-1.5">
                <button onClick={() => setGroupByCustomer(v => !v)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[12px] text-stone-300 hover:bg-stone-800 hover:text-white transition-colors">
                  <Users size={13} className="text-stone-500" />
                  <span className="flex-1 text-left">Group by customer</span>
                  {groupByCustomer && <Check size={13} className="text-emerald-400" />}
                </button>
                {groupByCustomer && (
                  <button onClick={() => setCollapsedCust(p => p.size > 0 ? new Set() : new Set(allCustIds))}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[12px] text-stone-300 hover:bg-stone-800 hover:text-white transition-colors">
                    {collapsedCust.size > 0 ? <ChevronDown size={13} className="text-stone-500" /> : <ChevronUp size={13} className="text-stone-500" />}
                    <span className="flex-1 text-left">{collapsedCust.size > 0 ? "Expand all customers" : "Collapse all customers"}</span>
                  </button>
                )}
                {groupByCustomer && (
                  <button onClick={() => setExpandedProj(p => p.size > 0 ? new Set() : new Set(allProjKeys))}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[12px] text-stone-300 hover:bg-stone-800 hover:text-white transition-colors">
                    {expandedProj.size > 0 ? <ChevronUp size={13} className="text-stone-500" /> : <ChevronDown size={13} className="text-stone-500" />}
                    <span className="flex-1 text-left">{expandedProj.size > 0 ? "Collapse all projects" : "Expand all projects"}</span>
                  </button>
                )}
                <button onClick={() => setOverdueOnly(v => !v)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[12px] text-stone-300 hover:bg-stone-800 hover:text-white transition-colors">
                  <AlertTriangle size={13} className="text-stone-500" />
                  <span className="flex-1 text-left">Overdue only</span>
                  {overdueOnly && <Check size={13} className="text-emerald-400" />}
                </button>
                <div className="my-1 border-t border-stone-800" />
                <div className="px-2.5 pt-1 pb-0.5 text-[10px] font-semibold text-stone-600 uppercase tracking-wider">Columns</div>
                {([
                  { key: "region", label: "Region" },
                  { key: "rep",    label: "Rep" },
                  { key: "email",  label: "Email" },
                ] as { key: string; label: string }[]).map(({ key, label }) => {
                  const visible = !hiddenCols.has(key);
                  return (
                    <button key={key} onClick={() => toggleCol(key)}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[12px] text-stone-300 hover:bg-stone-800 hover:text-white transition-colors">
                      {visible
                        ? <Eye size={13} className="text-stone-500" />
                        : <EyeOff size={13} className="text-stone-600" />}
                      <span className={`flex-1 text-left ${visible ? "" : "text-stone-500"}`}>{label}</span>
                      {visible && <Check size={13} className="text-emerald-400" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Export menu — Excel, Chase Report, PDFs */}
          <div className="relative">
            <button onClick={() => setToolbarMenu(m => m === "export" ? null : "export")}
              className={`flex items-center gap-1.5 text-xs font-medium rounded-md px-2.5 py-1.5 border transition-colors ${
                toolbarMenu === "export" ? "text-white border-stone-500 bg-stone-800" : "text-stone-400 border-stone-700 hover:bg-stone-800"}`}>
              <Download size={13} /> Export
              <ChevronDown size={12} className={`transition-transform ${toolbarMenu === "export" ? "rotate-180" : ""}`} />
            </button>
            {toolbarMenu === "export" && (
              <div className="absolute right-0 top-full mt-1 z-30 w-64 bg-stone-900 border border-stone-700 rounded-lg shadow-2xl p-1.5">
                <button onClick={() => { exportExcel(); setToolbarMenu(null); }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[12px] text-stone-300 hover:bg-stone-800 hover:text-white transition-colors">
                  <Download size={13} className="text-stone-500" />
                  <span className="flex-1 text-left">Excel — board view{selected.size ? ` (${selected.size} selected)` : ""}</span>
                </button>
                <button
                  onClick={() => {
                    exportChaseReport({
                      orgName: orgName ?? "Organisation",
                      rows: selected.size ? sortedRows.filter(r => selected.has(r.inv.id)) : sortedRows,
                      comments: comments ?? [],
                    });
                    setToolbarMenu(null);
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[12px] text-stone-300 hover:bg-stone-800 hover:text-white transition-colors">
                  <FileText size={13} className="text-stone-500" />
                  <div className="flex-1 text-left">
                    Chase Report{selected.size ? ` (${selected.size} selected)` : ""}
                    <div className="text-[10px] text-stone-600">Management report — detail + summary by owner</div>
                  </div>
                </button>
                <button
                  onClick={async () => {
                    setToolbarMenu(null);
                    // Selection if any; otherwise the whole open-invoice set
                    // (an ageing report covers the book, not just the on-screen
                    // filtered view — and this avoids a blank file when a
                    // stale selection or an empty filter would leave 0 rows).
                    const src = selected.size ? rows.filter(r => selected.has(r.inv.id)) : rows;
                    if (!src.length) { toast?.("No open invoices to include in the report", "error"); return; }
                    try {
                      await exportAgeingChaseReport({ orgName: orgName ?? "Organisation", rows: src, comments: comments ?? [] });
                    } catch (e: any) {
                      toast?.(e?.message || "Couldn't generate the report", "error");
                    }
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[12px] text-stone-300 hover:bg-stone-800 hover:text-white transition-colors">
                  <FileText size={13} className="text-stone-500" />
                  <div className="flex-1 text-left">
                    A/R Ageing &amp; Chase{selected.size ? ` (${selected.size})` : ""}
                    <div className="text-[10px] text-stone-600">Customer → project ageing, status, last ref &amp; chase count</div>
                  </div>
                </button>
                <button
                  onClick={() => {
                    exportStatementPdf({
                      orgName: orgName ?? "Organisation",
                      rows: selected.size ? sortedRows.filter(r => selected.has(r.inv.id)) : sortedRows,
                      logoUrl: orgLogoUrl ?? null,
                    });
                    setToolbarMenu(null);
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[12px] text-stone-300 hover:bg-stone-800 hover:text-white transition-colors">
                  <FileText size={13} className="text-stone-500" />
                  <div className="flex-1 text-left">
                    Statement of Open Invoices — PDF{selected.size ? ` (${selected.size})` : ""}
                    <div className="text-[10px] text-stone-600">Printable, grouped by customer then project</div>
                  </div>
                </button>
                <button
                  onClick={() => {
                    exportStatement({
                      orgName: orgName ?? "Organisation",
                      rows: selected.size ? sortedRows.filter(r => selected.has(r.inv.id)) : sortedRows,
                    });
                    setToolbarMenu(null);
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[12px] text-stone-300 hover:bg-stone-800 hover:text-white transition-colors">
                  <Download size={13} className="text-stone-500" />
                  <div className="flex-1 text-left">
                    Statement of Open Invoices — Excel{selected.size ? ` (${selected.size})` : ""}
                    <div className="text-[10px] text-stone-600">Same statement as a spreadsheet</div>
                  </div>
                </button>
                <button onClick={() => { downloadPdfs(); setToolbarMenu(null); }} disabled={selected.size === 0 || downloadingPdf}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[12px] text-stone-300 hover:bg-stone-800 hover:text-white transition-colors disabled:opacity-40 disabled:hover:bg-transparent">
                  <FileText size={13} className="text-stone-500" />
                  <div className="flex-1 text-left">
                    {downloadingPdf ? "Downloading PDFs…" : `Invoice PDFs (ZIP)${selected.size ? ` (${selected.size})` : ""}`}
                    {selected.size === 0 && <div className="text-[10px] text-stone-600">Select invoices first</div>}
                  </div>
                </button>

                {/* Bulk comments — download the pre-filled template, mark it up, re-import */}
                <div className="my-1 border-t border-stone-800" />
                <button
                  onClick={async () => {
                    setToolbarMenu(null);
                    try { await exportCommentTemplate({ orgName: orgName ?? "Organisation", rows, comments: comments ?? [] }); }
                    catch (e: any) { toast?.(e?.message || "Couldn't build the template", "error"); }
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[12px] text-stone-300 hover:bg-stone-800 hover:text-white transition-colors">
                  <Download size={13} className="text-violet-400" />
                  <div className="flex-1 text-left">
                    Comment template
                    <div className="text-[10px] text-stone-600">Pre-filled with open customers &amp; projects — type comments, then import</div>
                  </div>
                </button>
                <button
                  onClick={() => { setToolbarMenu(null); commentFileRef.current?.click(); }}
                  disabled={importingComments}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[12px] text-stone-300 hover:bg-stone-800 hover:text-white transition-colors disabled:opacity-40">
                  <ArrowDownRight size={13} className="text-violet-400" />
                  <div className="flex-1 text-left">
                    {importingComments ? "Importing comments…" : "Import comments"}
                    <div className="text-[10px] text-stone-600">Upload the filled-in template — logs at customer / project level</div>
                  </div>
                </button>
              </div>
            )}
          </div>
          <input ref={commentFileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleCommentImport(f); }} />

          {/* Notify Owners — the one real action stays visible */}
          {ownerGroups.length > 0 && (
            <button
              onClick={() => { setNotifyInvChecked(new Set(ownerGroups.flatMap(g => g.items.map(r => r.inv.id)))); setNotifyExpanded(new Set()); setNotifyOpen(true); }}
              title="Email each owner their escalated invoices with PDFs attached"
              className="flex items-center gap-1.5 text-xs font-medium text-rose-400 hover:text-white border border-rose-800 bg-rose-500/10 hover:bg-rose-500/20 rounded-md px-2.5 py-1.5 transition-colors">
              <UserCheck size={13} /> Notify Owners ({ownerGroups.length})
            </button>
          )}
        </div>
      </div>

      {/* Click-away for toolbar menus — below the sticky thead (z-20) */}
      {toolbarMenu && <div className="fixed inset-0 z-10" onClick={() => setToolbarMenu(null)} />}

      {/* Receivable Composition — click a segment to filter the board to it */}
      {composition.total > 0 && (
        <div className="border-b border-stone-800 bg-stone-950 px-4 py-2 shrink-0">
          <button onClick={() => setCompositionOpen(v => !v)} className="w-full flex items-center gap-2 mb-1.5">
            <ChevronDown size={11} className={`text-stone-600 transition-transform ${compositionOpen ? "" : "-rotate-90"}`} />
            <span className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold">Composition</span>
            <span className="text-[11px] text-stone-600">click a segment to filter</span>
            <div className="flex-1" />
            <span className="text-[11px] text-stone-400 tabular-nums">{fmt.money(composition.total, compositionCcy)}</span>
          </button>
          {compositionOpen && (
            <>
              <div className="h-2.5 rounded-full overflow-hidden flex mb-1.5">
                {composition.groups.map((g, i) => (
                  <button key={g.key} onClick={() => applyCompositionFilter(g.key)}
                    className={`h-full ${g.bar} hover:opacity-80 transition-opacity`}
                    style={{
                      width: `${Math.max((g.amount / composition.total) * 100, 0.5)}%`,
                      borderLeft: i > 0 ? "2px solid var(--seg-gap)" : undefined,
                    }}
                    title={`${g.label} — ${fmt.money(g.amount, compositionCcy)} (${((g.amount / composition.total) * 100).toFixed(1)}%) · ${g.count} invoice${g.count !== 1 ? "s" : ""}\n${g.description}`}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {composition.groups.map(g => (
                  <button key={g.key} onClick={() => applyCompositionFilter(g.key)} title={g.description}
                    className="flex items-center gap-1.5 text-[11px] text-stone-400 hover:text-white transition-colors">
                    <span className={`w-1.5 h-1.5 rounded-full ${g.dot}`} />
                    {g.label}
                    <span className="font-semibold text-stone-300 tabular-nums">{fmt.money(g.amount, compositionCcy)}</span>
                    <span className="text-stone-600">{((g.amount / composition.total) * 100).toFixed(0)}%</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Saved views + active filter chips */}
      {(savedViews.length > 0 || filterChips.length > 0 || anyFilter) && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-stone-800 bg-stone-950 shrink-0 flex-wrap">
          {savedViews.map(v => (
            <span key={v.name} className="group inline-flex items-center gap-1 text-[11px] font-medium text-stone-300 bg-stone-800 border border-stone-700 rounded-full pl-2.5 pr-1.5 py-1 hover:bg-stone-700 cursor-pointer"
              onClick={() => applyView(v)} title={`Apply view "${v.name}"`}>
              {v.name}
              <button onClick={e => { e.stopPropagation(); deleteView(v.name); }} className="text-stone-600 hover:text-rose-400 opacity-0 group-hover:opacity-100"><X size={11} /></button>
            </span>
          ))}
          {savedViews.length > 0 && filterChips.length > 0 && <span className="w-px h-4 bg-stone-800" />}
          {filterChips.map(c => (
            <span key={c.key} className="inline-flex items-center gap-1 text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-900 rounded-full pl-2.5 pr-1.5 py-1">
              {c.label}
              <button onClick={() => clearChip(c.key)} className="text-emerald-700 hover:text-emerald-300"><X size={11} /></button>
            </span>
          ))}
          {filterChips.length > 0 && (
            <>
              <button onClick={() => setCf({})} className="text-[11px] text-stone-500 hover:text-rose-400 font-medium">Clear all</button>
              <button onClick={saveCurrentView} className="text-[11px] text-stone-500 hover:text-emerald-400 font-medium">Save as view…</button>
            </>
          )}
        </div>
      )}

      {/* Notify Owners modal */}
      {notifyOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => !notifySending && setNotifyOpen(false)}>
          <div className="bg-stone-900 border border-stone-700 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-stone-800">
              <h2 className="text-base font-semibold text-white">Notify escalation owners</h2>
              <p className="text-[12px] text-stone-500 mt-0.5">Each owner gets one email with their action list and the invoice PDFs attached.</p>
            </div>

            <div className="p-5 space-y-3">
              {ownerGroups.map(g => {
                const checkedCount = g.items.filter(r => notifyInvChecked.has(r.inv.id)).length;
                const allChecked = checkedCount === g.items.length;
                const expanded = notifyExpanded.has(g.email);
                const toggleOwner = () => setNotifyInvChecked(p => {
                  const n = new Set(p);
                  g.items.forEach(r => allChecked ? n.delete(r.inv.id) : n.add(r.inv.id));
                  return n;
                });
                return (
                  <div key={g.email} className="bg-stone-800/60 border border-stone-700 rounded-lg overflow-hidden">
                    <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-stone-800 cursor-pointer" onClick={toggleOwner}>
                      <input type="checkbox" checked={allChecked}
                        ref={el => { if (el) el.indeterminate = checkedCount > 0 && !allChecked; }}
                        onChange={toggleOwner} onClick={e => e.stopPropagation()}
                        className="rounded border-stone-500" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-stone-200">{g.name}</div>
                        <div className="text-[11px] text-stone-500 truncate">{g.email}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[13px] font-semibold text-white tabular-nums">
                          {Object.entries(g.total).map(([c, v]) => fmt.money(v, c)).join(" · ")}
                        </div>
                        <div className="text-[11px] text-stone-500">
                          {checkedCount < g.items.length ? `${checkedCount} of ${g.items.length}` : g.items.length} invoice{g.items.length !== 1 ? "s" : ""}
                        </div>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); setNotifyExpanded(p => { const n = new Set(p); n.has(g.email) ? n.delete(g.email) : n.add(g.email); return n; }); }}
                        className="text-stone-500 hover:text-stone-300 p-1 shrink-0">
                        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    </div>
                    {expanded && (
                      <div className="border-t border-stone-700/60 divide-y divide-stone-800">
                        {g.items.map(r => (
                          <label key={r.inv.id} className="flex items-center gap-2.5 pl-9 pr-3 py-1.5 cursor-pointer hover:bg-stone-800/60">
                            <input type="checkbox" checked={notifyInvChecked.has(r.inv.id)}
                              onChange={() => setNotifyInvChecked(p => { const n = new Set(p); n.has(r.inv.id) ? n.delete(r.inv.id) : n.add(r.inv.id); return n; })}
                              className="rounded border-stone-500" />
                            <span className="font-mono text-[11px] text-stone-400">#{r.inv.invoiceNumber}</span>
                            <span className="text-[12px] text-stone-300 flex-1 truncate">{r.custName}{r.projName ? <span className="text-stone-500"> · {r.projName}</span> : null}</span>
                            <span className="text-[12px] font-medium text-stone-200 tabular-nums shrink-0">{fmt.money(r.bal, r.inv.currency)}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Include portal link toggle — same pattern as send-invoices modal */}
              <div className="flex items-center justify-between bg-stone-800/40 border border-stone-700 rounded-lg px-3 py-2.5">
                <div>
                  <div className="text-[13px] font-medium text-stone-200">Include owner portal link</div>
                  <div className="text-[11px] text-stone-500">
                    {notifyPortal ? "Owners can comment on each invoice without logging in — updates land in the chatbox." : "No portal link — owners reply by email only."}
                  </div>
                </div>
                <button role="switch" aria-checked={notifyPortal} onClick={() => setNotifyPortal(v => !v)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${notifyPortal ? "bg-emerald-600" : "bg-stone-600"}`}>
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${notifyPortal ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </div>

              <textarea
                value={notifyMessage}
                onChange={e => setNotifyMessage(e.target.value)}
                placeholder="Optional message to all owners — e.g. 'Month-end close is Friday, please update every line by Thursday.'"
                rows={2}
                className="w-full text-[13px] border border-stone-700 rounded-lg px-3 py-2 bg-stone-800 text-stone-200 placeholder-stone-600 outline-none focus:ring-1 focus:ring-emerald-500 resize-none"
              />
            </div>

            <div className="p-5 border-t border-stone-800 flex items-center justify-end gap-2">
              <button onClick={() => setNotifyOpen(false)} disabled={notifySending}
                className="text-[13px] text-stone-400 hover:text-white px-3 py-2">Cancel</button>
              {(() => {
                const ownerCount = ownerGroups.filter(g => g.items.some(r => notifyInvChecked.has(r.inv.id))).length;
                return (
                  <button onClick={sendOwnerDigests} disabled={notifySending || ownerCount === 0}
                    className="flex items-center gap-1.5 text-[13px] font-semibold bg-rose-600 text-white rounded-lg px-4 py-2 disabled:opacity-40 hover:bg-rose-700 transition-colors">
                    {notifySending
                      ? <><span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Sending…</>
                      : <><Send size={14} /> Send {ownerCount} email{ownerCount !== 1 ? "s" : ""} · {notifyInvChecked.size} invoice{notifyInvChecked.size !== 1 ? "s" : ""}</>}
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Click-away closer for filter popovers. MUST stay BELOW the sticky
          thead (z-20): the popovers render inside the thead's stacking
          context, so any overlay above the thead also covers the popovers
          and swallows every click inside them (checkboxes stop working).
          Trade-off accepted: clicking the header itself doesn't close an
          open popover — the Done button and any body click do. */}
      {filterOpen && <div className="fixed inset-0 z-10" onClick={() => setFilterOpen(null)} />}

      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="text-center text-sm text-stone-400 py-16">No open invoices match the current filters.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-stone-900 z-20">
              <tr className="border-b border-stone-800 text-left">
                <th className="px-3 py-2.5 w-10"><input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-stone-300 cursor-pointer" /></th>
                {([
                  { label: "Invoice",        sort: "invoice",  filter: "invoice",   show: true },
                  { label: "Customer",       sort: "customer", filter: "customer",  show: showCustomer },
                  { label: "Project",        sort: "project",  filter: "project",   show: showProject },
                  { label: "Region",         sort: "region",   filter: "region",    show: showRegion },
                  { label: "Rep",            sort: "rep",      filter: "rep",       show: showRep },
                  { label: "Stage",          sort: "stage",    filter: "stage",     show: true },
                  { label: "Email",          sort: null,       filter: "email",     show: showEmail },
                  { label: "Last Email Ref", sort: "lastSent", filter: "lastSent",  show: true },
                  { label: "Next action",    sort: "action",   filter: "action",    show: true },
                  { label: "Due",            sort: "due",      filter: "bucket",    show: true },
                ] as { label: string; sort: string | null; filter: string; show: boolean }[])
                  .filter(c => c.show)
                  .map(({ label, sort, filter }) => {
                  const active =
                    filter === "stage"    ? !!(cf.stage || cf.owner || cf.escType || cf.escTypeState || cf.commitment) :
                    filter === "lastSent" ? !!(cf.lastSent || cf.lastRef) :
                    filter === "bucket"   ? !!cf.bucket :
                    filter === "email"    ? !!(cf.email || cf.emailText) :
                    !!cf[filter];
                  return (
                    <th key={label} className={`${thCls} relative`}>
                      <span className="inline-flex items-center gap-0.5">
                        {sort ? (
                          <button onClick={() => handleSort(sort)} className="inline-flex items-center gap-1 hover:text-stone-200 transition-colors group">
                            {label}
                            {sortCol === sort
                              ? sortDir === "asc" ? <ChevronUp size={11} className="text-emerald-400" /> : <ChevronDown size={11} className="text-emerald-400" />
                              : <ChevronsUpDown size={11} className="text-stone-700 group-hover:text-stone-500" />}
                          </button>
                        ) : label}
                        <button onClick={() => setFilterOpen(p => p === filter ? null : filter)}
                          className={`p-0.5 rounded hover:bg-stone-800 ${active ? "text-emerald-400" : "text-stone-700 hover:text-stone-400"}`}>
                          <Filter size={11} fill={active ? "currentColor" : "none"} />
                        </button>
                      </span>
                      {filterOpen === filter && (
                        <div className="absolute left-0 top-full mt-1 z-40 w-60 bg-stone-950 border border-stone-700 rounded-xl shadow-2xl p-3 normal-case font-normal tracking-normal text-left space-y-2" onClick={e => e.stopPropagation()}>
                          {/* Text filters */}
                          {["invoice", "customer", "project", "lastRef"].includes(filter) && (
                            <input autoFocus value={cf[filter] ?? ""} onChange={e => setFilter(filter, e.target.value)}
                              placeholder={`Filter ${label.toLowerCase()}…`} className={inputCls}
                              onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") setFilterOpen(null); }} />
                          )}
                          {/* Multi-select: region / rep */}
                          {(filter === "region" || filter === "rep") && (
                            <div className="max-h-52 overflow-y-auto space-y-1">
                              {(filter === "region" ? regionOpts : repOpts).map(o => (
                                <label key={o} className="flex items-center gap-2 text-[12px] text-stone-300 cursor-pointer hover:text-white">
                                  <input type="checkbox" checked={multiVals(filter).has(o)} onChange={() => toggleMulti(filter, o)} className="rounded border-stone-600" />
                                  {o}
                                </label>
                              ))}
                            </div>
                          )}
                          {/* Stage: multi-select + include/exclude + owner */}
                          {filter === "stage" && (
                            <>
                              <div className="flex rounded-lg bg-stone-900 border border-stone-700 p-0.5 text-[11px] font-medium">
                                <button onClick={() => setFilter("stageMode", "")} className={`flex-1 py-1 rounded-md ${cf.stageMode !== "not" ? "bg-stone-700 text-white" : "text-stone-500"}`}>Is</button>
                                <button onClick={() => setFilter("stageMode", "not")} className={`flex-1 py-1 rounded-md ${cf.stageMode === "not" ? "bg-rose-600 text-white" : "text-stone-500"}`}>Is not</button>
                              </div>
                              <div className="max-h-44 overflow-y-auto space-y-1">
                                {stageOpts.map(o => (
                                  <label key={o} className="flex items-center gap-2 text-[12px] text-stone-300 cursor-pointer hover:text-white">
                                    <input type="checkbox" checked={multiVals("stage").has(o)} onChange={() => toggleMulti("stage", o)} className="rounded border-stone-600" />
                                    {o}
                                  </label>
                                ))}
                              </div>
                              {ownerOpts.length > 0 && (
                                <>
                                  <div className="text-[10px] font-semibold text-stone-600 uppercase tracking-wider pt-1 border-t border-stone-800">Escalated to</div>
                                  <div className="max-h-32 overflow-y-auto space-y-1">
                                    {ownerOpts.map(o => (
                                      <label key={o} className="flex items-center gap-2 text-[12px] text-stone-300 cursor-pointer hover:text-white">
                                        <input type="checkbox" checked={multiVals("owner").has(o)} onChange={() => toggleMulti("owner", o)} className="rounded border-stone-600" />
                                        {o}
                                      </label>
                                    ))}
                                  </div>
                                </>
                              )}
                              {escTypeOpts.length > 0 && (
                                <>
                                  <div className="text-[10px] font-semibold text-stone-600 uppercase tracking-wider pt-1 border-t border-stone-800">Escalation type</div>
                                  <div className="max-h-32 overflow-y-auto space-y-1">
                                    {escTypeOpts.map(o => (
                                      <label key={o} title={escalationTypeByLabel(o)?.description} className="flex items-center gap-2 text-[12px] text-stone-300 cursor-pointer hover:text-white">
                                        <input type="checkbox" checked={multiVals("escType").has(o)} onChange={() => toggleMulti("escType", o)} className="rounded border-stone-600" />
                                        {o}
                                      </label>
                                    ))}
                                  </div>
                                </>
                              )}
                              {/* Commitment / dispute — response state now lives on the Stage column */}
                              <div className="text-[10px] font-semibold text-stone-600 uppercase tracking-wider pt-1 border-t border-stone-800">Commitment</div>
                              <div className="space-y-1">
                                {[["", "Any"], ["broken", "Broken commitments"], ["upcoming", "Upcoming commitments"], ["disputed", "Disputed"]].map(([v, l]) => (
                                  <label key={v} className="flex items-center gap-2 text-[12px] text-stone-300 cursor-pointer hover:text-white">
                                    <input type="radio" name="f-commitment" checked={(cf.commitment ?? "") === v} onChange={() => setFilter("commitment", v)} />
                                    {l}
                                  </label>
                                ))}
                              </div>
                            </>
                          )}
                          {filter === "email" && (
                            <div className="space-y-2">
                              <input
                                autoFocus
                                value={cf.emailText ?? ""}
                                onChange={e => setFilter("emailText", e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") setFilterOpen(null); }}
                                placeholder="Filter email…"
                                className={inputCls}
                              />
                              <div className="space-y-1 pt-1 border-t border-stone-800">
                                {[["", "All"], ["has", "Has email"], ["none", "No email"]].map(([v, l]) => (
                                  <label key={v} className="flex items-center gap-2 text-[12px] text-stone-300 cursor-pointer hover:text-white">
                                    <input type="radio" name="f-email" checked={(cf.email ?? "") === v} onChange={() => setFilter("email", v)} />
                                    {l}
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                          {filter === "lastSent" && (
                            <div className="space-y-2">
                              <input
                                autoFocus
                                value={cf.lastRef ?? ""}
                                onChange={e => setFilter("lastRef", e.target.value)}
                                onKeyDown={e => { if (e.key === "Escape") setFilterOpen(null); }}
                                placeholder="Filter by reference…"
                                className={inputCls}
                              />
                              <div className="space-y-1 pt-1 border-t border-stone-800">
                                {[["", "All"], ["sent", "Sent"], ["never", "Never sent"], ["not-today", "Not sent today"], ["cutoff", "Not chased since…"]].map(([v, l]) => (
                                  <label key={v} className="flex items-center gap-2 text-[12px] text-stone-300 cursor-pointer hover:text-white">
                                    <input type="radio" name="f-lastSent" checked={(cf.lastSent ?? "") === v} onChange={() => setFilter("lastSent", v)} />
                                    {l}
                                  </label>
                                ))}
                                {cf.lastSent === "cutoff" && (
                                  <input type="date" value={cf.lastSentBefore ?? ""} max={todayStr()}
                                    onChange={e => setFilter("lastSentBefore", e.target.value)} className={inputCls} />
                                )}
                              </div>
                            </div>
                          )}
                          {filter === "action" && (
                            <div className="space-y-1">
                              {NEXT_ACTION_FILTERS.map(o => (
                                <label key={o.key} className="flex items-center gap-2 text-[12px] text-stone-300 cursor-pointer hover:text-white">
                                  <input type="checkbox" checked={multiVals("action").has(o.key)} onChange={() => toggleMulti("action", o.key)} className="rounded border-stone-600" />
                                  {o.label}
                                </label>
                              ))}
                            </div>
                          )}
                          {filter === "bucket" && (
                            <div className="space-y-1">
                              {BUCKETS.map(b => (
                                <label key={b.key} className="flex items-center gap-2 text-[12px] text-stone-300 cursor-pointer hover:text-white">
                                  <input type="checkbox" checked={multiVals("bucket").has(b.key)} onChange={() => toggleMulti("bucket", b.key)} className="rounded border-stone-600" />
                                  {b.label}
                                </label>
                              ))}
                            </div>
                          )}
                          <div className="flex items-center justify-between pt-1 border-t border-stone-800">
                            <button onClick={() => { clearChip(filter === "bucket" ? "bucket" : filter); if (filter === "stage") { clearChip("owner"); clearChip("escType"); clearChip("escTypeState"); clearChip("commitment"); } if (filter === "lastSent") { clearChip("lastRef"); clearChip("lastSentBefore"); } }}
                              className="text-[11px] text-stone-500 hover:text-rose-400">Clear</button>
                            <button onClick={() => setFilterOpen(null)} className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-300">Done</button>
                          </div>
                        </div>
                      )}
                    </th>
                  );
                })}
                <th className={`${thCls} text-right relative`}>
                  <span className="inline-flex items-center gap-0.5">
                    <button onClick={() => handleSort("outstanding")} className="inline-flex items-center gap-1 hover:text-stone-200 transition-colors group">
                      Outstanding
                      {sortCol === "outstanding"
                        ? sortDir === "asc" ? <ChevronUp size={11} className="text-emerald-400" /> : <ChevronDown size={11} className="text-emerald-400" />
                        : <ChevronsUpDown size={11} className="text-stone-700 group-hover:text-stone-500" />}
                    </button>
                    <button onClick={() => setFilterOpen(p => p === "amount" ? null : "amount")}
                      className={`p-0.5 rounded hover:bg-stone-800 ${(cf.minAmount || cf.maxAmount) ? "text-emerald-400" : "text-stone-700 hover:text-stone-400"}`}>
                      <Filter size={11} fill={(cf.minAmount || cf.maxAmount) ? "currentColor" : "none"} />
                    </button>
                  </span>
                  {filterOpen === "amount" && (
                    <div className="absolute right-0 top-full mt-1 z-40 w-52 bg-stone-950 border border-stone-700 rounded-xl shadow-2xl p-3 normal-case font-normal tracking-normal text-left space-y-2" onClick={e => e.stopPropagation()}>
                      <input type="number" autoFocus value={cf.minAmount ?? ""} onChange={e => setFilter("minAmount", e.target.value)} placeholder="Minimum (≥)" className={`${inputCls} text-right`} />
                      <input type="number" value={cf.maxAmount ?? ""} onChange={e => setFilter("maxAmount", e.target.value)} placeholder="Maximum (≤)" className={`${inputCls} text-right`} />
                      <div className="flex items-center justify-between pt-1 border-t border-stone-800">
                        <button onClick={() => clearChip("amount")} className="text-[11px] text-stone-500 hover:text-rose-400">Clear</button>
                        <button onClick={() => setFilterOpen(null)} className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-300">Done</button>
                      </div>
                    </div>
                  )}
                </th>
                <th className={`${thCls} text-center`}>Activity</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map(item => {
                // Cascading tri-state selection shared by both band levels.
                const bandCheckbox = (ids: string[]) => {
                  const all = ids.every(id => selected.has(id));
                  const some = !all && ids.some(id => selected.has(id));
                  return (
                    <input type="checkbox" checked={all}
                      ref={el => { if (el) el.indeterminate = some; }}
                      onClick={e => e.stopPropagation()}
                      onChange={() => setSelected(prev => {
                        const n = new Set(prev);
                        ids.forEach(id => all ? n.delete(id) : n.add(id));
                        return n;
                      })}
                      className="rounded border-stone-300 cursor-pointer" />
                  );
                };
                const selCount = (ids: string[]) => ids.filter(id => selected.has(id)).length;

                if (item.type === "band") {
                  const custContactKey = `cust-${item.custId}`;
                  const custContactCount = (allContacts ?? []).filter((c: any) => c.customerId === item.custId).length;
                  const bandKey = `cust-${item.custId}`;
                  return (
                    <tr key={`band-${item.custId}`}
                      className="bg-stone-800 border-t-2 border-t-stone-700 border-b border-b-stone-700 select-none cursor-pointer hover:bg-stone-750"
                      onClick={() => setCollapsedCust(p => { const n = new Set(p); n.has(item.custId) ? n.delete(item.custId) : n.add(item.custId); return n; })}>
                      {/* Checkbox */}
                      <td className="px-2 py-2.5 border-l-[3px] border-l-emerald-500" onClick={e => e.stopPropagation()}>{bandCheckbox(item.ids)}</td>
                      {/* Identity — Invoice column */}
                      <td className="px-2 py-2.5 font-semibold text-white text-[13px] relative">
                        <span className="inline-block w-4 text-stone-400">{item.collapsed ? "▸" : "▾"}</span>
                        {item.custName}
                        {isGroup && item.orgId && orgNames[item.orgId] && (
                          <span className="ml-2 align-middle text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/12 text-emerald-300 border border-emerald-800/50" title="Branch this customer belongs to">
                            {orgNames[item.orgId]}
                          </span>
                        )}
                        <span className="text-[11px] text-stone-400 font-normal ml-2">{item.count} invoice{item.count !== 1 ? "s" : ""}</span>
                        <button
                          onClick={e => { e.stopPropagation(); setContactsOpenId(contactsOpenId === custContactKey ? null : custContactKey); }}
                          title="View contacts for this customer"
                          className="relative inline-flex items-center justify-center ml-1.5 p-0.5 rounded hover:bg-stone-700 text-stone-600 hover:text-blue-400 transition-colors align-middle">
                          <Phone size={12} />
                          {custContactCount > 0 && (
                            <span className="absolute -top-1 -right-1 text-white text-[9px] rounded-full w-3.5 h-3.5 flex items-center justify-center font-semibold bg-stone-600">
                              {custContactCount > 9 ? "9+" : custContactCount}
                            </span>
                          )}
                        </button>
                        {selCount(item.ids) > 0 && selCount(item.ids) < item.ids.length && (
                          <span className="text-[10px] text-emerald-400 font-medium ml-2">{selCount(item.ids)} selected</span>
                        )}
                        {(() => {
                          const notes = customerNotesById[item.custId] ?? [];
                          const note = (notes as any[]).find((n: any) => n.channel === "Chase") ?? notes[0];
                          return note ? (
                            <span className="text-[11px] text-stone-500 italic ml-2 max-w-[280px] truncate inline-block align-middle" title={note.body}>
                              {note.channel === "Chase" ? `[${note.subject}] ` : ""}{note.body}
                            </span>
                          ) : null;
                        })()}
                        {contactsOpenId === custContactKey && (
                          <div className="absolute left-0 top-10 z-40 w-80 bg-stone-950 rounded-xl shadow-2xl ring-1 ring-stone-700 text-left font-normal" style={{maxHeight:"480px"}} onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-800">
                              <div className="flex items-center gap-2">
                                <Phone size={13} className="text-stone-400" />
                                <span className="text-[12px] font-semibold text-stone-200">Contacts · {item.custName}</span>
                              </div>
                              <button onClick={() => setContactsOpenId(null)} className="text-stone-500 hover:text-stone-200"><X size={14} /></button>
                            </div>
                            <div className="overflow-auto p-3" style={{maxHeight:"420px"}}>
                              <ContactsPanel customerId={item.custId} />
                            </div>
                          </div>
                        )}
                      </td>
                      {showRegion && <td className="px-2 py-2.5" />}
                      {showRep    && <td className="px-2 py-2.5" />}
                      {/* Stage — batch-change dropdown */}
                      <td className="px-2 py-2.5" onClick={e => e.stopPropagation()}>
                        {item.dominantStage && (
                          <span className={`relative inline-flex items-center gap-0.5 text-[11px] font-medium rounded-full px-1.5 py-0.5 border transition-colors cursor-pointer ${stageColor(item.dominantStage)}`}
                            title="Change stage for all invoices in this account">
                            {item.dominantStage}
                            <ChevronDown size={9} className="opacity-60 shrink-0" />
                            <select disabled={bandStageBusy} value="" onChange={e => { if (e.target.value) changeBandStage(bandKey, item.ids, e.target.value); }}
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer text-[11px]">
                              <option value="" disabled>Change all to…</option>
                              {stageLabels.filter(s => s !== "Escalated" && s !== "Committed" && s !== "Disputed").map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </span>
                        )}
                      </td>
                      {showEmail && <td className="px-2 py-2.5" />}
                      {/* Last Email Ref → last contact */}
                      <td className="px-2 py-2.5 whitespace-nowrap">
                        {item.lastChaseInfo !== null ? (
                          <span className={`inline-flex items-center gap-1 text-[11px] ${item.lastChaseInfo.days > 60 ? "text-rose-400" : item.lastChaseInfo.days > 30 ? "text-amber-400" : "text-stone-500"}`}
                            title={`Last contact ${item.lastChaseInfo.days}d ago via ${item.lastChaseInfo.activityType}`}>
                            {activityIcon(item.lastChaseInfo.activityType)}
                            <span>{item.lastChaseInfo.days === 0 ? "today" : `${item.lastChaseInfo.days}d`}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] text-rose-400/70" title="No contact logged">
                            <AlertTriangle size={9} />
                            <span>no contact</span>
                          </span>
                        )}
                      </td>
                      {/* Next action → NBA */}
                      <td className="px-2 py-2.5 whitespace-nowrap">
                        {item.bandNBA && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-sky-300 bg-sky-500/10 border border-sky-800/60 rounded-full px-2 py-0.5 font-medium" title={item.bandNBA.detail ?? item.bandNBA.label}>
                            <Zap size={9} className="shrink-0" />
                            {item.bandNBA.label}
                          </span>
                        )}
                      </td>
                      {/* Due → oldest overdue */}
                      <td className="px-2 py-2.5 whitespace-nowrap">
                        {item.maxDays > 0 && (
                          <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${item.maxDays > 90 ? "text-rose-300 bg-rose-500/15 border border-rose-900" : item.maxDays > 60 ? "text-amber-300 bg-amber-500/15 border border-amber-900" : "text-stone-300 bg-stone-500/15 border border-stone-700"}`}>
                            +{item.maxDays}d
                          </span>
                        )}
                      </td>
                      {/* Outstanding */}
                      <td className="px-2 py-2 text-right font-bold text-white tabular-nums whitespace-nowrap">
                        {Object.entries(item.total).sort((a, b) => b[1] - a[1]).map(([c, v]) => fmt.money(v, c)).join(" · ")}
                      </td>
                      {/* Activity — comment hub */}
                      <td className="px-3 py-2 text-center relative" onClick={e => e.stopPropagation()}>
                        {renderCommentHub({ kind: "cust", customerId: item.custId, projectId: null, notes: customerNotesById[item.custId] ?? [], title: item.custName, scopeCount: item.count, compact: true, popoverAlign: "right" })}
                      </td>
                    </tr>
                  );
                }

                if (item.type === "projBand") {
                  const pid = item.projectId;
                  const projContactKey = pid ? `proj-${pid}` : null;
                  const projContactCount = pid
                    ? (allContacts ?? []).filter((c: any) => c.projectId === pid).length
                    : 0;
                  const projBandKey = `proj-${item.key}`;
                  return (
                    <tr key={`proj-${item.key}`}
                      className="bg-stone-900 border-b border-stone-800 select-none cursor-pointer hover:bg-stone-800/60"
                      onClick={() => setExpandedProj(p => { const n = new Set(p); n.has(item.key) ? n.delete(item.key) : n.add(item.key); return n; })}>
                      {/* Checkbox */}
                      <td className="px-2 py-2 pl-6 border-l-[3px] border-l-stone-500" onClick={e => e.stopPropagation()}>{bandCheckbox(item.ids)}</td>
                      {/* Identity — Invoice column */}
                      <td className="px-2 py-2 pl-6 text-[12px] font-medium text-stone-300 relative">
                        <span className="inline-block w-4 text-stone-600">{item.collapsed ? "▸" : "▾"}</span>
                        {item.projName}
                        <span className="text-[10px] text-stone-600 ml-2">{item.count} inv</span>
                        {projContactKey && (
                          <button
                            onClick={e => { e.stopPropagation(); setContactsOpenId(contactsOpenId === projContactKey ? null : projContactKey); }}
                            title="View contacts for this project"
                            className="relative inline-flex items-center justify-center ml-1.5 p-0.5 rounded hover:bg-stone-800 text-stone-700 hover:text-blue-400 transition-colors align-middle">
                            <Phone size={11} />
                            {projContactCount > 0 && (
                              <span className="absolute -top-1 -right-1 text-white text-[9px] rounded-full w-3.5 h-3.5 flex items-center justify-center font-semibold bg-stone-700">
                                {projContactCount > 9 ? "9+" : projContactCount}
                              </span>
                            )}
                          </button>
                        )}
                        {selCount(item.ids) > 0 && selCount(item.ids) < item.ids.length && (
                          <span className="text-[10px] text-emerald-500 font-medium ml-2">{selCount(item.ids)} selected</span>
                        )}
                        {(() => {
                          if (!pid) return null;
                          const notes = projectNotesById[pid] ?? [];
                          const note = (notes as any[]).find((n: any) => n.channel === "Chase") ?? notes[0];
                          return note ? (
                            <span className="text-[11px] text-stone-500 italic ml-2 max-w-[280px] truncate inline-block align-middle" title={note.body}>
                              {note.channel === "Chase" ? `[${note.subject}] ` : ""}{note.body}
                            </span>
                          ) : null;
                        })()}
                        {projContactKey && contactsOpenId === projContactKey && (
                          <div className="absolute left-0 top-9 z-40 w-80 bg-stone-950 rounded-xl shadow-2xl ring-1 ring-stone-700 text-left font-normal" style={{maxHeight:"480px"}} onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-800">
                              <div className="flex items-center gap-2">
                                <Phone size={13} className="text-stone-400" />
                                <span className="text-[12px] font-semibold text-stone-200">Contacts · {item.projName}</span>
                              </div>
                              <button onClick={() => setContactsOpenId(null)} className="text-stone-500 hover:text-stone-200"><X size={14} /></button>
                            </div>
                            <div className="overflow-auto p-3" style={{maxHeight:"420px"}}>
                              <ContactsPanel customerId={item.custId} projectId={pid} />
                            </div>
                          </div>
                        )}
                      </td>
                      {showRegion && <td className="px-2 py-2" />}
                      {showRep    && <td className="px-2 py-2" />}
                      {/* Stage — batch-change dropdown */}
                      <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
                        {item.dominantStage && (
                          <span className={`relative inline-flex items-center gap-0.5 text-[10px] font-medium rounded-full px-1.5 py-0.5 border cursor-pointer ${stageColor(item.dominantStage)}`}
                            title="Change stage for all invoices in this project">
                            {item.dominantStage}
                            <ChevronDown size={8} className="opacity-60 shrink-0" />
                            <select disabled={bandStageBusy} value="" onChange={e => { if (e.target.value) changeBandStage(projBandKey, item.ids, e.target.value); }}
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer text-[10px]">
                              <option value="" disabled>Change all to…</option>
                              {stageLabels.filter(s => s !== "Escalated" && s !== "Committed" && s !== "Disputed").map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </span>
                        )}
                      </td>
                      {showEmail && <td className="px-2 py-2" />}
                      {/* Last Email Ref → last contact */}
                      <td className="px-2 py-2 whitespace-nowrap">
                        {item.lastChaseInfo !== null ? (
                          <span className={`inline-flex items-center gap-1 text-[11px] ${item.lastChaseInfo.days > 60 ? "text-rose-400" : item.lastChaseInfo.days > 30 ? "text-amber-400" : "text-stone-500"}`}
                            title={`Last contact ${item.lastChaseInfo.days}d ago via ${item.lastChaseInfo.activityType}`}>
                            {activityIcon(item.lastChaseInfo.activityType)}
                            <span>{item.lastChaseInfo.days === 0 ? "today" : `${item.lastChaseInfo.days}d`}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] text-rose-400/60" title="No contact logged">
                            <AlertTriangle size={8} />
                            <span>no contact</span>
                          </span>
                        )}
                      </td>
                      {/* Next action → NBA */}
                      <td className="px-2 py-2 whitespace-nowrap">
                        {item.bandNBA && (
                          <span className="inline-flex items-center gap-1 text-[9px] text-sky-300 bg-sky-500/10 border border-sky-800/60 rounded-full px-1.5 py-0.5 font-medium" title={item.bandNBA.detail ?? item.bandNBA.label}>
                            <Zap size={8} className="shrink-0" />
                            {item.bandNBA.label}
                          </span>
                        )}
                      </td>
                      {/* Due → oldest overdue in this project */}
                      <td className="px-2 py-2 whitespace-nowrap">
                        {item.maxDays > 0 && (
                          <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${item.maxDays > 90 ? "text-rose-300 bg-rose-500/15 border border-rose-900" : item.maxDays > 60 ? "text-amber-300 bg-amber-500/15 border border-amber-900" : "text-stone-300 bg-stone-500/15 border border-stone-700"}`}>
                            +{item.maxDays}d
                          </span>
                        )}
                      </td>
                      {/* Outstanding */}
                      <td className="px-2 py-1.5 text-right text-[12px] font-semibold text-stone-300 tabular-nums whitespace-nowrap">
                        {Object.entries(item.total).sort((a, b) => b[1] - a[1]).map(([c, v]) => fmt.money(v, c)).join(" · ")}
                      </td>
                      {/* Activity — comment hub */}
                      <td className="px-3 py-1.5 text-center relative" onClick={e => e.stopPropagation()}>
                        {pid && renderCommentHub({ kind: "proj", customerId: item.custId, projectId: pid, notes: projectNotesById[pid] ?? [], title: item.projName, scopeCount: item.count, compact: true, popoverAlign: "right" })}
                      </td>
                    </tr>
                  );
                }

                const { inv, custId, custName, projName, regionName, repName, stageLabel, bal, days, email, lastSent, lastRef } = item.r;
                const isSel = selected.has(inv.id);
                return (
                  <tr key={inv.id} className={`border-b border-stone-800 transition-colors ${isSel ? "bg-emerald-500/10 hover:bg-emerald-500/15" : "hover:bg-stone-800/50"}`}>
                    <td className="px-2 py-2.5 pl-4"><input type="checkbox" checked={isSel} onChange={() => toggleOne(inv.id)} className="rounded border-stone-300 cursor-pointer" /></td>
                    <td className="px-2 py-2.5"><Link href={`/invoices/${inv.id}`} className="font-mono text-[12px] text-stone-400 hover:text-white hover:underline">#{inv.invoiceNumber}</Link></td>
                    {showCustomer && <td className="px-2 py-2.5 text-stone-200 text-[13px] max-w-[160px] truncate" title={custName}>{custName}</td>}
                    {showProject  && <td className="px-2 py-2.5 text-stone-500 text-[12px] max-w-[140px] truncate" title={projName ?? ""}>{projName ?? "—"}</td>}
                    {showRegion && <td className="px-2 py-2.5 text-stone-500 text-[12px]">{regionName ?? "—"}</td>}
                    {showRep    && <td className="px-2 py-2.5 text-stone-500 text-[12px]">{repName ?? "—"}</td>}

                    {/* Stage dropdown */}
                    <td className="px-2 py-2">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {(() => {
                            // Effective (optimistic) response values so the pill updates instantly.
                            const o = opt[inv.id] || {};
                            const effDispute = o.hasOpenDispute ?? inv.hasOpenDispute;
                            const effPromise = "promiseDate" in o ? o.promiseDate : inv.promiseDate;
                            const effReason  = o.disputeReason ?? inv.disputeReason;
                            const todayS = todayStr();
                            // Broken = a promise whose date has passed, not superseded by a dispute.
                            const broken = !!effPromise && effPromise < todayS && !effDispute;

                            const picking =
                              pendingEscalation?.invoiceId === inv.id ||
                              pendingCommit?.invoiceId === inv.id ||
                              pendingDispute?.invoiceId === inv.id;
                            const displayStage =
                              pendingEscalation?.invoiceId === inv.id ? "Escalated" :
                              pendingCommit?.invoiceId    === inv.id ? "Committed" :
                              pendingDispute?.invoiceId   === inv.id ? "Disputed" : stageLabel;

                            // Every stage change routes through here. Committed/Disputed/Escalated
                            // open their inline picker (they need metadata); any other stage clears
                            // an active promise/dispute first so the board and the dashboard never
                            // disagree about what state the invoice is in.
                            const changeStage = async (newStage: string) => {
                              if (newStage === "Escalated") { openEscalationPicker(inv.id, stageLabel, inv.escalatedToUserId ?? undefined, inv.escalationType ?? undefined, inv.escalationNote ?? undefined); return; }
                              if (newStage === "Committed")  { openCommitPicker(inv.id, stageLabel, effPromise); return; }
                              if (newStage === "Disputed")   { openDisputePicker(inv.id, stageLabel, effReason); return; }
                              if (effDispute || effPromise)  await postResponse(inv.id, { type: "clear" });
                              const patch: any = { collectionStage: newStage };
                              if (stageLabel === "Escalated") { patch.escalatedToUserId = null; patch.escalatedToName = null; patch.escalatedToEmail = null; patch.escalationType = null; patch.escalationNote = null; }
                              await save(inv.id, patch);
                            };

                            const plainCls = `text-[11px] font-medium rounded-full px-1.5 py-0.5 border cursor-pointer focus:ring-2 focus:ring-stone-300 ${stageColor(displayStage)}`;
                            const stageSelect = (extraCls: string) => (
                              <select value={displayStage} disabled={busyId === inv.id}
                                onChange={e => changeStage(e.target.value)} className={extraCls}>
                                {!stageLabels.includes(stageLabel) && <option value={stageLabel}>{stageLabel}</option>}
                                {stageLabels.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            );

                            // While a picker is open, show the plain dropdown (value = pending choice).
                            if (picking) return stageSelect(plainCls);

                            // Dynamic pill = visible label + invisible overlay <select> (click → dropdown).
                            const pill = (cls: string, title: string, content: any) => (
                              <div className={`relative inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-1.5 py-0.5 transition-colors ${cls}`} title={title}>
                                {content}
                                <ChevronDown size={10} className="opacity-60" />
                                {stageSelect("absolute inset-0 w-full h-full opacity-0 cursor-pointer")}
                              </div>
                            );

                            // Priority: Escalated → Disputed → Broken commitment → Committed → plain.
                            if (stageLabel === "Escalated" && inv.escalatedToName) {
                              return pill(
                                "bg-rose-900/30 text-rose-300 border border-rose-800 hover:bg-rose-900/50",
                                [ `Escalated → ${inv.escalatedToName}${inv.escalatedToEmail ? ` · ${inv.escalatedToEmail}` : ""}`,
                                  inv.escalationType ? `${inv.escalationType} — ${escalationTypeByLabel(inv.escalationType)?.description ?? ""}` : null,
                                  inv.escalationNote ? `Note: ${inv.escalationNote}` : null,
                                  "Click to change stage or reassign" ].filter(Boolean).join("\n"),
                                <>→ {inv.escalatedToName}{inv.escalationType && <span className="text-rose-400/70">· {inv.escalationType}</span>}</>
                              );
                            }
                            if (effDispute) {
                              return pill(
                                "bg-rose-500/15 text-rose-400 border border-rose-800/60 hover:bg-rose-500/25",
                                `Disputed${effReason ? " — " + effReason : ""}\nClick to change stage or resolve`,
                                <><AlertOctagon size={10} /> Disputed{effReason && <span className="text-rose-300/70 max-w-[110px] truncate">· {effReason}</span>}</>
                              );
                            }
                            if (broken) {
                              return pill(
                                "bg-rose-600/25 text-rose-200 border border-rose-700 hover:bg-rose-600/35",
                                `Broken commitment — was promised ${effPromise}\nClick to re-negotiate a date or change stage`,
                                <><AlertTriangle size={10} /> Broken commitment <span className="text-rose-300/70">· was {fmt.shortDate(effPromise!)}</span></>
                              );
                            }
                            if (effPromise) {
                              return pill(
                                "bg-blue-500/15 text-blue-400 border border-blue-800/50 hover:bg-blue-500/25",
                                `Committed to pay ${effPromise}\nClick to change stage`,
                                <><CalendarClock size={10} /> Committed <span className="text-blue-300/70">· {fmt.shortDate(effPromise)}</span></>
                              );
                            }
                            return stageSelect(plainCls);
                          })()}
                        </div>
                        {pendingEscalation?.invoiceId === inv.id && (
                          <div className="flex flex-col gap-1.5 bg-stone-800 border border-stone-700 rounded-lg px-2 py-2 min-w-[260px]">
                            <select
                              value={selectedTarget}
                              onChange={e => setSelectedTarget(e.target.value)}
                              className="text-[11px] w-full border border-stone-700 rounded px-1.5 py-1 bg-stone-900 text-stone-300 outline-none focus:ring-1 focus:ring-emerald-500"
                            >
                              <option value="">Assign to…</option>
                              {escalateTargets.map(t => (
                                <option key={t.id} value={t.id}>{t.name} ({t.email})</option>
                              ))}
                            </select>
                            <select
                              value={selectedEscType}
                              onChange={e => setSelectedEscType(e.target.value)}
                              title={escalationTypeByLabel(selectedEscType)?.description}
                              className="text-[11px] w-full border border-stone-700 rounded px-1.5 py-1 bg-stone-900 text-stone-300 outline-none focus:ring-1 focus:ring-emerald-500"
                            >
                              <option value="">Escalation type…</option>
                              {ESCALATION_TYPES.map(t => (
                                <option key={t.key} value={t.label} title={t.description}>{t.label}</option>
                              ))}
                            </select>
                            {selectedEscType && (
                              <p className="text-[10px] text-stone-500 leading-snug px-0.5">
                                {escalationTypeByLabel(selectedEscType)?.description}
                              </p>
                            )}
                            <input
                              value={escNoteVal}
                              onChange={e => setEscNoteVal(e.target.value)}
                              placeholder="Note for the assignee (optional)…"
                              maxLength={2000}
                              className="text-[11px] w-full border border-stone-700 rounded px-1.5 py-1 bg-stone-900 text-stone-300 outline-none focus:ring-1 focus:ring-emerald-500 placeholder:text-stone-600"
                            />
                            <div className="flex items-center gap-1.5 justify-end">
                              <button
                                onClick={() => { setPendingEscalation(null); setSelectedTarget(""); setSelectedEscType(""); setEscNoteVal(""); }}
                                className="text-[11px] text-stone-500 hover:text-stone-300 px-1"
                              >
                                Cancel
                              </button>
                              <button
                                disabled={!selectedTarget || !selectedEscType || busyId === inv.id}
                                title={!selectedTarget ? "Pick a person first" : !selectedEscType ? "Pick an escalation type first" : undefined}
                                onClick={async () => {
                                  const target = escalateTargets.find(t => t.id === selectedTarget);
                                  if (!target) return;
                                  await save(inv.id, {
                                    collectionStage:    "Escalated",
                                    escalatedToUserId:  target.id,
                                    escalatedToName:    target.name,
                                    escalatedToEmail:   target.email,
                                    escalationType:     selectedEscType,
                                    escalationNote:     escNoteVal.trim() || null,
                                  });
                                  setPendingEscalation(null);
                                  setSelectedTarget("");
                                  setSelectedEscType("");
                                  setEscNoteVal("");
                                }}
                                className="text-[11px] font-semibold bg-emerald-600 text-white rounded px-2 py-1 disabled:opacity-40 hover:bg-emerald-700"
                              >
                                Confirm
                              </button>
                            </div>
                          </div>
                        )}
                        {pendingCommit?.invoiceId === inv.id && (
                          <div className="flex items-center gap-1.5 bg-stone-800 border border-stone-700 rounded-lg px-2 py-1.5">
                            <input
                              type="date"
                              autoFocus
                              value={commitDateVal}
                              onChange={e => setCommitDateVal(e.target.value)}
                              className="text-[11px] flex-1 min-w-0 border border-stone-700 rounded px-1.5 py-1 bg-stone-900 text-stone-300 outline-none focus:ring-1 focus:ring-emerald-500"
                            />
                            <button
                              disabled={!commitDateVal || busyId === inv.id}
                              title={!commitDateVal ? "Pick the promised date first" : undefined}
                              onClick={async () => {
                                // Route through the response endpoint so the promise event
                                // is recorded and recompute drives the stage to Committed.
                                await postResponse(inv.id, { type: "promise", promiseDate: commitDateVal });
                                setPendingCommit(null);
                                setCommitDateVal("");
                              }}
                              className="shrink-0 text-[11px] font-semibold bg-emerald-600 text-white rounded px-2 py-1 disabled:opacity-40 hover:bg-emerald-700"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => { setPendingCommit(null); setCommitDateVal(""); }}
                              className="shrink-0 text-[11px] text-stone-500 hover:text-stone-300 px-1"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                        {pendingDispute?.invoiceId === inv.id && (
                          <div className="flex flex-col gap-1.5 bg-stone-800 border border-stone-700 rounded-lg px-2 py-2 min-w-[240px]">
                            <select
                              value={disputeCat}
                              onChange={e => setDisputeCat(e.target.value)}
                              className="text-[11px] w-full border border-stone-700 rounded px-1.5 py-1 bg-stone-900 text-stone-300 outline-none focus:ring-1 focus:ring-rose-500"
                            >
                              {DISPUTE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <input
                              value={disputeReasonVal}
                              onChange={e => setDisputeReasonVal(e.target.value)}
                              placeholder="Reason / detail (optional)…"
                              maxLength={500}
                              className="text-[11px] w-full border border-stone-700 rounded px-1.5 py-1 bg-stone-900 text-stone-300 outline-none focus:ring-1 focus:ring-rose-500 placeholder:text-stone-600"
                            />
                            <div className="flex items-center gap-1.5 justify-end">
                              <button
                                onClick={() => { setPendingDispute(null); setDisputeReasonVal(""); }}
                                className="text-[11px] text-stone-500 hover:text-stone-300 px-1"
                              >
                                Cancel
                              </button>
                              <button
                                disabled={busyId === inv.id}
                                onClick={async () => {
                                  await postResponse(inv.id, { type: "dispute", category: disputeCat, reason: disputeReasonVal.trim() || disputeCat });
                                  setPendingDispute(null);
                                  setDisputeReasonVal("");
                                }}
                                className="text-[11px] font-semibold bg-rose-600 text-white rounded px-2 py-1 disabled:opacity-40 hover:bg-rose-700"
                              >
                                Mark disputed
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Email (editable inline) */}
                    {showEmail && <td className="px-2 py-2 max-w-[180px]">
                      {emailEdit === inv.id ? (
                        <input
                          autoFocus value={emailVal} onChange={e => setEmailVal(e.target.value)}
                          onBlur={() => { if (emailVal !== (email ?? "")) save(inv.id, { billingEmail: emailVal }); setEmailEdit(null); }}
                          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEmailEdit(null); }}
                          className="w-full text-[12px] border border-stone-700 rounded px-1.5 py-1 bg-stone-800 text-stone-300"
                        />
                      ) : (
                        <button onClick={() => { setEmailEdit(inv.id); setEmailVal(email ?? ""); }}
                          className="group inline-flex items-center gap-1 text-left max-w-full">
                          <span className={`text-[12px] truncate ${email ? "text-stone-300" : "text-stone-600 italic"}`}>{email || "no email"}</span>
                          <Pencil size={11} className="text-stone-300 opacity-0 group-hover:opacity-100 shrink-0" />
                        </button>
                      )}
                    </td>}

                    <td className="px-2 py-2 whitespace-nowrap text-[12px]">
                      {lastRef
                        ? <span className="font-mono text-stone-300">{lastRef}</span>
                        : <span className="text-stone-600">—</span>}
                      {lastSent ? (() => {
                        const n = daysAgo(lastSent);
                        return <span className={`ml-1.5 font-medium ${agoCls(n)}`} title={fmtSent(lastSent) ?? undefined}>· {n === 0 ? "today" : `${n}d`}</span>;
                      })() : (!lastRef && <span className="text-stone-600"> never</span>)}
                    </td>
                    {/* Next action — the forward-looking queue date, editable inline */}
                    {/* Next best action — computed, one-click, filterable by type */}
                    <td className="px-2 py-2 whitespace-nowrap text-[12px]">
                      {(() => {
                        const na = nextActionByInv[inv.id];
                        if (!na) return <span className="text-stone-600">—</span>;
                        const tone: Record<string, string> = {
                          reply:     "bg-emerald-500/15 text-emerald-300 border-emerald-800/60",
                          email:     "bg-blue-500/15 text-blue-300 border-blue-800/60",
                          call:      "bg-orange-500/15 text-orange-300 border-orange-800/60",
                          escalate:  "bg-rose-500/15 text-rose-300 border-rose-800/60",
                          add_email: "bg-amber-500/15 text-amber-300 border-amber-800/60",
                          resolve:   "bg-rose-500/10 text-rose-300 border-rose-900/60",
                          await:     "text-stone-400 border-stone-700",
                          none:      "text-stone-600 border-transparent",
                        };
                        const Icon =
                          na.type === "reply" ? CornerUpLeft :
                          na.type === "call" ? Phone :
                          na.type === "escalate" ? UserCheck :
                          na.type === "resolve" ? AlertOctagon :
                          na.type === "await" ? Clock :
                          (na.type === "email" || na.type === "add_email") ? Mail : null;
                        const body = <>{Icon && <Icon size={11} />}<span>{na.label}</span>{na.detail && <span className="opacity-60">· {na.detail}</span>}</>;
                        if (!na.act) return <span className={`inline-flex items-center gap-1 text-[11px] ${na.type === "none" ? "text-stone-600" : "text-stone-400"}`}>{body}</span>;
                        const onClick = () => {
                          if (na.act === "send") { setPreQuickSendSelection(selected); setSelected(new Set([inv.id])); setShowSend(true); }
                          else if (na.act === "email") { setEmailEdit(inv.id); setEmailVal(email ?? ""); }
                          else if (na.act === "reply") { setNotesOpenId(inv.id); markNotesSeen(inv.id); }
                          else if (na.act === "escalate") { openEscalationPicker(inv.id, stageLabel, inv.escalatedToUserId ?? undefined, inv.escalationType ?? undefined, inv.escalationNote ?? undefined); }
                          else if (na.act === "log") { setNotesOpenId(inv.id); }
                        };
                        return (
                          <button onClick={onClick}
                            title="Click to act on this"
                            className={`inline-flex items-center gap-1 text-[11px] font-medium rounded-full border px-2 py-1 hover:opacity-80 transition-opacity ${tone[na.type]}`}>
                            {body}
                          </button>
                        );
                      })()}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-stone-400 text-[12px]">{inv.dueDate}{days > 0 && <span className="ml-1 text-rose-400 font-medium">+{days}d</span>}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      <span className="font-semibold text-white">{fmt.money(bal, inv.currency)}</span>
                      {(() => {
                        const total = Number(inv.total || 0);
                        if (total <= 0 || bal <= 0) return null;
                        const pct = Math.round((bal / total) * 100);
                        if (pct >= 100) return null;
                        const cls = pct >= 75 ? "text-rose-400" : pct >= 40 ? "text-amber-400" : "text-emerald-400";
                        return <span className={`ml-1.5 text-[10px] font-medium ${cls}`}>{pct}%</span>;
                      })()}
                    </td>

                    {/* Actions: quick send + contacts + notes */}
                    <td className="px-3 py-2 text-center relative whitespace-nowrap">
                      <button
                        onClick={() => { setPreQuickSendSelection(selected); setSelected(new Set([inv.id])); setShowSend(true); }}
                        disabled={!email}
                        title={email ? "Send reminder for this invoice" : "No email on file"}
                        className="inline-flex items-center justify-center p-1 rounded hover:bg-stone-800 text-stone-500 hover:text-emerald-400 disabled:opacity-30 disabled:hover:text-stone-500 mr-0.5">
                        <Send size={14} />
                      </button>
                      <button onClick={() => { const opening = notesOpenId !== inv.id; setNotesOpenId(opening ? inv.id : null); setNoteText(""); if (opening) { markNotesSeen(inv.id); } }}
                        className="relative inline-flex items-center justify-center p-1 rounded hover:bg-stone-800 text-stone-500 hover:text-stone-200" title="Activity">
                        <MessageSquare size={15} />
                        {feedForInv(inv).length > 0 && (
                          <span className={`absolute -top-1 -right-1 text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-semibold ${hasUnreadReply(inv.id) ? "bg-rose-500 animate-pulse" : "bg-blue-600"}`}>{feedForInv(inv).length}</span>
                        )}
                      </button>
                      {notesOpenId === inv.id && (
                        <div className="absolute right-2 top-9 z-30 w-96 bg-stone-950 rounded-xl shadow-2xl ring-1 ring-stone-700 text-left flex flex-col" style={{maxHeight:"520px"}} onClick={e => e.stopPropagation()}>
                          {/* Header */}
                          <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-800 flex-shrink-0">
                            <div className="flex items-center gap-2">
                              <MessageSquare size={13} className="text-stone-400" />
                              <span className="text-[12px] font-semibold text-stone-200">Activity · #{inv.invoiceNumber}</span>
                              {feedForInv(inv).length > 0 && (
                                <span className="text-[10px] text-stone-500">{feedForInv(inv).length} event{feedForInv(inv).length !== 1 ? "s" : ""}</span>
                              )}
                            </div>
                            <button onClick={() => setNotesOpenId(null)} className="text-stone-500 hover:text-stone-200"><X size={14} /></button>
                          </div>

                          {/* Feed */}
                          <div className="flex-1 overflow-auto p-3 space-y-2 min-h-0">
                            {feedForInv(inv).length === 0 ? (
                              <div className="text-[12px] text-stone-600 text-center py-6">No activity yet</div>
                            ) : [...feedForInv(inv)].sort((a: any, b: any) => new Date(a.sentAt ?? a.createdAt).getTime() - new Date(b.sentAt ?? b.createdAt).getTime()).map((n: any) => {
                              const ts = new Date(n.sentAt ?? n.createdAt);
                              const dateStr = ts.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
                              const timeStr = ts.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

                              // Per-channel config
                              type ChanCfg = { icon: React.ReactNode; border: string; label: string; labelCls: string; bg: string };
                              const cfg: ChanCfg = (() => {
                                // Project-level comments (logged once at the project, mirrored into
                                // every invoice's feed) get a distinct sky look so they read as
                                // shared account context, not an invoice-specific note.
                                if (n.matchedBy === "ProjectNote")
                                  return { icon: <MessageSquare size={11} />, border: "border-l-2 border-sky-500", label: `${n.sender || "Staff"} · project comment`, labelCls: "text-sky-400", bg: "bg-sky-950/20" };
                                switch (n.channel) {
                                  case "Portal":   return { icon: <Globe size={11} />,         border: "border-l-2 border-emerald-500", label: n.matchedBy === "OwnerPortal" ? `${n.sender || "Owner"} · via owner portal` : "Customer · via portal", labelCls: "text-emerald-400", bg: "bg-emerald-950/30" };
                                  case "Dispute":  return {
                                    icon: n.body?.startsWith("Resolved") || n.subject?.includes("resolved")
                                      ? <CheckCircle2 size={11} />
                                      : n.body?.startsWith("Rejected") || n.subject?.includes("rejected")
                                        ? <XCircle size={11} />
                                        : <AlertOctagon size={11} />,
                                    border: n.subject?.includes("resolved") ? "border-l-2 border-emerald-500" : n.subject?.includes("rejected") ? "border-l-2 border-stone-500" : "border-l-2 border-rose-500",
                                    label: n.sender || "Staff",
                                    labelCls: n.subject?.includes("resolved") ? "text-emerald-400" : n.subject?.includes("rejected") ? "text-stone-400" : "text-rose-400",
                                    bg: n.subject?.includes("resolved") ? "bg-emerald-950/20" : n.subject?.includes("rejected") ? "bg-stone-800/40" : "bg-rose-950/20",
                                  };
                                  case "Promise":  return {
                                    icon: n.subject === "Promise broken" ? <AlertOctagon size={11} /> : n.direction === "Inbound" ? <Clock size={11} /> : <CalendarClock size={11} />,
                                    border: n.subject === "Promise broken" ? "border-l-2 border-amber-500" : "border-l-2 border-sky-500",
                                    label: n.subject === "Promise broken" ? "System" : (n.sender || "Staff"),
                                    labelCls: n.subject === "Promise broken" ? "text-amber-400" : "text-sky-400",
                                    bg: n.subject === "Promise broken" ? "bg-amber-950/20" : "bg-sky-950/20",
                                  };
                                  case "Email":    return { icon: n.direction === "Inbound" ? <ArrowDownRight size={11} /> : <Mail size={11} />, border: n.direction === "Inbound" ? "border-l-2 border-emerald-500" : "border-l-2 border-blue-500", label: n.direction === "Inbound" ? `Reply from ${n.sender || "customer"}` : `Sent to ${n.recipients || "customer"}`, labelCls: n.direction === "Inbound" ? "text-emerald-400" : "text-blue-400", bg: n.direction === "Inbound" ? "bg-emerald-950/20" : "bg-blue-950/20" };
                                  case "Chase":       return { icon: <ArrowUpRight size={11} />, border: "border-l-2 border-amber-500",  label: `${n.sender || "Staff"} · chased outside app`, labelCls: "text-amber-400",  bg: "bg-amber-950/20" };
                                  case "StageChange": {
                                    // Subject may carry an escalation type suffix: "Open → Escalated · Handed Over"
                                    const toStage = (n.subject?.split(" → ")[1] ?? "").split(" · ")[0];
                                    const isEsc   = toStage === "Escalated";
                                    return {
                                      icon:     isEsc ? <UserCheck size={11} /> : <Flag size={11} />,
                                      border:   isEsc ? "border-l-2 border-rose-500" : "border-l-2 border-indigo-500",
                                      label:    `${n.sender || "Staff"} · ${isEsc ? "escalated invoice" : "stage updated"}`,
                                      labelCls: isEsc ? "text-rose-400" : "text-indigo-400",
                                      bg:       isEsc ? "bg-rose-950/20" : "bg-indigo-950/10",
                                    };
                                  }
                                  default:           return { icon: <StickyNote size={11} />,   border: "border-l-2 border-stone-600",  label: n.sender || "Staff",                           labelCls: "text-stone-400",  bg: "" };
                                }
                              })();

                              return (
                                <div key={n.id} className={`rounded-lg px-3 py-2 ${cfg.border} ${cfg.bg}`}>
                                  <div className="flex items-center justify-between gap-2 mb-1">
                                    <div className={`flex items-center gap-1.5 text-[10px] font-semibold ${cfg.labelCls}`}>
                                      {cfg.icon}
                                      <span>{cfg.label}</span>
                                    </div>
                                    <span className="text-[10px] text-stone-600 tabular-nums flex-shrink-0">{dateStr} {timeStr}</span>
                                  </div>
                                  {n.channel === "StageChange" ? (() => {
                                    const [fromStage, toRaw] = (n.subject ?? "").split(" → ");
                                    // Subject may carry an escalation type suffix: "Escalated · Handed Over"
                                    const [toStage, escType] = (toRaw ?? "").split(" · ");
                                    const toColor = stageColor(toStage ?? "");
                                    // Body: line 1 = "Name · email", line 2 (optional) = "note"
                                    const [assigneeLine, ...noteLines] = (n.body ?? "").split("\n");
                                    const noteText = noteLines.join("\n").trim();
                                    return (
                                      <div className="mt-1 space-y-1.5">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className="text-[10px] font-medium bg-stone-700/80 text-stone-300 rounded-full px-2 py-0.5 border border-stone-600">{fromStage}</span>
                                          <span className="text-[10px] text-stone-500 font-bold">→</span>
                                          <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${toColor}`}>{toStage}</span>
                                          {escType && (
                                            <span
                                              title={escalationTypeByLabel(escType)?.description}
                                              className="text-[10px] font-medium bg-rose-900/30 text-rose-300 border border-rose-800 rounded-full px-2 py-0.5">
                                              {escType}
                                            </span>
                                          )}
                                        </div>
                                        {assigneeLine && (
                                          <div className="flex items-center gap-1.5 text-[11px] text-rose-300">
                                            <UserCheck size={11} className="text-rose-400 shrink-0" />
                                            <span className="font-medium">Assigned to</span>
                                            <span>{assigneeLine.split(" · ")[0]}</span>
                                            {assigneeLine.includes(" · ") && (
                                              <span className="text-stone-500 text-[10px]">· {assigneeLine.split(" · ")[1]}</span>
                                            )}
                                          </div>
                                        )}
                                        {noteText && (
                                          <div className="text-[11px] text-stone-400 italic pl-4">{noteText}</div>
                                        )}
                                      </div>
                                    );
                                  })() : (
                                    <>
                                      {n.subject && n.channel !== "Note" && n.channel !== "Portal" && (
                                        <div className="text-[11px] font-medium text-stone-300 mb-0.5">{n.subject}</div>
                                      )}
                                      <div className="text-[12px] text-stone-300 whitespace-pre-wrap leading-relaxed">{n.body}</div>
                                    </>
                                  )}
                                  {n.channel === "Email" && (
                                    <button
                                      onClick={() => setReplyContext({
                                        toEmail:    n.direction === "Inbound" ? n.sender : n.recipients,
                                        subject:    n.subject ? (n.subject.startsWith("Re:") ? n.subject : `Re: ${n.subject}`) : "",
                                        messageId:  n.messageId ?? null,
                                        refNumber:  n.refNumber ?? null,
                                        invoiceId:  n.invoiceId,
                                        customerId: n.customerId,
                                        projectId:  n.projectId,
                                      })}
                                      className="mt-1.5 flex items-center gap-1 text-[10px] text-stone-500 hover:text-blue-400 transition-colors"
                                    >
                                      <CornerUpLeft size={10} />
                                      Reply
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {/* Add note input */}
                          <div className="p-2.5 border-t border-stone-800 flex-shrink-0 space-y-2">
                            <div className="text-[10px] text-stone-600 font-medium px-1">Internal note</div>
                            <div className="flex items-center gap-1.5">
                              <input value={noteText} onChange={e => setNoteText(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const r = sortedRows.find(x => x.inv.id === inv.id); if (r) addNote(r); } }}
                                placeholder="Write a note…" className="flex-1 text-[12px] border border-stone-700 rounded-lg px-2.5 py-1.5 bg-stone-900 text-stone-300 placeholder-stone-600 outline-none focus:ring-1 focus:ring-emerald-500" />
                              <button onClick={() => addNote(sortedRows.find(x => x.inv.id === inv.id)!)} disabled={savingNote || !noteText.trim()}
                                className="text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg px-3 py-1.5 disabled:opacity-40 transition-colors">Add</button>
                            </div>

                            {/* Log Chase — record a touchpoint made outside the app */}
                            <div className="border-t border-stone-800/60 pt-2">
                              {chaseOpenId !== inv.id ? (
                                <button
                                  onClick={() => { setChaseOpenId(inv.id); setChaseDate(todayStr()); setChaseRef(lastRef ?? ""); setChaseMemo(""); }}
                                  className="w-full flex items-center gap-1.5 text-[11px] text-amber-500 hover:text-amber-400 font-medium px-1 py-0.5 transition-colors"
                                >
                                  <ArrowUpRight size={12} />
                                  Log chase outside app
                                </button>
                              ) : (
                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between px-1">
                                    <span className="text-[10px] font-semibold text-amber-500 flex items-center gap-1"><ArrowUpRight size={11} />Log chase</span>
                                    <button onClick={() => setChaseOpenId(null)} className="text-stone-600 hover:text-stone-400"><X size={12} /></button>
                                  </div>
                                  <div className="flex gap-1.5">
                                    <input type="date" value={chaseDate} onChange={e => setChaseDate(e.target.value)}
                                      className="w-36 text-[11px] border border-stone-700 rounded px-2 py-1 bg-stone-900 text-stone-300 outline-none focus:ring-1 focus:ring-amber-500" />
                                    <input value={chaseRef} onChange={e => setChaseRef(e.target.value)}
                                      placeholder={lastRef ?? "Ref (optional)"}
                                      className="flex-1 text-[11px] border border-stone-700 rounded px-2 py-1 bg-stone-900 text-stone-300 placeholder-stone-600 outline-none focus:ring-1 focus:ring-amber-500" />
                                  </div>
                                  <div className="flex gap-1.5">
                                    <input value={chaseMemo} onChange={e => setChaseMemo(e.target.value)}
                                      onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const r = sortedRows.find(x => x.inv.id === inv.id); if (r) addChase(r); } }}
                                      placeholder="Memo e.g. Left voicemail, promised to pay Friday"
                                      className="flex-1 text-[11px] border border-stone-700 rounded px-2 py-1 bg-stone-900 text-stone-300 placeholder-stone-600 outline-none focus:ring-1 focus:ring-amber-500" />
                                    <button onClick={() => { const r = sortedRows.find(x => x.inv.id === inv.id); if (r) addChase(r); }} disabled={savingChase}
                                      className="text-[11px] font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded px-3 py-1 disabled:opacity-40 transition-colors whitespace-nowrap">Log</button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-stone-800 bg-stone-900/60 font-semibold">
                <td colSpan={12} className="px-3 py-2.5 text-[12px] text-stone-400 text-right">
                  {sortedRows.length} invoice{sortedRows.length !== 1 ? "s" : ""}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {(() => {
                    const byCcy: Record<string, number> = {};
                    sortedRows.forEach(r => {
                      const c = r.inv.currency ?? "USD";
                      byCcy[c] = (byCcy[c] || 0) + r.bal;
                    });
                    return Object.entries(byCcy)
                      .filter(([, v]) => v > 0)
                      .sort((a, b) => b[1] - a[1])
                      .map(([c, v]) => (
                        <div key={c} className="text-white">{fmt.money(v, c)}</div>
                      ));
                  })()}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {showSend && (
        <SendInvoicesModal rows={selectedRows} ccy={selectedRows[0]?.inv.currency ?? "USD"} multiCustomer={selectedCustomers.size > 1}
          orgName={orgName} logoUrl={orgLogoUrl}
          onClose={() => {
            setShowSend(false);
            // Cancelled a quick-send — restore the selection it displaced.
            if (preQuickSendSelection) { setSelected(preQuickSendSelection); setPreQuickSendSelection(null); }
          }}
          onSent={() => { setShowSend(false); setSelected(new Set()); setPreQuickSendSelection(null); refresh(); }}
          toast={toast} />
      )}
      {replyContext && (
        <EmailComposer
          context={{ customerId: replyContext.customerId, invoiceId: replyContext.invoiceId, projectId: replyContext.projectId, replyTo: replyContext }}
          onClose={() => setReplyContext(null)}
        />
      )}
    </div>
  );
}
