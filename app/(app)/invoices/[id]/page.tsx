"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { Card, Badge, Button, EmptyState, stageBadge, dueStatusBadge } from "@/components/ui";
import { Timeline, EmailComposer, PaymentModal, DisputeModal, PromiseModal, TaskModal, TasksList } from "@/components/feature";
import { PromiseDisputePanel } from "@/components/promise-dispute-panel";
import { SendInvoicesModal } from "@/components/send-invoices-modal";
import { fmt, formatDate, daysOverdue, getDueStatus, sourceLabel, sourceBadgeVariant } from "@/lib/format";
import { ArrowLeft, Mail, CreditCard, AlertOctagon, CalendarClock, CheckSquare, FileText, Clock, Download, Loader, Trash2, ChevronDown } from "lucide-react";

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { invoices, customers, projects, contacts, communications, tasks, orgSettings, refresh, toast } = useData() as any;
  const [tab, setTab] = useState<"overview" | "comms" | "tasks" | "lines">("overview");
  const [showCompose, setShowCompose] = useState(false);
  const [replyContext, setReplyContext] = useState<any>(null);
  const [showPay, setShowPay] = useState(false);
  const [showDispute, setShowDispute] = useState(false);
  const [showPromise, setShowPromise] = useState(false);
  const [showTask, setShowTask] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showStageMenu, setShowStageMenu] = useState(false);
  const [stageSaving, setStageSaving] = useState(false);
  const stageMenuRef = useRef<HTMLDivElement>(null);

  const inv = invoices.find(i => i.id === id);
  if (!inv) {
    return (
      <div className="p-6">
        <EmptyState icon={FileText} title="Invoice not found" description="It may have been deleted or moved."
          action={<Button onClick={() => router.push("/invoices")}>Back to invoices</Button>} />
      </div>
    );
  }

  const canDownloadPdf =
    (inv.qboId && !inv.qboId.startsWith("CM-")) ||
    (inv.xeroId && !inv.xeroId.startsWith("CN-"));

  const handleDownloadPdf = async () => {
    if (!canDownloadPdf) return;
    setDownloadingPdf(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(`/api/invoices/${inv.id}/pdf`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Failed to download PDF");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Invoice-${inv.invoiceNumber}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      clearTimeout(timer);
      if (e?.name === "AbortError") alert("PDF download timed out — please try again.");
      else alert("Failed to download PDF");
    } finally {
      setDownloadingPdf(false);
    }
  };

  const customer = customers.find(c => c.id === inv.customerId);
  const project = projects.find(p => p.id === inv.projectId);
  const customerContacts = contacts.filter(c => c.customerId === inv.customerId);
  const invComms = useMemo(() => communications.filter(c => c.invoiceId === id), [communications, id]);
  const invTasks = useMemo(() => tasks.filter(t => t.invoiceId === id), [tasks, id]);
  const isPaidOrClosed = ["Paid", "Written Off"].includes(inv.paymentStatus) || inv.collectionStage === "Closed";
  const out = isPaidOrClosed ? 0 : inv.total - (inv.paid || 0);
  const df = orgSettings?.dateFormat || "DD MMM YYYY";

  // Derive stage list from org settings (handles both string[] and Stage-object[] formats)
  const rawStages: any[] = orgSettings?.stages ?? [
    "New", "Open", "1st Reminder Sent", "2nd Reminder Sent", "Final Demand Sent",
    "Disputed", "On Hold", "Promise to Pay", "Escalated", "Legal", "Closed",
  ];
  const orgStages: string[] = rawStages
    .map((s) => (typeof s === "string" ? s : (s.label ?? s.key ?? "")))
    .filter(Boolean);

  const handleStageChange = async (newStage: string) => {
    if (newStage === inv.collectionStage) { setShowStageMenu(false); return; }
    setStageSaving(true);
    setShowStageMenu(false);
    try {
      await fetch(`/api/invoices/${inv.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionStage: newStage }),
      });
      await refresh();
    } catch {
      alert("Failed to update stage");
    } finally {
      setStageSaving(false);
    }
  };

  // Close stage menu when clicking outside
  useEffect(() => {
    if (!showStageMenu) return;
    const handler = (e: MouseEvent) => {
      if (stageMenuRef.current && !stageMenuRef.current.contains(e.target as Node)) {
        setShowStageMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showStageMenu]);

  /** Billing email priority: invoice → primary contact → customer email */
  const primaryContact = contacts.find((c: any) => c.customerId === inv.customerId && c.isPrimary && c.email);
  const resolvedEmail = inv.billingEmail || primaryContact?.email || customer?.email || null;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await fetch(`/api/invoices/${inv.id}`, { method: "DELETE" });
      router.push("/invoices");
    } catch {
      alert("Failed to delete invoice");
      setDeleting(false);
    }
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <Link href="/invoices" className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-200 mb-4">
        <ArrowLeft size={14} /> Back to invoices
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-semibold text-white tracking-tight font-mono">{inv.invoiceNumber}</h1>
            <Badge variant={sourceBadgeVariant(inv.source)}>{sourceLabel(inv.source)}</Badge>
            <Badge variant={dueStatusBadge(getDueStatus(inv))}>{getDueStatus(inv)}</Badge>
            {/* Clickable stage badge with dropdown */}
            <div ref={stageMenuRef} className="relative">
              <button
                onClick={() => setShowStageMenu((v) => !v)}
                disabled={stageSaving}
                className="inline-flex items-center gap-1 focus:outline-none"
                title="Change stage"
              >
                <Badge variant={stageBadge(inv.collectionStage)}>
                  {stageSaving ? "Saving…" : inv.collectionStage}
                </Badge>
                <ChevronDown size={12} className="text-stone-400 -ml-0.5" />
              </button>
              {showStageMenu && (
                <div className="absolute left-0 top-full mt-1 z-50 bg-stone-800 rounded-lg shadow-lg ring-1 ring-stone-700 py-1 min-w-[180px]">
                  {orgStages.map((stage) => (
                    <button
                      key={stage}
                      onClick={() => handleStageChange(stage)}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-stone-700 flex items-center gap-2 ${stage === inv.collectionStage ? "font-semibold text-white" : "text-stone-300"}`}
                    >
                      {stage === inv.collectionStage && <span className="w-1.5 h-1.5 rounded-full bg-stone-900 flex-shrink-0" />}
                      {stage !== inv.collectionStage && <span className="w-1.5 h-1.5 flex-shrink-0" />}
                      {stage}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-stone-400">
            <Link href={customer ? `/customers/${customer.id}` : "#"} className="hover:text-white hover:underline">{customer?.name}</Link>
            {project && <><span className="text-stone-300">·</span><span>{project.name}</span></>}
            {inv.poNumber && <><span className="text-stone-300">·</span><span className="font-mono text-xs">PO {inv.poNumber}</span></>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canDownloadPdf && (
            <Button variant="secondary" onClick={handleDownloadPdf} disabled={downloadingPdf}>
              {downloadingPdf
                ? <span className="flex items-center gap-1.5"><Loader size={14} className="animate-spin" />Downloading…</span>
                : <span className="flex items-center gap-1.5"><Download size={14} />Download PDF</span>}
            </Button>
          )}
          <Button variant="secondary" icon={CheckSquare} onClick={() => setShowTask(true)}>Task</Button>
          <Button variant="secondary" icon={CalendarClock} onClick={() => setShowPromise(true)}
            disabled={isPaidOrClosed} title={isPaidOrClosed ? "Invoice is settled — no commitment needed" : undefined}>Commit to Pay</Button>
          <Button variant="secondary" icon={AlertOctagon} onClick={() => setShowDispute(true)}
            disabled={isPaidOrClosed} title={isPaidOrClosed ? "Invoice is settled — cannot dispute" : undefined}>Dispute</Button>
          <Button variant="secondary" icon={CreditCard} onClick={() => setShowPay(true)}>Record payment</Button>
          <Button icon={Mail} onClick={() => setShowCompose(true)}>Send email</Button>
          {!confirmDelete ? (
            <Button variant="danger" icon={Trash2} onClick={() => setConfirmDelete(true)}>Delete</Button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-rose-600 font-medium">Sure?</span>
              <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button variant="danger" size="sm" icon={Trash2} onClick={handleDelete} disabled={deleting}>
                {deleting ? "Deleting…" : "Yes, delete"}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-6">
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Total</div>
          <div className="text-xl font-semibold text-white tabular-nums">{fmt.money(inv.total, inv.currency)}</div>
        </Card>
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Paid</div>
          <div className="text-xl font-semibold text-emerald-400 tabular-nums">{fmt.money(inv.paid || 0, inv.currency)}</div>
        </Card>
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Outstanding</div>
          <div className="text-xl font-semibold text-white tabular-nums">{fmt.money(out, inv.currency)}</div>
        </Card>
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Due</div>
          <div className="text-xl font-semibold text-white tabular-nums">{formatDate(inv.dueDate, df)}</div>
          {daysOverdue(inv.dueDate) > 0 && <div className="text-[11px] text-rose-600 font-medium mt-1">{daysOverdue(inv.dueDate)} days overdue</div>}
        </Card>
      </div>

      <div className="border-b border-stone-800 mb-5">
        <div className="flex items-center gap-1">
          {[
            { id: "overview", label: "Overview" },
            { id: "lines", label: `Line Items (${(inv.lineItems || []).length})` },
            { id: "comms", label: `Communications (${invComms.length})` },
            { id: "tasks", label: `Tasks (${invTasks.length})` },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t.id ? "border-emerald-400 text-white" : "border-transparent text-stone-500 hover:text-stone-200"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "overview" && (
        <div className="grid grid-cols-3 gap-3">
          <Card className="col-span-2">
            <h3 className="text-sm font-semibold text-white mb-4">Invoice details</h3>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm text-stone-200">
              <div><dt className="text-xs text-stone-500 mb-0.5">Invoice date</dt><dd>{formatDate(inv.invoiceDate, df)}</dd></div>
              <div><dt className="text-xs text-stone-500 mb-0.5">Due date</dt><dd>{formatDate(inv.dueDate, df)}</dd></div>
              <div><dt className="text-xs text-stone-500 mb-0.5">Payment terms</dt><dd>{inv.paymentTerms} days</dd></div>
              <div><dt className="text-xs text-stone-500 mb-0.5">Currency</dt><dd>{inv.currency}</dd></div>
              <div><dt className="text-xs text-stone-500 mb-0.5">Subtotal</dt><dd className="tabular-nums">{fmt.money(inv.amount, inv.currency)}</dd></div>
              <div><dt className="text-xs text-stone-500 mb-0.5">Tax</dt><dd className="tabular-nums">{fmt.money(inv.taxAmount, inv.currency)}</dd></div>
              <div className="col-span-2">
                <dt className="text-xs text-stone-500 mb-0.5">
                  Billing email
                  {resolvedEmail && (
                    <span className="ml-2 font-normal normal-case text-stone-400">
                      {inv.billingEmail ? "· from QBO" : primaryContact?.email === resolvedEmail ? "· from contact" : "· from customer"}
                    </span>
                  )}
                </dt>
                <dd>
                  {resolvedEmail ? (
                    <div className="flex flex-wrap gap-1.5 mt-0.5">
                      {resolvedEmail.split(",").map((addr: string) => addr.trim()).filter(Boolean).map((addr: string) => (
                        <a key={addr} href={`mailto:${addr}`}
                          className="inline-flex items-center px-2 py-0.5 rounded bg-blue-900/20 text-blue-400 text-[12px] hover:bg-blue-900/30 transition-colors">
                          {addr}
                        </a>
                      ))}
                    </div>
                  ) : (
                    <span className="text-stone-500 italic text-xs">No billing email — add in QBO/Xero or add a contact</span>
                  )}
                </dd>
              </div>
              {inv.lastFollowupDate && <div><dt className="text-xs text-stone-500 mb-0.5">Last followup</dt><dd>{formatDate(inv.lastFollowupDate, df)}</dd></div>}
              {inv.promiseDate && <div><dt className="text-xs text-stone-500 mb-0.5">Commitment date</dt><dd>{formatDate(inv.promiseDate, df)}</dd></div>}
              {inv.disputeDate && <div><dt className="text-xs text-stone-500 mb-0.5">Disputed since</dt><dd>{formatDate(inv.disputeDate, df)}</dd></div>}
            </dl>
            {inv.disputeReason && (
              <div className="mt-4 pt-4 border-t border-stone-800">
                <div className="text-xs text-stone-500 mb-1">Dispute reason</div>
                <div className="text-sm text-rose-200 bg-rose-900/20 ring-1 ring-rose-800/50 rounded-md p-3">{inv.disputeReason}</div>
              </div>
            )}
            {inv.notes && (
              <div className="mt-4 pt-4 border-t border-stone-800">
                <div className="text-xs text-stone-500 mb-1">Notes</div>
                <div className="text-sm text-stone-300 whitespace-pre-wrap">{inv.notes}</div>
              </div>
            )}
          </Card>
          <Card className="col-span-1">
            <h3 className="text-sm font-semibold text-white mb-4">Contacts</h3>
            {customerContacts.length === 0 ? <div className="text-sm text-stone-500">No contacts added</div> : (
              <div className="space-y-3">
                {customerContacts.map(c => (
                  <div key={c.id} className="flex items-start gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-stone-700 flex items-center justify-center text-stone-300 text-[10px] font-semibold flex-shrink-0">
                      {c.name.split(" ").slice(0, 2).map((w: string) => w[0]).join("")}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-stone-100 truncate">{c.name}</div>
                      <div className="text-[11px] text-stone-500 truncate">{c.email}</div>
                      {c.isPrimary && <Badge variant="blue" size="sm">Primary</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Promise & Dispute event timeline (Customer Response Portal) */}
          <PromiseDisputePanel invoiceId={inv.id} currency={inv.currency} onChange={refresh} />
        </div>
      )}

      {tab === "lines" && (
        <Card>
          {(inv.lineItems || []).length === 0 ? (
            <div className="text-sm text-stone-500 text-center py-8">No line items — sync with QBO or Xero to populate.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-800 text-xs text-stone-500 uppercase tracking-wide">
                  <th className="text-left pb-2 font-medium">Description</th>
                  <th className="text-right pb-2 font-medium w-16">Qty</th>
                  <th className="text-right pb-2 font-medium w-28">Unit Price</th>
                  <th className="text-right pb-2 font-medium w-28">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-800/60">
                {(inv.lineItems as any[]).map((line, i) => (
                  <tr key={i} className="text-stone-200">
                    <td className="py-2.5 pr-4">{line.description || <span className="text-stone-600 italic">—</span>}</td>
                    <td className="py-2.5 text-right tabular-nums text-stone-400">{line.qty}</td>
                    <td className="py-2.5 text-right tabular-nums">{fmt.money(line.unitPrice, inv.currency)}</td>
                    <td className="py-2.5 text-right tabular-nums font-medium">{fmt.money(line.amount, inv.currency)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-stone-700">
                <tr>
                  <td colSpan={3} className="pt-3 text-right text-xs text-stone-500 pr-4">Subtotal</td>
                  <td className="pt-3 text-right tabular-nums font-semibold text-white">{fmt.money(inv.amount, inv.currency)}</td>
                </tr>
                {inv.taxAmount > 0 && (
                  <tr>
                    <td colSpan={3} className="py-1 text-right text-xs text-stone-500 pr-4">Tax</td>
                    <td className="py-1 text-right tabular-nums text-stone-300">{fmt.money(inv.taxAmount, inv.currency)}</td>
                  </tr>
                )}
                <tr>
                  <td colSpan={3} className="pt-1 text-right text-xs font-semibold text-stone-300 pr-4">Total</td>
                  <td className="pt-1 text-right tabular-nums font-bold text-emerald-400">{fmt.money(inv.total, inv.currency)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </Card>
      )}

      {tab === "comms" && (
        <Timeline communications={invComms} onAddNote={null} onReply={(rc: any) => setReplyContext(rc)} />
      )}

      {tab === "tasks" && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-stone-500">{invTasks.filter(t => !t.completed).length} open</div>
            <Button size="sm" icon={CheckSquare} onClick={() => setShowTask(true)}>Add task</Button>
          </div>
          <TasksList tasks={invTasks} />
        </div>
      )}

      {showCompose && (
        <SendInvoicesModal
          rows={[{
            inv,
            custId: inv.customerId,
            custName: customers.find((c: any) => c.id === inv.customerId)?.name ?? "Customer",
            projName: projects.find((p: any) => p.id === inv.projectId)?.name ?? null,
            bal: Number(inv.qboBalance ?? inv.xeroBalance ?? Math.max(0, (inv.total ?? 0) - (inv.paid ?? 0))),
            days: daysOverdue(inv.dueDate),
            email: inv.billingEmail ?? null,
          }]}
          ccy={inv.currency ?? "EUR"}
          orgName={orgSettings?.displayName ?? orgSettings?.name}
          logoUrl={orgSettings?.logoUrl}
          onClose={() => setShowCompose(false)}
          onSent={() => { setShowCompose(false); refresh(); }}
          toast={toast}
        />
      )}
      {replyContext && (
        <EmailComposer
          context={{ customerId: replyContext.customerId, invoiceId: replyContext.invoiceId, projectId: replyContext.projectId, replyTo: replyContext }}
          onClose={() => setReplyContext(null)}
        />
      )}
      {showPay && <PaymentModal invoice={inv} onClose={() => setShowPay(false)} />}
      {showDispute && <DisputeModal invoice={inv} onClose={() => setShowDispute(false)} />}
      {showPromise && <PromiseModal invoice={inv} onClose={() => setShowPromise(false)} />}
      {showTask && <TaskModal invoiceId={inv.id} customerId={inv.customerId} onClose={() => setShowTask(false)} />}
    </div>
  );
}
