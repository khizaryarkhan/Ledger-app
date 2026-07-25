"use client";

import { useState } from "react";
import { Send, X, AlertTriangle } from "lucide-react";
import { genEmailRef } from "@/lib/email-ref";
import { renderInvoiceEmail } from "@/lib/ar-email";
import { buildStatementPdf } from "@/lib/statement-pdf";

// Uint8Array → base64 (chunked to avoid call-stack limits on large PDFs).
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) binary += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(binary);
}

// Minimal row shape the send modal needs. BoardRow is a structural superset,
// so the Collections Board can pass its rows directly.
export type SendRow = {
  inv: any;
  custId: string;
  custName: string;
  projName: string | null;
  bal: number;
  days: number;
  email: string | null;
};

const splitEmails = (s: string | null) =>
  (s || "").split(/[,;]/).map(e => e.trim().toLowerCase()).filter(e => e.includes("@"));
const uniqEmails = (vals: (string | null)[]) => {
  const set = new Set<string>();
  vals.forEach(v => splitEmails(v).forEach(e => set.add(e)));
  return [...set];
};
const domainOf = (email: string) => (email.split("@")[1] || "").trim().toLowerCase();
const NO_EMAIL = "(no email on file)";
const rowDomain = (r: SendRow) => {
  const first = splitEmails(r.email)[0];
  return first ? domainOf(first) : NO_EMAIL;
};

type DomainGroup = { domain: string; emails: string[]; rows: SendRow[]; total: number };

/**
 * Shared "send invoices" composer — Collections Board (bulk) + invoice detail.
 *
 * Domain-aware: invoices are grouped by the DOMAIN of their billing email. When
 * a selection spans more than one domain (e.g. a novated project) the default
 * is to SPLIT — one email per domain, each carrying only its own invoices and
 * getting its OWN reference number, so no party sees another's and each thread
 * tracks separately. But because a shared auditor / bank / negotiator across
 * domains is a legitimate case, the user can tick "send as one combined email"
 * to override the split — with a clear caution that everyone then sees
 * everything.
 */
export function SendInvoicesModal({ rows, ccy, multiCustomer = false, orgName, logoUrl, onClose, onSent, toast }: {
  rows: SendRow[];
  ccy: string;
  multiCustomer?: boolean;
  orgName?: string;
  logoUrl?: string | null;
  onClose: () => void;
  onSent: () => void;
  toast?: (m: string, t?: string) => void;
}) {
  const groups: DomainGroup[] = (() => {
    const m = new Map<string, DomainGroup>();
    for (const r of rows) {
      const d = rowDomain(r);
      if (!m.has(d)) m.set(d, { domain: d, emails: [], rows: [], total: 0 });
      const g = m.get(d)!;
      g.rows.push(r);
      g.total += r.bal;
    }
    for (const g of m.values()) g.emails = uniqEmails(g.rows.map(r => r.email));
    return [...m.values()].sort((a, b) =>
      (a.domain === NO_EMAIL ? 1 : 0) - (b.domain === NO_EMAIL ? 1 : 0) || b.total - a.total);
  })();

  const sendable = groups.filter(g => g.domain !== NO_EMAIL);
  const noEmailGroup = groups.find(g => g.domain === NO_EMAIL) ?? null;
  const multiDomain = sendable.length > 1;

  const [combine, setCombine] = useState(false);           // send all domains in one email (opt-in)
  const [ack, setAck] = useState(false);                    // confirm the combined (everyone-sees-all) send
  const [baseRef] = useState(genEmailRef);                  // ref for the single-email cases
  const [tos, setTos] = useState<Record<string, string>>(
    Object.fromEntries(sendable.map(g => [g.domain, g.emails.join(", ")])),
  );
  const [combinedTo, setCombinedTo] = useState(uniqEmails(rows.map(r => r.email)).join(", "));
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(`Open Invoices — Ref ${baseRef}`);
  const [body, setBody] = useState(
    `Hi,\n\nPlease find attached a statement of your open invoices along with copies of each invoice for your reference.\nCould you please share the expected payment dates at your earliest convenience?\nFeel free to reach out if you have any questions.`
  );
  const [attachPdf, setAttachPdf] = useState(true);
  const [attachStatement, setAttachStatement] = useState(true);
  const [includePortal, setIncludePortal] = useState(true);
  const [sending, setSending] = useState(false);

  const willSplit = multiDomain && !combine; // one email per domain, distinct refs

  // Send one email covering `rowsList` to `toStr`, tagged with `ref`.
  async function sendEmail(rowsList: SendRow[], toStr: string, ref: string): Promise<{ ok: boolean; error?: string }> {
    const ids = rowsList.map(r => r.inv.id);
    const total = rowsList.reduce((s, r) => s + r.bal, 0);
    const emailCurrency = rowsList[0]?.inv?.currency || ccy;
    let portalUrl: string | null = null;
    const custIds = new Set(rowsList.map(r => r.custId));
    if (includePortal && custIds.size === 1) {
      try {
        const tk = await fetch("/api/portal/token", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerId: rowsList[0].custId, invoiceIds: ids }),
        });
        if (tk.ok) portalUrl = (await tk.json()).url ?? null;
      } catch {}
    }
    const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const html = renderInvoiceEmail({
      subject, dateStr, total, currency: emailCurrency, portalUrl, intro: body,
      rows: rowsList.map(r => ({
        invoiceNumber: r.inv.invoiceNumber, customerName: r.custName, projectName: r.projName,
        invoiceDate: r.inv.invoiceDate, dueDate: r.inv.dueDate, balance: r.bal, currency: r.inv.currency, daysOverdue: r.days,
      })),
    });
    // Build the Statement of Open Invoices PDF for THIS email's rows — the
    // exact same document as the Export › Statement, so each recipient gets a
    // statement of only the invoices they can see.
    let extraAttachments: { filename: string; contentBase64: string; contentType: string }[] | undefined;
    if (attachStatement) {
      try {
        const bytes = await buildStatementPdf({
          orgName: orgName || "Statement of Open Invoices",
          rows: rowsList.map(r => ({ inv: r.inv, custName: r.custName, projName: r.projName, bal: r.bal, days: r.days })),
          logoUrl: logoUrl ?? null,
        });
        extraAttachments = [{ filename: "Statement-of-Open-Invoices.pdf", contentBase64: bytesToBase64(bytes), contentType: "application/pdf" }];
      } catch (e: any) {
        return { ok: false, error: `Couldn't build the statement PDF: ${e?.message || "unknown error"}` };
      }
    }
    try {
      const res = await fetch("/api/email/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: toStr, cc: cc || undefined, subject, body: html, invoiceId: rowsList[0]?.inv.id, attachInvoiceIds: attachPdf ? ids : undefined, extraAttachments }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); return { ok: false, error: d.error || "Send failed" }; }
      const sentMessageId = (await res.json()).messageId ?? null;
      await Promise.all(rowsList.map(r => fetch("/api/communications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: r.custId, invoiceId: r.inv.id, projectId: r.inv.projectId ?? null,
          direction: "Outbound", channel: "Email", subject, recipients: toStr, body,
          matchedBy: "Manual", isDraft: false, refNumber: ref, messageId: sentMessageId,
        }),
      }).catch(() => {})));
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || "Send failed" };
    }
  }

  async function send() {
    if (sendable.length === 0) { toast?.("None of these invoices have an email on file", "error"); return; }
    if (multiDomain && combine && !ack) { toast?.("Please confirm the combined send", "error"); return; }
    setSending(true);
    let ok = 0; let failed = 0;
    try {
      if (willSplit) {
        // One email per domain — each gets its OWN reference number.
        for (const g of sendable) {
          const toStr = (tos[g.domain] ?? "").trim();
          if (!toStr) { failed++; toast?.(`@${g.domain}: add a recipient`, "error"); continue; }
          const r = await sendEmail(g.rows, toStr, genEmailRef());
          if (r.ok) ok++; else { failed++; toast?.(`@${g.domain}: ${r.error}`, "error"); }
        }
      } else {
        // One combined email (single domain, or user opted to combine).
        const allRows = sendable.flatMap(g => g.rows);
        const toStr = (multiDomain ? combinedTo : tos[sendable[0].domain] ?? "").trim();
        if (!toStr) { toast?.("Add at least one recipient", "error"); setSending(false); return; }
        const r = await sendEmail(allRows, toStr, baseRef);
        if (r.ok) ok++; else { failed++; toast?.(r.error ?? "Send failed", "error"); }
      }
    } finally { setSending(false); }
    if (ok > 0) {
      const skipped = noEmailGroup ? ` · ${noEmailGroup.rows.length} skipped (no email)` : "";
      toast?.(`Sent ${ok} email${ok !== 1 ? "s" : ""}${failed ? ` · ${failed} failed` : ""}${skipped}`);
      onSent();
    }
  }

  const inputCls = "w-full mt-1 text-sm border border-stone-700 rounded-lg px-3 py-2 bg-stone-800 text-stone-200 placeholder-stone-600 outline-none focus:ring-1 focus:ring-emerald-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-stone-900 border border-stone-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-white">
              Send {rows.length} invoice{rows.length !== 1 ? "s" : ""}
              {willSplit && <span className="text-stone-400 font-normal"> · {sendable.length} recipients</span>}
            </h3>
            <div className="text-[11px] text-stone-400 mt-0.5">
              {willSplit
                ? <>Reference: <span className="font-mono text-emerald-400">one per email (auto)</span></>
                : <>Email reference: <span className="font-mono text-emerald-400">{baseRef}</span></>}
            </div>
          </div>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-200"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-3">
          {/* Multi-domain control */}
          {multiDomain && (
            <div className={`rounded-lg border px-3 py-2.5 text-[12px] space-y-2 ${combine ? "bg-amber-500/10 border-amber-500/40 text-amber-100" : "bg-stone-800/60 border-stone-700 text-stone-300"}`}>
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className={`mt-0.5 shrink-0 ${combine ? "text-amber-400" : "text-stone-500"}`} />
                <div>
                  These invoices span <strong>{sendable.length} domains</strong> (e.g. a novated project, or a shared auditor/bank).
                  {combine
                    ? " They'll go out as ONE email — every recipient will see all invoices."
                    : " By default they're sent as separate emails, each with only its own invoices and its own reference number."}
                </div>
              </div>
              <label className="flex items-center gap-2 pl-6 cursor-pointer">
                <input type="checkbox" checked={combine} onChange={e => { setCombine(e.target.checked); setAck(false); }} className="rounded border-stone-500" />
                Send as one combined email to all domains
              </label>
              {combine && (
                <label className="flex items-center gap-2 pl-6 cursor-pointer text-amber-100">
                  <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} className="rounded border-amber-400" />
                  I understand every recipient will see all {rows.length} invoices.
                </label>
              )}
            </div>
          )}
          {noEmailGroup && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-[12px] text-amber-200">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
              {noEmailGroup.rows.length} invoice{noEmailGroup.rows.length !== 1 ? "s have" : " has"} no email on file and will be skipped.
            </div>
          )}

          {/* Recipients */}
          {willSplit ? (
            sendable.map(g => (
              <div key={g.domain} className="rounded-lg border border-stone-800 bg-stone-800/40 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-stone-200">@{g.domain}</span>
                  <span className="text-[11px] text-stone-500">{g.rows.length} inv · {g.rows.map(r => `#${r.inv.invoiceNumber}`).slice(0, 4).join(", ")}{g.rows.length > 4 ? "…" : ""}</span>
                </div>
                <label className="text-[11px] font-medium text-stone-400">To (this domain)</label>
                <input value={tos[g.domain] ?? ""} onChange={e => setTos(p => ({ ...p, [g.domain]: e.target.value }))} placeholder="email@example.com" className={inputCls} />
              </div>
            ))
          ) : (
            <div>
              <label className="text-[11px] font-medium text-stone-400">To</label>
              <input
                value={multiDomain ? combinedTo : (tos[sendable[0]?.domain] ?? "")}
                onChange={e => multiDomain ? setCombinedTo(e.target.value) : setTos({ [sendable[0]?.domain]: e.target.value })}
                placeholder="email@example.com, another@example.com"
                className={inputCls}
              />
            </div>
          )}

          <div>
            <label className="text-[11px] font-medium text-stone-400">CC {willSplit && <span className="text-stone-600">(applied to every email)</span>}</label>
            <input value={cc} onChange={e => setCc(e.target.value)} placeholder="optional" className={inputCls} />
          </div>
          <div>
            <label className="text-[11px] font-medium text-stone-400">Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="text-[11px] font-medium text-stone-400">Message</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={8} className={`${inputCls} resize-none`} />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-stone-800 bg-stone-800/40 px-3 py-2.5">
            <div>
              <div className="text-[13px] font-medium text-stone-200">Attach statement of open invoices</div>
              <div className="text-[11px] text-stone-500">{attachStatement ? (willSplit ? "A statement (each domain's invoices only) will be attached." : "The same statement PDF as Export will be attached.") : "No statement attached."}</div>
            </div>
            <button type="button" role="switch" aria-checked={attachStatement} onClick={() => setAttachStatement(v => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${attachStatement ? "bg-emerald-600" : "bg-stone-600"}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${attachStatement ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-stone-800 bg-stone-800/40 px-3 py-2.5">
            <div>
              <div className="text-[13px] font-medium text-stone-200">Attach invoice PDF</div>
              <div className="text-[11px] text-stone-500">{attachPdf ? "Each invoice PDF will be attached." : "No individual invoice PDFs attached."}</div>
            </div>
            <button type="button" role="switch" aria-checked={attachPdf} onClick={() => setAttachPdf(v => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${attachPdf ? "bg-emerald-600" : "bg-stone-600"}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${attachPdf ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-stone-800 bg-stone-800/40 px-3 py-2.5">
            <div>
              <div className="text-[13px] font-medium text-stone-200">Include customer portal link</div>
              <div className="text-[11px] text-stone-500">{includePortal ? "A \"View & Respond\" button will be included." : "No portal link — recipients reply by email only."}</div>
            </div>
            <button type="button" role="switch" aria-checked={includePortal} onClick={() => setIncludePortal(v => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${includePortal ? "bg-emerald-600" : "bg-stone-600"}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${includePortal ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
          <p className="text-[11px] text-stone-500">Sent in the standard branded format with an invoice table. The text above is the intro message.</p>
        </div>

        <div className="px-5 py-3 border-t border-stone-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-stone-400 hover:text-stone-200">Cancel</button>
          <button onClick={send} disabled={sending || sendable.length === 0 || (multiDomain && combine && !ack)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50">
            {sending && <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
            <Send size={14} /> {sending ? "Sending…" : willSplit ? `Send ${sendable.length} emails` : "Send email"}
          </button>
        </div>
      </div>
    </div>
  );
}
