"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Search, RefreshCw, AlertCircle, LayoutGrid, List, Download,
  Calendar, MessageCircle, Send, X, Loader2, Check, Building2,
  ChevronDown, Clock, AlertTriangle, ExternalLink, Upload, CheckCircle2,
} from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { fmt } from "@/lib/format";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Bill {
  id: string;
  billNumber?: string;
  supplierId?: string;
  supplierName?: string;
  billDate?: string;
  dueDate?: string;
  currency: string;
  total: number;
  balance: number;
  workflowStatus: string;
  accountingStatus: string;
  approverEmail?: string;
  lastApprovalSentAt?: string;
  approvalNotePushedAt?: string | null;
  source?: string;
  qboId?: string;
  xeroId?: string;
  createdAt: string;
}

interface Comment {
  id: string;
  body: string;
  authorName: string;
  channel: string;
  createdAt: string;
}

interface SupplierGroup {
  supplierId: string;
  supplierName: string;
  bills: Bill[];
  total: number;
  currency: string;
  oldestDue?: string;
  overdueCount: number;
  onHoldCount: number;
  rejectedCount: number;
}

// ── Stage config ──────────────────────────────────────────────────────────────

const STAGES = [
  {
    id: "needs-review",
    label: "Needs Review",
    statuses: ["Synced from Accounting", "Pending Review"],
    topColor: "border-t-blue-500",
    countBg: "bg-blue-500/15 text-blue-400",
    dot: "bg-blue-400",
  },
  {
    id: "awaiting-approval",
    label: "Awaiting Approval",
    statuses: ["Pending Approval"],
    topColor: "border-t-amber-500",
    countBg: "bg-amber-500/15 text-amber-400",
    dot: "bg-amber-400",
  },
  {
    id: "approved",
    label: "Approved",
    statuses: ["Approved"],
    topColor: "border-t-violet-500",
    countBg: "bg-violet-500/15 text-violet-400",
    dot: "bg-violet-400",
  },
  {
    id: "ready-to-pay",
    label: "Ready to Pay",
    statuses: ["Ready for Payment", "Scheduled"],
    topColor: "border-t-emerald-500",
    countBg: "bg-emerald-500/15 text-emerald-400",
    dot: "bg-emerald-400",
  },
  {
    id: "paid",
    label: "Paid",
    statuses: ["Paid"],
    topColor: "border-t-stone-500",
    countBg: "bg-stone-700 text-stone-300",
    dot: "bg-stone-400",
  },
] as const;

const ALL_STATUSES = STAGES.flatMap((s) => s.statuses);
const EXCEPTION_STATUSES = ["Rejected", "On Hold"];

function stageForStatus(status: string) {
  return STAGES.find((s) => (s.statuses as readonly string[]).includes(status));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysOverdue(dueDate?: string): number {
  if (!dueDate) return 0;
  const diff = Date.now() - new Date(dueDate + "T00:00:00").getTime();
  return Math.max(0, Math.floor(diff / 86400000));
}

function fmtDate(d?: string) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function fmtRelative(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function agingBuckets(bills: Bill[]) {
  let current = 0, d30 = 0, d60 = 0, d90 = 0, d90p = 0;
  for (const b of bills) {
    const days = daysOverdue(b.dueDate);
    if (days === 0) current++;
    else if (days <= 30) d30++;
    else if (days <= 60) d60++;
    else if (days <= 90) d90++;
    else d90p++;
  }
  const total = bills.length || 1;
  return [
    { label: "Current", pct: (current / total) * 100, color: "bg-emerald-500" },
    { label: "1–30d", pct: (d30 / total) * 100, color: "bg-amber-400" },
    { label: "31–60d", pct: (d60 / total) * 100, color: "bg-orange-500" },
    { label: "61–90d", pct: (d90 / total) * 100, color: "bg-rose-500" },
    { label: "90+d", pct: (d90p / total) * 100, color: "bg-rose-700" },
  ].filter((b) => b.pct > 0);
}

function currencyTotals(bills: Bill[]) {
  const map: Record<string, number> = {};
  for (const b of bills) {
    map[b.currency] = (map[b.currency] ?? 0) + (b.balance ?? b.total ?? 0);
  }
  return Object.entries(map)
    .map(([ccy, amt]) => fmt.money(amt, ccy))
    .join(" · ");
}

// ── Send for Approval Modal ───────────────────────────────────────────────────

function SendApprovalModal({
  bills,
  open,
  onClose,
  onSent,
}: {
  bills: Bill[] | null;
  open: boolean;
  onClose: () => void;
  onSent: (billIds: string[], email: string) => void;
}) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [includePortal, setIncludePortal] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const isBatch = (bills?.length ?? 0) > 1;
  const primary = bills?.[0] ?? null;

  useEffect(() => {
    if (open && primary) {
      setTo(primary.approverEmail ?? "");
      if (isBatch) {
        const totalAmt = bills!.reduce((s, b) => s + (b.total ?? 0), 0);
        setSubject(`[Action Required] ${bills!.length} Bills Awaiting Approval`);
        setMessage(
          `Hi,\n\nPlease review and approve the following ${bills!.length} bills totalling ${fmt.money(totalAmt, primary.currency)}.\n\nClick the link in this email to review each bill's line items and submit your decision.\n\nThank you.`
        );
      } else {
        setSubject(`[Action Required] Approve Bill${primary.billNumber ? ` ${primary.billNumber}` : ""}`);
        setMessage(
          `Hi,\n\nPlease review and approve the bill${primary.billNumber ? ` (${primary.billNumber})` : ""}${primary.supplierName ? ` from ${primary.supplierName}` : ""} for ${fmt.money(primary.total, primary.currency)}.\n\nClick the link in this email to review the line items and submit your decision.\n\nThank you.`
        );
      }
      setError("");
    }
  }, [open, bills]);

  if (!open || !primary) return null;

  async function send() {
    if (!to.trim()) { setError("Approver email is required."); return; }
    setSending(true);
    setError("");
    try {
      const extraIds = bills!.slice(1).map(b => b.id);
      const res = await fetch(`/api/payables/bills/${primary!.id}/send-for-approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approverEmail: to.trim(), subject, message, includePortal,
          ...(extraIds.length > 0 ? { billIds: extraIds } : {}),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Failed to send");
      onSent(bills!.map(b => b.id), to.trim());
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  const totalAmt = bills!.reduce((s, b) => s + (b.total ?? 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-stone-900 border border-stone-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-white">Send for Approval</h3>
            <div className="text-[11px] text-stone-400 mt-0.5">
              {isBatch ? (
                <>
                  <span className="font-semibold text-violet-400">{bills!.length} bills</span>
                  <span className="mx-1.5 text-stone-600">·</span>
                  <span className="font-semibold text-stone-300">{fmt.money(totalAmt, primary.currency)}</span>
                </>
              ) : (
                <>
                  <span className="font-mono text-violet-400">{primary.billNumber ?? primary.id.slice(0, 8)}</span>
                  <span className="mx-1.5 text-stone-600">·</span>
                  <span className="font-semibold text-stone-300">{fmt.money(primary.total, primary.currency)}</span>
                  {primary.supplierName && <><span className="mx-1.5 text-stone-600">·</span><span>{primary.supplierName}</span></>}
                </>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-200"><X size={18} /></button>
        </div>

        {/* Fields */}
        <div className="p-5 space-y-3">
          <div>
            <label className="text-[11px] font-medium text-stone-400">To</label>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="approver@company.com"
              className="w-full mt-1 text-sm border border-stone-700 rounded-lg px-3 py-2 bg-stone-800 text-stone-200 placeholder-stone-600 outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-stone-400">Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full mt-1 text-sm border border-stone-700 rounded-lg px-3 py-2 bg-stone-800 text-stone-200 outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-stone-400">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={8}
              className="w-full mt-1 text-sm border border-stone-700 rounded-lg px-3 py-2 bg-stone-800 text-stone-200 outline-none focus:ring-1 focus:ring-violet-500 resize-none"
            />
          </div>

          {/* Portal link toggle */}
          <div className="flex items-center justify-between rounded-lg border border-stone-800 bg-stone-800/40 px-3 py-2.5">
            <div>
              <div className="text-[13px] font-medium text-stone-200">Include approval portal link</div>
              <div className="text-[11px] text-stone-500">
                {includePortal
                  ? "A \"Review & Approve\" button will be included in the email."
                  : "No portal link — approver replies by email only."}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={includePortal}
              onClick={() => setIncludePortal((v) => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${includePortal ? "bg-violet-600" : "bg-stone-600"}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${includePortal ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>

          <p className="text-[11px] text-stone-500">
            Sent in a branded format with bill details and line items. The text above is the intro message.
          </p>

          {error && <p className="text-xs text-rose-400">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-stone-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-stone-400 hover:text-stone-200">Cancel</button>
          <button
            onClick={send}
            disabled={sending || !to.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-700 disabled:opacity-50"
          >
            {sending
              ? <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              : <Send size={14} />}
            {sending ? "Sending…" : "Send for Approval"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Comment Popover ───────────────────────────────────────────────────────────

const CHANNEL_STYLE: Record<string, { label: string; border: string; dot: string }> = {
  internal: { label: "Internal",  border: "border-stone-700",  dot: "bg-stone-400" },
  approver: { label: "Approver",  border: "border-violet-500/40", dot: "bg-violet-400" },
  system:   { label: "System",    border: "border-blue-500/40",  dot: "bg-blue-400" },
  email:    { label: "Email",     border: "border-amber-500/40", dot: "bg-amber-400" },
};

function CommentPopover({ billId, onClose }: { billId: string; onClose: () => void }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/payables/bills/${billId}/comments`);
    if (res.ok) setComments(await res.json());
    setLoading(false);
  }, [billId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [comments]);

  async function post() {
    if (!body.trim()) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/payables/bills/${billId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: body.trim(), channel: "internal" }),
      });
      if (res.ok) {
        setBody("");
        await load();
      }
    } finally { setPosting(false); }
  }

  return (
    <div className="absolute right-0 top-8 z-40 w-80 bg-stone-900 border border-stone-700 rounded-xl shadow-2xl flex flex-col max-h-[420px]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-800">
        <span className="text-sm font-semibold text-white">Activity</span>
        <button onClick={onClose} className="p-1 rounded text-stone-500 hover:text-white hover:bg-stone-800">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && <div className="text-xs text-stone-500 text-center py-4">Loading…</div>}
        {!loading && comments.length === 0 && (
          <div className="text-xs text-stone-600 text-center py-4">No activity yet</div>
        )}
        {comments.map((c) => {
          const style = CHANNEL_STYLE[c.channel] ?? CHANNEL_STYLE.internal;
          return (
            <div key={c.id} className={`rounded-lg border ${style.border} p-2.5 bg-stone-800/40`}>
              <div className="flex items-center gap-1.5 mb-1">
                <div className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                <span className="text-[10px] font-semibold text-stone-400">{c.authorName}</span>
                <span className="text-[10px] text-stone-600 ml-auto">{fmtRelative(c.createdAt)}</span>
              </div>
              <p className="text-xs text-stone-300 whitespace-pre-wrap">{c.body}</p>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="p-3 border-t border-stone-800">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); post(); } }}
          rows={2}
          placeholder="Add a note… (Enter to post)"
          className="w-full px-2.5 py-1.5 text-xs rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-600 focus:border-violet-500 focus:outline-none resize-none"
        />
        <button
          onClick={post}
          disabled={posting || !body.trim()}
          className="mt-1.5 w-full flex items-center justify-center gap-1.5 h-7 text-xs font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40"
        >
          {posting ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Post
        </button>
      </div>
    </div>
  );
}

// ── Supplier Stage Card (Card View) ───────────────────────────────────────────

function SupplierCard({
  group,
  onSendApproval,
}: {
  group: SupplierGroup;
  onSendApproval: (bills: Bill[]) => void;
}) {
  const overdue = group.bills.filter((b) => daysOverdue(b.dueDate) > 0);
  const buckets = agingBuckets(group.bills);
  const maxDays = Math.max(...group.bills.map((b) => daysOverdue(b.dueDate)));

  return (
    <div className="bg-stone-900 border border-stone-800 rounded-lg p-3.5 hover:border-stone-700 transition-colors cursor-pointer group">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Building2 size={12} className="text-stone-500 shrink-0" />
          <span className="font-semibold text-sm text-white leading-tight truncate">
            {group.supplierName || "Unknown Supplier"}
          </span>
        </div>
        {overdue.length > 0 && (
          <span className="shrink-0 flex items-center gap-1 text-[10px] font-semibold text-rose-400 bg-rose-500/10 ring-1 ring-rose-500/30 rounded px-1.5 py-0.5">
            <AlertTriangle size={9} /> {overdue.length}
          </span>
        )}
      </div>

      {/* Amount */}
      <div className="text-lg font-bold text-white tabular-nums mb-0.5">
        {fmt.money(group.total, group.currency)}
      </div>
      <div className="text-[11px] text-stone-500 mb-2.5">
        {group.bills.length} bill{group.bills.length !== 1 ? "s" : ""}
        {group.bills.length > 1 && (
          <> · {group.currency}</>
        )}
      </div>

      {/* Due date */}
      {group.oldestDue && (
        <div className="flex items-center gap-1.5 mb-2.5">
          <Calendar size={11} className="text-stone-500" />
          <span className={`text-[11px] ${maxDays > 0 ? "text-rose-400 font-medium" : "text-stone-400"}`}>
            Due {fmtDate(group.oldestDue)}
          </span>
          {maxDays > 0 && (
            <span className="text-[10px] font-semibold bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/30 rounded px-1 py-0.5">
              +{maxDays}d
            </span>
          )}
        </div>
      )}

      {/* Aging bar */}
      {buckets.length > 0 && (
        <div className="flex h-1 rounded-full overflow-hidden gap-px mb-2.5">
          {buckets.map((b) => (
            <div key={b.label} className={`${b.color} h-full`} style={{ width: `${b.pct}%` }} title={`${b.label}: ${Math.round(b.pct)}%`} />
          ))}
        </div>
      )}

      {/* Badges */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {group.onHoldCount > 0 && (
          <span className="text-[10px] bg-orange-500/15 text-orange-400 ring-1 ring-orange-500/30 rounded px-1.5 py-0.5">
            {group.onHoldCount} on hold
          </span>
        )}
        {group.rejectedCount > 0 && (
          <span className="text-[10px] bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/30 rounded px-1.5 py-0.5">
            {group.rejectedCount} rejected
          </span>
        )}
      </div>
    </div>
  );
}

// ── Cert Sync Cell ────────────────────────────────────────────────────────────

const CERT_ELIGIBLE = ["Approved", "Ready for Payment", "Scheduled", "Paid"];

function CertSyncCell({ bill, onPushed }: { bill: Bill; onPushed: (id: string) => void }) {
  const [pushing, setPushing] = useState(false);
  const [err, setErr]         = useState<string | null>(null);

  const hasExternalId = !!(bill.qboId || bill.xeroId);
  const isEligible    = CERT_ELIGIBLE.includes(bill.workflowStatus) && hasExternalId;

  if (!isEligible) return <td className="px-3 py-2.5" />;

  const synced = !!bill.approvalNotePushedAt;

  async function push() {
    setPushing(true);
    setErr(null);
    try {
      const res  = await fetch(`/api/payables/bills/${bill.id}/push-approval-cert`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      if (!data.pushed) {
        const errMsg = data.result?.qbo?.error ?? data.result?.xero?.error ?? "Push failed";
        throw new Error(errMsg);
      }
      onPushed(bill.id);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setPushing(false);
    }
  }

  if (synced) {
    return (
      <td className="px-3 py-2.5">
        <span
          className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400"
          title={`Certificate synced ${fmtRelative(bill.approvalNotePushedAt!)}`}
        >
          <CheckCircle2 size={13} className="shrink-0" />
          Synced
        </span>
      </td>
    );
  }

  return (
    <td className="px-3 py-2.5">
      <div className="flex flex-col gap-0.5">
        <button
          onClick={push}
          disabled={pushing}
          className="inline-flex items-center gap-1 h-6 px-2 text-[11px] font-medium rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-50 border border-amber-500/20"
          title="Push approval certificate to accounting system"
        >
          {pushing
            ? <Loader2 size={10} className="animate-spin" />
            : <Upload size={10} />}
          {pushing ? "Pushing…" : "Push cert"}
        </button>
        {err && <span className="text-[9px] text-rose-400 max-w-[120px] truncate" title={err}>{err}</span>}
      </div>
    </td>
  );
}

// ── List View Row ──────────────────────────────────────────────────────────────

const WF_BADGE: Record<string, string> = {
  "Synced from Accounting": "neutral",
  "Pending Review": "blue",
  "Pending Approval": "yellow",
  "Approved": "purple",
  "Rejected": "red",
  "On Hold": "orange",
  "Ready for Payment": "green",
  "Scheduled": "green",
  "Paid": "neutral",
};

function BillRow({
  bill,
  selected,
  onSelect,
  onSendApproval,
  onEmailChange,
  onCertPushed,
}: {
  bill: Bill;
  selected: boolean;
  onSelect: (id: string) => void;
  onSendApproval: (bills: Bill[]) => void;
  onEmailChange: (id: string, email: string) => void;
  onCertPushed: (id: string) => void;
}) {
  const [editEmail, setEditEmail] = useState(false);
  const [emailVal, setEmailVal] = useState(bill.approverEmail ?? "");
  const [showComments, setShowComments] = useState(false);
  const overdue = daysOverdue(bill.dueDate);

  function saveEmail() {
    setEditEmail(false);
    if (emailVal !== bill.approverEmail) {
      onEmailChange(bill.id, emailVal);
    }
  }

  return (
    <tr className={`border-b border-stone-800/60 hover:bg-stone-800/30 transition-colors group ${selected ? "bg-violet-500/5" : ""}`}>
      <td className="pl-4 pr-2 py-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onSelect(bill.id)}
          className="rounded border-stone-600 bg-stone-800 text-violet-500 focus:ring-violet-500"
        />
      </td>
      <td className="px-3 py-2.5">
        <Link href={`/payables/bills/${bill.id}`} className="font-mono text-xs text-violet-400 hover:text-violet-300 hover:underline">
          {bill.billNumber ?? bill.id.slice(0, 8)}
        </Link>
      </td>
      <td className="px-3 py-2.5">
        <span className="text-sm text-stone-200 truncate max-w-[160px] block">
          {bill.supplierName ?? "—"}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className={`text-xs ${overdue > 0 ? "text-rose-400 font-medium" : "text-stone-400"}`}>
            {fmtDate(bill.dueDate)}
          </span>
          {overdue > 0 && (
            <span className="text-[10px] font-semibold bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/30 rounded px-1 py-0.5">
              +{overdue}d
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className="text-sm font-semibold text-white tabular-nums">{fmt.money(bill.total, bill.currency)}</span>
      </td>
      <td className="px-3 py-2.5">
        <Badge variant={(WF_BADGE[bill.workflowStatus] ?? "neutral") as any} size="sm">
          {bill.workflowStatus}
        </Badge>
      </td>
      <CertSyncCell bill={bill} onPushed={onCertPushed} />
      <td className="px-3 py-2.5 min-w-[180px]">
        {editEmail ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              type="email"
              value={emailVal}
              onChange={(e) => setEmailVal(e.target.value)}
              onBlur={saveEmail}
              onKeyDown={(e) => { if (e.key === "Enter") saveEmail(); if (e.key === "Escape") { setEditEmail(false); setEmailVal(bill.approverEmail ?? ""); } }}
              className="flex-1 h-7 px-2 text-xs rounded border border-violet-500 bg-stone-800 text-white focus:outline-none"
            />
          </div>
        ) : (
          <button
            onClick={() => setEditEmail(true)}
            className="text-xs text-left text-stone-400 hover:text-white truncate max-w-[170px] flex items-center gap-1.5 group/email"
          >
            <span className={emailVal ? "text-stone-300" : "italic text-stone-600"}>
              {emailVal || "no email"}
            </span>
            <span className="opacity-0 group-hover/email:opacity-100 text-stone-600">✏</span>
          </button>
        )}
      </td>
      <td className="px-3 py-2.5">
        {bill.lastApprovalSentAt ? (
          <span className="text-xs text-stone-500">
            {fmtDate(bill.lastApprovalSentAt.slice(0, 10))}
          </span>
        ) : (
          <span className="text-xs italic text-stone-700">Never</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <button
          onClick={() => onSendApproval([bill])}
          disabled={!emailVal}
          className="inline-flex items-center gap-1 h-6 px-2 text-[11px] font-medium rounded bg-violet-600/20 hover:bg-violet-600 text-violet-400 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title={!emailVal ? "Enter approver email first" : "Send for approval"}
        >
          <Send size={10} /> Send
        </button>
      </td>
      <td className="px-3 py-2.5 relative">
        <button
          onClick={() => setShowComments(!showComments)}
          className="p-1.5 rounded text-stone-500 hover:text-violet-400 hover:bg-stone-800 transition-colors"
          title="Activity & Comments"
        >
          <MessageCircle size={14} />
        </button>
        {showComments && (
          <CommentPopover billId={bill.id} onClose={() => setShowComments(false)} />
        )}
      </td>
      <td className="pr-3 py-2.5">
        <Link
          href={`/payables/bills/${bill.id}`}
          className="p-1.5 rounded text-stone-600 hover:text-stone-300 hover:bg-stone-800 transition-colors opacity-0 group-hover:opacity-100 inline-flex"
        >
          <ExternalLink size={13} />
        </Link>
      </td>
    </tr>
  );
}

// ── Column Skeleton ───────────────────────────────────────────────────────────

function ColumnSkeleton() {
  return (
    <div className="space-y-2">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="animate-pulse bg-stone-900 border border-stone-800 rounded-lg p-3.5 space-y-2">
          <div className="h-3.5 bg-stone-800 rounded w-3/4" />
          <div className="h-5 bg-stone-800 rounded w-1/2" />
          <div className="h-2.5 bg-stone-800 rounded w-2/3" />
          <div className="h-1 bg-stone-800 rounded-full" />
        </div>
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PayablesWorkspacePage() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"cards" | "list">("cards");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendModal, setSendModal] = useState<Bill[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/payables/bills");
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const json = await res.json();
      setBills(Array.isArray(json) ? json : json.bills ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally { setLoading(false); }
  }, []);

  const handleSync = useCallback(async () => {
    setSyncing(true); setSyncMsg(null);
    try {
      const res = await fetch("/api/payables/sync", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
      const qbo = json.qbo;
      setSyncMsg(qbo
        ? `Synced: ${qbo.billsCreated ?? 0} new, ${qbo.billsUpdated ?? 0} updated`
        : "Sync complete");
      await load();
    } catch (e: any) {
      setSyncMsg(`Sync failed: ${e.message}`);
    } finally { setSyncing(false); }
  }, [load]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let rows = bills;
    // Only show bills with an open balance (or explicitly marked Paid in workflow)
    rows = rows.filter((b) => (b.balance ?? b.total ?? 0) > 0 || b.workflowStatus === "Paid");
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(
        (b) => b.supplierName?.toLowerCase().includes(s) || b.billNumber?.toLowerCase().includes(s)
      );
    }
    if (stageFilter) {
      const stage = STAGES.find((s) => s.id === stageFilter);
      if (stage) rows = rows.filter((b) => (stage.statuses as readonly string[]).includes(b.workflowStatus));
    }
    return rows;
  }, [bills, search, stageFilter]);

  // For card view: group by supplier within each stage
  const stageGroups = useMemo(() => {
    const result: Record<string, SupplierGroup[]> = {};
    for (const stage of STAGES) {
      const stageBills = filtered.filter((b) => (stage.statuses as readonly string[]).includes(b.workflowStatus));
      const bySupplier: Record<string, Bill[]> = {};
      for (const b of stageBills) {
        const key = b.supplierId ?? b.supplierName ?? "unknown";
        if (!bySupplier[key]) bySupplier[key] = [];
        bySupplier[key].push(b);
      }
      result[stage.id] = Object.entries(bySupplier).map(([, bills]) => {
        const all = bills;
        return {
          supplierId: all[0].supplierId ?? "",
          supplierName: all[0].supplierName ?? "Unknown",
          bills: all,
          total: all.reduce((a, b) => a + (b.balance || b.total || 0), 0),
          currency: all[0].currency,
          oldestDue: all.filter((b) => b.dueDate).sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1))[0]?.dueDate,
          overdueCount: all.filter((b) => daysOverdue(b.dueDate) > 0).length,
          onHoldCount: all.filter((b) => b.workflowStatus === "On Hold").length,
          rejectedCount: all.filter((b) => b.workflowStatus === "Rejected").length,
        } satisfies SupplierGroup;
      });
    }
    return result;
  }, [filtered]);

  const exceptions = useMemo(
    () => bills.filter((b) => EXCEPTION_STATUSES.includes(b.workflowStatus)),
    [bills]
  );

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === filtered.length ? new Set() : new Set(filtered.map((b) => b.id))
    );
  }

  async function updateApproverEmail(billId: string, email: string) {
    setBills((prev) => prev.map((b) => b.id === billId ? { ...b, approverEmail: email } : b));
    await fetch(`/api/payables/bills/${billId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approverEmail: email }),
    }).catch(() => {});
  }

  function handleSent(billIds: string[], email: string) {
    const idSet = new Set(billIds);
    setBills((prev) => prev.map((b) =>
      idSet.has(b.id)
        ? { ...b, approverEmail: email, lastApprovalSentAt: new Date().toISOString(), workflowStatus: "Pending Approval" }
        : b
    ));
  }

  function handleCertPushed(billId: string) {
    setBills((prev) => prev.map((b) =>
      b.id === billId ? { ...b, approvalNotePushedAt: new Date().toISOString() } : b
    ));
  }

  const totalStr = currencyTotals(filtered);

  return (
    <div className="p-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between mb-5 shrink-0 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Payables Workspace</h1>
          <p className="text-sm text-stone-500 mt-1">
            {loading ? "Loading…" : `${filtered.length} bill${filtered.length !== 1 ? "s" : ""}${totalStr ? ` · ${totalStr}` : ""}`}
            {exceptions.length > 0 && (
              <span className="ml-2 text-orange-400">· {exceptions.length} exception{exceptions.length !== 1 ? "s" : ""} (on hold / rejected)</span>
            )}
          </p>
        </div>

        {/* View toggle + sync + refresh */}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {syncMsg && (
            <span className="text-xs text-stone-400">{syncMsg}</span>
          )}
          <button
            onClick={handleSync}
            disabled={syncing || loading}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-300 hover:text-white px-3 py-1.5 rounded-md bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={13} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Syncing…" : "Sync from QBO"}
          </button>
          <div className="flex rounded-md overflow-hidden border border-stone-700">
            {(["cards", "list"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                  view === v ? "bg-violet-500/20 text-violet-400" : "text-stone-400 hover:text-stone-200 hover:bg-stone-800"
                }`}
              >
                {v === "cards" ? <LayoutGrid size={13} /> : <List size={13} />}
                {v === "cards" ? "Cards" : "List"}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 text-sm text-stone-400 hover:text-stone-200 px-2.5 py-1.5 rounded-md hover:bg-stone-800 disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-5 shrink-0 flex-wrap">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search supplier, bill #…"
            className="h-9 pl-9 pr-3 w-72 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-200 placeholder-stone-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none"
          />
        </div>
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="h-9 px-3 pr-8 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-200 focus:border-violet-500 focus:outline-none appearance-none"
          style={{ backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2378716c' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 0.5rem center", backgroundSize: "12px" }}
        >
          <option value="">All stages</option>
          {STAGES.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
        {(search || stageFilter) && (
          <button
            onClick={() => { setSearch(""); setStageFilter(""); }}
            className="text-xs text-stone-400 hover:text-stone-200 px-2.5 py-1.5 rounded-md hover:bg-stone-800"
          >
            Clear
          </button>
        )}
      </div>

      {/* Bulk action bar (list view) */}
      {view === "list" && selected.size > 0 && (
        <div className="mb-3 shrink-0 flex items-center gap-3 px-4 py-2.5 bg-violet-500/10 border border-violet-500/30 rounded-lg">
          <span className="text-sm font-semibold text-violet-300">{selected.size} selected</span>
          <span className="text-stone-600">·</span>
          <span className="text-sm text-stone-400">
            {currencyTotals(filtered.filter((b) => selected.has(b.id)))}
          </span>
          <button
            onClick={() => {
              const selectedBills = filtered.filter((b) => selected.has(b.id));
              setSendModal(selectedBills);
            }}
            className="ml-auto flex items-center gap-1.5 h-7 px-3 text-xs font-semibold rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors"
          >
            <Send size={12} />
            Send for Approval
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-stone-400 hover:text-stone-200"
          >
            Clear
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 shrink-0 flex items-center gap-2 px-4 py-3 rounded-lg bg-rose-500/10 ring-1 ring-rose-500/30 text-rose-400 text-sm">
          <AlertCircle size={16} /> {error}
          <button onClick={load} className="ml-auto underline text-rose-300">Retry</button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && bills.length === 0 && (
        <div className="flex flex-col items-center justify-center flex-1 text-center py-20">
          <div className="w-12 h-12 rounded-full bg-stone-800 flex items-center justify-center mb-4">
            <Building2 size={20} className="text-stone-500" />
          </div>
          <p className="text-sm font-semibold text-white mb-1">No bills yet</p>
          <p className="text-sm text-stone-500">Sync your accounting system to see bills here.</p>
        </div>
      )}

      {/* ── CARD VIEW ─────────────────────────────────────────────────── */}
      {view === "cards" && (loading || bills.length > 0) && (
        <div className="flex gap-4 overflow-x-auto pb-4 flex-1 min-h-0">
          {STAGES.map((stage) => {
            const groups = stageGroups[stage.id] ?? [];
            const stageBills = filtered.filter((b) => (stage.statuses as readonly string[]).includes(b.workflowStatus));
            const stageTotal = currencyTotals(stageBills);
            return (
              <div key={stage.id} className="flex-shrink-0 w-64 flex flex-col">
                {/* Column header */}
                <div className={`bg-stone-900 border border-stone-800 border-t-2 ${stage.topColor} rounded-lg px-3 py-2.5 mb-2.5`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-stone-200">{stage.label}</span>
                    {!loading && (
                      <span className={`inline-flex items-center justify-center min-w-[20px] h-5 rounded-full text-[10px] font-bold px-1.5 ${stage.countBg}`}>
                        {groups.length}
                      </span>
                    )}
                  </div>
                  {!loading && stageTotal && (
                    <div className="text-[10px] text-stone-500 tabular-nums">{stageTotal}</div>
                  )}
                </div>
                {/* Cards */}
                <div className="flex flex-col gap-2 overflow-y-auto flex-1">
                  {loading ? (
                    <ColumnSkeleton />
                  ) : groups.length === 0 ? (
                    <div className="border border-dashed border-stone-800 rounded-lg py-8 text-center text-xs text-stone-600">
                      No bills
                    </div>
                  ) : (
                    groups.map((group) => (
                      <SupplierCard
                        key={group.supplierId || group.supplierName}
                        group={group}
                        onSendApproval={setSendModal}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── LIST VIEW ─────────────────────────────────────────────────── */}
      {view === "list" && (loading || bills.length > 0) && (
        <div className="flex-1 overflow-auto min-h-0">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-stone-900 border-b border-stone-700">
                <th className="pl-4 pr-2 py-2.5 w-8">
                  <input
                    type="checkbox"
                    checked={!loading && selected.size === filtered.length && filtered.length > 0}
                    onChange={toggleAll}
                    className="rounded border-stone-600 bg-stone-800 text-violet-500 focus:ring-violet-500"
                  />
                </th>
                {["Bill #", "Supplier", "Due Date", "Amount", "Stage", "Cert", "Approver Email", "Last Sent", "Send", "Notes", ""].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-left text-[11px] font-semibold text-stone-400 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="border-b border-stone-800/60">
                    {[...Array(12)].map((_, j) => (
                      <td key={j} className="px-3 py-3">
                        <div className="animate-pulse h-3 bg-stone-800 rounded w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-sm text-stone-600">No bills match your filters</td>
                </tr>
              ) : (
                filtered.map((bill) => (
                  <BillRow
                    key={bill.id}
                    bill={bill}
                    selected={selected.has(bill.id)}
                    onSelect={toggleSelect}
                    onSendApproval={setSendModal}
                    onEmailChange={updateApproverEmail}
                    onCertPushed={handleCertPushed}
                  />
                ))
              )}
            </tbody>
          </table>

          {/* Footer */}
          {!loading && filtered.length > 0 && (
            <div className="sticky bottom-0 flex items-center justify-between px-4 py-2.5 bg-stone-900 border-t border-stone-800 text-xs text-stone-500">
              <span>{filtered.length} bill{filtered.length !== 1 ? "s" : ""}</span>
              <span className="tabular-nums font-medium text-stone-300">{totalStr}</span>
            </div>
          )}
        </div>
      )}

      {/* Send for Approval Modal */}
      <SendApprovalModal
        bills={sendModal}
        open={!!sendModal}
        onClose={() => setSendModal(null)}
        onSent={handleSent}
      />
    </div>
  );
}
