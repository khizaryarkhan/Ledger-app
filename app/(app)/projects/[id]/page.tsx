"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { Card, Badge, Button, EmptyState, stageBadge, dueStatusBadge } from "@/components/ui";
import { EmailComposer, AddContactModal, AuditTimeline } from "@/components/feature";
import { TransactionsTab } from "@/components/transactions-tab";
import { ContactsPanel } from "@/components/contacts-panel";
import { fmt, daysOverdue, getDueStatus } from "@/lib/format";
import { ArrowLeft, FileText, Mail, Download, ArrowUpRight, FileEdit, Link2, MessageSquare, Users, Plus, Phone } from "lucide-react";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { projects, customers, invoices, contacts, communications, regions, reps, updateProject, refresh } = useData() as any;
  const [tab, setTab] = useState<"transactions" | "invoices" | "timeline" | "audit" | "contacts">("transactions");
  const [showCompose, setShowCompose] = useState(false);
  const [repSaving, setRepSaving] = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const project = projects.find((p: any) => p.id === id);
  const customer = project ? customers.find((c: any) => c.id === project.customerId) : null;

  if (!project || !customer) {
    return (
      <div className="p-6">
        <EmptyState icon={FileText} title="Project not found"
          action={<Button onClick={() => router.push("/projects")}>Back to projects</Button>} />
      </div>
    );
  }

  const projInvoices = useMemo(() =>
    invoices.filter((i: any) => i.projectId === id)
      .sort((a: any, b: any) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime()),
    [invoices, id]
  );

  const projInvoiceIds = useMemo(() => new Set(projInvoices.map((i: any) => i.id)), [projInvoices]);

  // Communications: anything with this projectId OR linked to one of this project's invoices
  const projComms = useMemo(() =>
    (communications as any[])
      .filter(c => c.projectId === id || (c.invoiceId && projInvoiceIds.has(c.invoiceId)))
      .sort((a: any, b: any) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()),
    [communications, id, projInvoiceIds]
  );

  // Project-specific contacts + customer-level contacts as fallback
  const projectContacts = useMemo(() =>
    contacts.filter((c: any) => c.projectId === id),
    [contacts, id]
  );
  const customerContacts = useMemo(() =>
    contacts.filter((c: any) => c.customerId === customer.id && !c.projectId),
    [contacts, customer.id]
  );

  const open = projInvoices.filter((i: any) => i.paymentStatus !== "Paid" && i.collectionStage !== "Closed" && i.txnType !== "CreditMemo");
  const outstanding = open.reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);
  const overdue = open.filter((i: any) => daysOverdue(i.dueDate) > 0).reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);
  const region = (regions ?? []).find((r: any) => r.id === project?.regionId)?.name || null;
  // Same rule as projects list — computed from AR, not DB status field
  const effectiveStatus = project.status === "On Hold" ? "On Hold" : outstanding > 0 ? "Active" : "Inactive";

  const assignedRep   = (reps ?? []).find((r: any) => r.id === project?.repId) ?? null;
  const edRms         = (reps ?? []).filter((r: any) => r.tier === "ed" || r.tier === "rd");
  const regularReps   = (reps ?? []).filter((r: any) => r.tier !== "ed" && r.tier !== "rd");

  const handleRepChange = async (newRepId: string) => {
    setRepSaving(true);
    try {
      await updateProject(project.id, { repId: newRepId || null });
      await refresh();
    } finally { setRepSaving(false); }
  };

  const handleDownloadPdf = async (e: React.MouseEvent, inv: any) => {
    e.preventDefault();
    if (!inv.qboId || inv.qboId.startsWith("CM-")) return;
    setDownloadingId(inv.id);
    try {
      const res = await fetch(`/api/invoices/${inv.id}/pdf`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `Invoice-${inv.invoiceNumber}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } finally { setDownloadingId(null); }
  };

  const totalContacts = projectContacts.length + customerContacts.length;

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <Link href={`/customers/${customer.id}`} className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-200 mb-4">
        <ArrowLeft size={14} /> Back to {customer.name}
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-semibold text-stone-100 tracking-tight">{project.name}</h1>
            <Badge variant={effectiveStatus === "Active" ? "green" : effectiveStatus === "On Hold" ? "orange" : "neutral"}>
              {effectiveStatus}
            </Badge>
            {outstanding > 0 && (
              <span className="text-sm font-semibold tabular-nums text-stone-300">
                {fmt.money(outstanding, customer.currency)} outstanding
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-stone-500 flex-wrap">
            <span className="font-mono text-xs">{project.code}</span>
            <span>·</span>
            <Link href={`/customers/${customer.id}`} className="hover:text-stone-200">{customer.name}</Link>
            {region && <><span>·</span><span>{region}</span></>}
            <span>·</span>
            {/* Rep / ED/RM inline assignment */}
            <div className="flex items-center gap-1.5">
              {assignedRep && (
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                  assignedRep.tier === "ed" || assignedRep.tier === "rd"
                    ? "bg-orange-900/30 text-orange-400" : "bg-emerald-900/30 text-emerald-400"
                }`}>
                  {assignedRep.tier === "ed" || assignedRep.tier === "rd" ? "ED/RM" : "PM"}
                </span>
              )}
              <select
                value={project.repId ?? ""}
                onChange={e => handleRepChange(e.target.value)}
                disabled={repSaving}
                className="h-7 px-2 text-xs rounded-md border border-stone-700 bg-stone-800/60 text-stone-200 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
              >
                <option value="">— Assign Rep / ED/RM —</option>
                {regularReps.length > 0 && (
                  <optgroup label="Rep / PM">
                    {regularReps.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </optgroup>
                )}
                {edRms.length > 0 && (
                  <optgroup label="ED / RM">
                    {edRms.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </optgroup>
                )}
              </select>
              {repSaving && <span className="text-[10px] text-stone-400">Saving…</span>}
            </div>
          </div>
        </div>
        <Button icon={Mail} onClick={() => setShowCompose(true)}>Send email</Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Outstanding</div>
          <div className="text-xl font-semibold text-stone-100 tabular-nums">{fmt.money(outstanding, customer.currency)}</div>
        </Card>
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Overdue</div>
          <div className={`text-xl font-semibold tabular-nums ${overdue > 0 ? "text-rose-400" : "text-stone-100"}`}>{fmt.money(overdue, customer.currency)}</div>
        </Card>
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Open invoices</div>
          <div className="text-xl font-semibold text-stone-100">{open.length}</div>
        </Card>
      </div>

      {/* Tabs */}
      <div className="border-b border-stone-800 mb-5 flex items-center gap-1">
        {[
          { id: "transactions", label: "Transactions" },
          { id: "timeline", label: `Communications (${projComms.length})` },
          { id: "audit", label: "Audit Trail" },
          { id: "contacts", label: `Contacts (${totalContacts})` },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t.id ? "border-emerald-500 text-stone-100" : "border-transparent text-stone-500 hover:text-stone-200"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Transactions tab — unified view of invoices, credit memos, payments */}
      {tab === "transactions" && (
        <TransactionsTab fetchUrl={`/api/projects/${id}/transactions`} scope="project" />
      )}

      {/* Invoices tab */}
      {tab === "invoices" && (
        <Card padding="none">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                <th className="text-left font-semibold px-4 py-2.5">Invoice</th>
                <th className="text-left font-semibold px-4 py-2.5">Due date</th>
                <th className="text-left font-semibold px-4 py-2.5">Status</th>
                <th className="text-left font-semibold px-4 py-2.5">Stage</th>
                <th className="text-right font-semibold px-4 py-2.5">Outstanding</th>
                <th className="w-10 px-2 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {projInvoices.map((inv: any) => {
                const out = inv.total - (inv.paid || 0);
                const dueStatus = getDueStatus(inv);
                const isPaid = inv.paymentStatus === "Paid" || inv.collectionStage === "Closed";
                return (
                  <tr key={inv.id} className="border-b border-stone-800/60 hover:bg-stone-800/40 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/invoices/${inv.id}`} className="font-mono text-[12px] text-emerald-400 hover:underline">{inv.invoiceNumber}</Link>
                    </td>
                    <td className="px-4 py-3 text-stone-400 text-[12px]">
                      {fmt.shortDate(inv.dueDate)}
                      {daysOverdue(inv.dueDate) > 0 && !isPaid && (
                        <span className="ml-1.5 text-[11px] text-rose-400 font-medium">+{daysOverdue(inv.dueDate)}d</span>
                      )}
                    </td>
                    <td className="px-4 py-3"><Badge variant={dueStatusBadge(dueStatus)}>{dueStatus}</Badge></td>
                    <td className="px-4 py-3"><Badge variant={stageBadge(inv.collectionStage)}>{inv.collectionStage}</Badge></td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-stone-100">{fmt.money(out, customer.currency)}</td>
                    <td className="px-2 py-3 w-10">
                      {inv.qboId && !inv.qboId.startsWith("CM-") && (
                        <button onClick={(e) => handleDownloadPdf(e, inv)}
                          className="p-1.5 rounded hover:bg-stone-700 text-stone-500 hover:text-stone-200"
                          title="Download PDF">
                          {downloadingId === inv.id
                            ? <span className="animate-spin inline-block w-3.5 h-3.5 border border-stone-400 border-t-transparent rounded-full" />
                            : <Download size={14} />}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {projInvoices.length === 0 && (
            <div className="p-8 text-center text-sm text-stone-500">No invoices for this project</div>
          )}
        </Card>
      )}

      {/* Timeline tab */}
      {tab === "timeline" && (
        projComms.length === 0 ? (
          <Card>
            <EmptyState icon={MessageSquare} title="No activity yet"
              description="Emails sent for this project will appear here with their reference numbers."
              action={<Button icon={Mail} onClick={() => setShowCompose(true)}>Send first email</Button>} />
          </Card>
        ) : (
          <div className="space-y-2">
            {projComms.map((c: any) => {
              const isNote = c.channel === "Note";
              const inv = c.invoiceId ? projInvoices.find((i: any) => i.id === c.invoiceId) : null;
              return (
                <div key={c.id} className="bg-stone-900 ring-1 ring-stone-800 rounded-lg px-4 py-3.5 flex items-start gap-3">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${isNote ? "bg-amber-900/30 text-amber-400" : "bg-sky-900/30 text-sky-400"}`}>
                    {isNote ? <FileEdit size={13} /> : <ArrowUpRight size={13} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    {!isNote && c.refNumber && (
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="font-mono text-[11px] font-semibold bg-stone-700 text-stone-200 px-2 py-0.5 rounded">
                          {c.refNumber}
                        </span>
                        {c.stageAtSend && (
                          <span className="text-[11px] text-stone-500">
                            stage: <span className="font-medium text-stone-300">{c.stageAtSend}</span>
                          </span>
                        )}
                      </div>
                    )}
                    <div className="text-sm font-medium text-stone-200 truncate">
                      {isNote ? "Internal note" : (c.subject || "Email")}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {!isNote && c.recipients && (
                        <span className="text-[11px] text-stone-500">To: {c.recipients}</span>
                      )}
                      {inv && (
                        <span className="flex items-center gap-1 text-[11px] text-stone-500">
                          <Link2 size={10} />
                          <Link href={`/invoices/${inv.id}`} className="font-mono text-emerald-400 hover:underline">{inv.invoiceNumber}</Link>
                        </span>
                      )}
                      {isNote && c.body && <span className="text-[12px] text-stone-400">{c.body}</span>}
                    </div>
                  </div>
                  <div className="text-[11px] text-stone-500 whitespace-nowrap flex-shrink-0 mt-0.5">
                    {fmt.relative(c.sentAt)}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Audit Trail tab */}
      {tab === "audit" && (
        <AuditTimeline
          customerId={project.customerId}
          projectId={id}
          label={`${project.name} (${customer.name})`}
        />
      )}

      {/* Contacts tab */}
      {tab === "contacts" && (
        <ContactsPanel customerId={project.customerId} projectId={id} />
      )}

      {showCompose && (
        <EmailComposer
          context={{ customerId: customer.id, projectId: id }}
          onClose={() => setShowCompose(false)}
        />
      )}
      {showAddContact && (
        <AddContactModal
          customerId={customer.id}
          projectId={id}
          onClose={() => setShowAddContact(false)}
        />
      )}
    </div>
  );
}
