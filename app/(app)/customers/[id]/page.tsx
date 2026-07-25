"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { Card, Badge, Button, EmptyState, stageBadge, dueStatusBadge } from "@/components/ui";
import { CustomerModal, ProjectModal } from "@/components/forms";
import { Timeline, AuditTimeline, TasksList, EmailComposer, AddContactModal } from "@/components/feature";
import { SendInvoicesModal } from "@/components/send-invoices-modal";
import { TransactionsTab } from "@/components/transactions-tab";
import { fmt, daysOverdue, getDueStatus, getAgingBucket } from "@/lib/format";
import { ArrowLeft, Mail, Phone, Plus, Users, FileText, Briefcase, Zap } from "lucide-react";

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { customers, invoices, projects, contacts, communications, tasks, addNote, orgSettings, refresh, toast } = useData() as any;
  const [tab, setTab] = useState<"overview" | "transactions" | "invoices" | "projects" | "contacts" | "timeline" | "audit" | "tasks">("overview");
  const [showAddContact, setShowAddContact] = useState(false);
  const [showEditCustomer, setShowEditCustomer] = useState(false);
  const [showAddProject, setShowAddProject] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [composeSeed, setComposeSeed] = useState<string[] | null>(null);
  const [replyContext, setReplyContext] = useState<any>(null);
  const [togglingChase, setTogglingChase] = useState(false);

  const customer = customers.find(c => c.id === id);
  if (!customer) {
    return (
      <div className="p-6">
        <EmptyState icon={Users} title="Customer not found" description="It may have been deleted."
          action={<Button onClick={() => router.push("/customers")}>Back to customers</Button>} />
      </div>
    );
  }

  const custInvoices = useMemo(() => invoices.filter(i => i.customerId === id), [invoices, id]);
  const custProjects = projects.filter(p => p.customerId === id);
  const custContacts = contacts.filter(c => c.customerId === id);
  const custComms = useMemo(() => communications.filter(c => c.customerId === id), [communications, id]);
  const custTasks = tasks.filter(t => t.customerId === id);

  const open = custInvoices.filter(i => i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off" && i.txnType !== "CreditMemo");
  const invoiceOutstanding = open.reduce((s, i) => s + (i.total - (i.paid || 0)), 0);
  const overdue = open.filter(i => daysOverdue(i.dueDate) > 0).reduce((s, i) => s + (i.total - (i.paid || 0)), 0);
  const invCcy = open[0]?.currency ?? customer.currency ?? "USD";
  const buckets: Record<string, number> = { "Current": 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  open.forEach(i => { buckets[getAgingBucket(i)] += i.total - (i.paid || 0); });

  // Net balance from the dedicated endpoint — includes JEs, deposits, unapplied
  // CMs and payments so the card ties to QBO's Customer.Balance.
  const [netBalance, setNetBalance] = useState<number | null>(null);
  useEffect(() => {
    if (!id) return;
    fetch(`/api/customers/${id}/balance`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setNetBalance(d?.netBalance ?? null))
      .catch(() => setNetBalance(null));
  }, [id]);

  // Display: net balance once it loads (matches QBO); fall back to invoice-only
  // computation while the request is in flight.
  const outstanding = netBalance ?? invoiceOutstanding;
  // Same rule as the customers list — computed from AR, not DB status field
  const effectiveStatus = customer.status === "On Hold" ? "On Hold" : outstanding > 0 ? "Active" : "Inactive";

  const handleToggleChaseByProject = async () => {
    setTogglingChase(true);
    try {
      await fetch(`/api/customers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chaseByProject: !customer.chaseByProject }),
      });
      await refresh();
      toast(!customer.chaseByProject ? "Reminders will now be sent per project" : "Reminders will now be sent at customer level");
    } catch {
      toast("Failed to update chase setting", "error");
    } finally {
      setTogglingChase(false);
    }
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <Link href="/customers" className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-200 mb-4">
        <ArrowLeft size={14} /> Back to customers
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div className="flex items-start gap-4">

          <div className="w-14 h-14 rounded-lg bg-stone-800 flex items-center justify-center text-stone-200 text-lg font-semibold flex-shrink-0">
            {customer.name.split(" ").slice(0, 2).map(w => w[0]).join("")}
          </div>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-semibold text-stone-100 tracking-tight">{customer.name}</h1>
              {customer.riskRating === "High" && <Badge variant="red">High risk</Badge>}
              {customer.riskRating === "Medium" && <Badge variant="yellow">Medium risk</Badge>}
              <Badge variant={effectiveStatus === "Active" ? "green" : effectiveStatus === "On Hold" ? "orange" : "neutral"}>
                {effectiveStatus}
              </Badge>
              {outstanding > 0 && (
                <span className="text-sm font-semibold tabular-nums text-stone-300">
                  {fmt.money(outstanding, invCcy)} outstanding
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-stone-400">
              <span className="font-mono text-xs">{customer.code}</span>
              <span className="text-stone-700">·</span>
              <span>{customer.country || "—"}</span>
              <span className="text-stone-700">·</span>
              <span>{customer.currency}</span>
              <span className="text-stone-700">·</span>
              <span>{customer.paymentTerms} day terms</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Chase-by-project toggle */}
          <button
            onClick={handleToggleChaseByProject}
            disabled={togglingChase}
            title={customer.chaseByProject ? "Currently chasing per project — click to switch to customer level" : "Currently chasing at customer level — click to switch to per project"}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg ring-1 text-sm font-medium transition-colors disabled:opacity-50 ${
              customer.chaseByProject
                ? "bg-violet-900/30 ring-violet-700 text-violet-300 hover:bg-violet-900/50"
                : "bg-stone-800 ring-stone-700 text-stone-400 hover:bg-stone-700 hover:text-stone-200"
            }`}
          >
            <Zap size={13} className={customer.chaseByProject ? "text-violet-600" : "text-stone-400"} />
            {customer.chaseByProject ? "Chasing by Project" : "Chase by Project"}
          </button>
          <button
            onClick={() => window.open(`/api/customers/${id}/statement`, '_blank')}
            className="flex items-center gap-2 px-3 py-2 rounded-lg ring-1 bg-stone-800 ring-stone-700 text-stone-400 hover:bg-stone-700 hover:text-stone-200 text-sm font-medium transition-colors"
          >
            <FileText size={13} />
            Statement
          </button>
          <Button icon={Mail} onClick={() => setShowCompose(true)}>Send email</Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-6">
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Outstanding</div>
          <div className="text-xl font-semibold text-stone-100 tabular-nums">{fmt.money(outstanding, invCcy)}</div>
        </Card>
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Overdue</div>
          <div className={`text-xl font-semibold tabular-nums ${overdue > 0 ? "text-rose-400" : "text-stone-100"}`}>{fmt.money(overdue, invCcy)}</div>
        </Card>
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Open invoices</div>
          <div className="text-xl font-semibold text-stone-100 tabular-nums">{open.length}</div>
        </Card>
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Credit limit</div>
          <div className="text-xl font-semibold text-stone-100 tabular-nums">{fmt.money(customer.creditLimit, invCcy)}</div>
        </Card>
      </div>

      <div className="border-b border-stone-800 mb-5">
        <div className="flex items-center gap-1">
          {[
            { id: "overview", label: "Overview" },
            { id: "transactions", label: "Transactions" },
            { id: "projects", label: `Projects (${custProjects.length})` },
            { id: "contacts", label: `Contacts (${custContacts.length})` },
            { id: "timeline", label: "Communications" },
            { id: "audit", label: "Audit Trail" },
            { id: "tasks", label: `Tasks (${custTasks.length})` },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t.id ? "border-emerald-500 text-stone-100" : "border-transparent text-stone-500 hover:text-stone-200"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "overview" && (
        <div className="grid grid-cols-3 gap-3">
          <Card className="col-span-2">
            <h3 className="text-sm font-semibold text-stone-100 mb-4">Aging breakdown</h3>
            <div className="space-y-2.5">
              {["Current", "1-30", "31-60", "61-90", "90+"].map((b, i) => {
                const colors = ["bg-emerald-500", "bg-amber-400", "bg-orange-500", "bg-rose-500", "bg-rose-700"];
                const labels = ["Current", "1-30 days overdue", "31-60 days overdue", "61-90 days overdue", "90+ days overdue"];
                const max = Math.max(...Object.values(buckets), 1);
                return (
                  <div key={b} className="flex items-center gap-3">
                    <div className="w-44 text-xs text-stone-400 font-medium">{labels[i]}</div>
                    <div className="flex-1 h-6 bg-stone-800 rounded relative overflow-hidden">
                      <div className={`h-full ${colors[i]}`} style={{ width: `${(buckets[b] / max) * 100}%` }} />
                    </div>
                    <div className="w-28 text-right text-sm font-semibold text-stone-100 tabular-nums">{fmt.money(buckets[b], invCcy)}</div>
                  </div>
                );
              })}
            </div>
          </Card>
          <Card>
            <h3 className="text-sm font-semibold text-stone-100 mb-3">Customer info</h3>
            <dl className="space-y-2.5 text-sm">
              <div><dt className="text-xs text-stone-500">Tax number</dt><dd className="font-mono text-xs text-stone-300">{customer.taxNumber || "—"}</dd></div>
              <div><dt className="text-xs text-stone-500">Status</dt><dd className="text-stone-300">{customer.status}</dd></div>
              <div><dt className="text-xs text-stone-500">Risk rating</dt><dd className="text-stone-300">{customer.riskRating}</dd></div>
              {customer.notes && <div><dt className="text-xs text-stone-500">Notes</dt><dd className="text-stone-400 mt-1">{customer.notes}</dd></div>}
            </dl>
          </Card>
        </div>
      )}

      {tab === "transactions" && (
        <TransactionsTab
          fetchUrl={`/api/customers/${id}/transactions`}
          scope="customer"
          onSendSelected={(refIds) => {
            if (!refIds.length) return;
            setComposeSeed(refIds);
            setShowCompose(true);
          }}
        />
      )}

      {tab === "invoices" && (
        custInvoices.length === 0 ? <Card><EmptyState icon={FileText} title="No invoices" description="No invoices for this customer yet." /></Card> : (
          <Card padding="none">
            <table className="w-full text-sm">
              <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                <th className="text-left font-semibold px-4 py-2.5">Invoice</th>
                <th className="text-left font-semibold px-4 py-2.5">Due</th>
                <th className="text-left font-semibold px-4 py-2.5">Status</th>
                <th className="text-left font-semibold px-4 py-2.5">Stage</th>
                <th className="text-right font-semibold px-4 py-2.5">Total</th>
                <th className="text-right font-semibold px-4 py-2.5">Open</th>
              </tr></thead>
              <tbody>
                {custInvoices.map(inv => {
                  const isCM = inv.txnType === "CreditMemo";
                  // Invoices: open = total - paid. CMs: open = qboBalance (unapplied portion).
                  const open = isCM ? (inv.qboBalance ?? inv.total) : (inv.total - (inv.paid || 0));
                  const isFullyApplied = isCM && open === 0;
                  return (
                    <tr key={inv.id} className={`border-b border-stone-800/60 hover:bg-stone-800/40 transition-colors ${isCM ? "bg-rose-900/10" : ""}`}>
                      <td className="px-4 py-3"><Link href={`/invoices/${inv.id}`} className="font-mono text-[12px] block text-stone-300">{inv.invoiceNumber}</Link></td>
                      <td className="px-4 py-3"><Link href={`/invoices/${inv.id}`} className="block text-stone-300">{fmt.shortDate(inv.dueDate)}</Link></td>
                      <td className="px-4 py-3"><Link href={`/invoices/${inv.id}`}><Badge variant={dueStatusBadge(getDueStatus(inv))}>{getDueStatus(inv)}</Badge></Link></td>
                      <td className="px-4 py-3"><Link href={`/invoices/${inv.id}`}><Badge variant={stageBadge(inv.collectionStage)}>{inv.collectionStage}</Badge></Link></td>
                      <td className="px-4 py-3 text-right tabular-nums text-stone-400"><Link href={`/invoices/${inv.id}`} className="block">{fmt.money(inv.total, inv.currency)}</Link></td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-stone-200"><Link href={`/invoices/${inv.id}`} className="block">
                        {isFullyApplied ? <span className="text-stone-500">Applied</span> : fmt.money(open, inv.currency)}
                      </Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )
      )}

      {tab === "projects" && (
        custProjects.length === 0 ? <Card><EmptyState icon={Briefcase} title="No projects" description="No projects for this customer yet." /></Card> : (
          <div className="grid grid-cols-2 gap-3">
            {custProjects.map(p => {
              const projInvoices = invoices.filter((i: any) => i.projectId === p.id);
              const projOpen = projInvoices.filter((i: any) => i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off" && i.txnType !== "CreditMemo");
              const projOut = projOpen.reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);
              const projOverdue = projOpen.filter((i: any) => daysOverdue(i.dueDate) > 0).reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);
              const projCcy = projOpen[0]?.currency ?? invCcy;
              // Live status from open AR — same rule as the Customers/Projects
              // lists, so it never looks stale waiting on a sync/backfill.
              const projStatus = p.status === "On Hold" ? "On Hold" : projOut > 0 ? "Active" : "Inactive";
              return (
                <Link key={p.id} href={`/projects/${p.id}`} className="block group">
                  <Card className="group-hover:ring-stone-600 transition-colors cursor-pointer">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-stone-100 group-hover:text-emerald-400 transition-colors truncate">{p.name}</div>
                        {p.code && !p.code.startsWith("QBO-") && (
                          <div className="text-[11px] text-stone-500 font-mono mt-0.5">{p.code}</div>
                        )}
                      </div>
                      <Badge variant={projStatus === "Active" ? "blue" : projStatus === "On Hold" ? "orange" : "neutral"} size="sm">{projStatus}</Badge>
                    </div>
                    <div className="flex items-center justify-between pt-3 border-t border-stone-800 mt-3">
                      <span className="text-xs text-stone-500">{projInvoices.length} invoice{projInvoices.length !== 1 ? "s" : ""}</span>
                      <div className="text-right">
                        <div className="text-sm font-semibold tabular-nums text-stone-100">{fmt.money(projOut, projCcy)}</div>
                        {projOverdue > 0 && <div className="text-[11px] text-rose-400 font-medium tabular-nums">{fmt.money(projOverdue, projCcy)} overdue</div>}
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )
      )}

      {tab === "contacts" && (
        <div>
          <div className="flex items-center justify-end mb-3">
            <Button size="sm" icon={Plus} onClick={() => setShowAddContact(true)}>Add contact</Button>
          </div>
          {custContacts.length === 0 ? <Card><EmptyState icon={Users} title="No contacts" description="Add billing contacts to start communicating." /></Card> : (
            <div className="grid grid-cols-2 gap-3">
              {custContacts.map(c => (
                <Card key={c.id}>
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-stone-800 flex items-center justify-center text-stone-300 text-xs font-semibold flex-shrink-0">
                      {c.name.split(" ").slice(0, 2).map((w: string) => w[0]).join("")}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-stone-100 truncate">{c.name}</div>
                        {c.isPrimary && <Badge variant="blue" size="sm">Primary</Badge>}
                        {c.isEscalation && <Badge variant="red" size="sm">Escalation</Badge>}
                      </div>
                      {c.title && <div className="text-[11px] text-stone-500 truncate">{c.title}</div>}
                      <div className="flex items-center gap-1 text-xs text-stone-400 mt-1.5">
                        <Mail size={11} /> <a href={`mailto:${c.email}`} className="hover:underline hover:text-stone-200">{c.email}</a>
                      </div>
                      {c.phone && <div className="flex items-center gap-1 text-xs text-stone-400 mt-1"><Phone size={11} /> {c.phone}</div>}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "timeline" && (
        <Timeline communications={custComms} onAddNote={(body: string) => addNote({ customerId: id, invoiceId: null, body })} onReply={(rc: any) => setReplyContext(rc)} />
      )}

      {tab === "audit" && (
        <AuditTimeline customerId={id} label={customer.name} />
      )}

      {tab === "tasks" && (
        <TasksList tasks={custTasks} />
      )}

      {replyContext && (
        <EmailComposer
          context={{ customerId: replyContext.customerId ?? id, invoiceId: replyContext.invoiceId, projectId: replyContext.projectId, replyTo: replyContext }}
          onClose={() => setReplyContext(null)}
        />
      )}
      {showAddContact && <AddContactModal customerId={id} onClose={() => setShowAddContact(false)} />}
      {showEditCustomer && <CustomerModal customer={customer} onClose={() => setShowEditCustomer(false)} />}
      {showAddProject && <ProjectModal preCustomerId={id} onClose={() => setShowAddProject(false)} />}
      {showCompose && (() => {
        // If triggered from Transactions tab with a specific selection, use those invoices.
        // Otherwise fall back to all open invoices (top-level "Send email" button).
        const source = composeSeed
          ? custInvoices.filter((inv: any) => composeSeed.includes(inv.id))
          : open;
        const sendRows = source.map((inv: any) => ({
          inv,
          custId: inv.customerId,
          custName: customer?.name ?? "Customer",
          projName: projects.find((p: any) => p.id === inv.projectId)?.name ?? null,
          bal: Number(inv.qboBalance ?? inv.xeroBalance ?? Math.max(0, (inv.total ?? 0) - (inv.paid ?? 0))),
          days: daysOverdue(inv.dueDate),
          email: inv.billingEmail
            ?? contacts?.find((c: any) => c.customerId === id && c.isPrimary && c.email)?.email
            ?? customer?.email
            ?? null,
        }));
        return (
          <SendInvoicesModal
            rows={sendRows}
            ccy={source[0]?.currency ?? "EUR"}
            orgName={orgSettings?.displayName ?? orgSettings?.name}
            logoUrl={orgSettings?.logoUrl}
            onClose={() => { setShowCompose(false); setComposeSeed(null); }}
            onSent={() => { setShowCompose(false); setComposeSeed(null); refresh(); }}
            toast={toast}
          />
        );
      })()}
    </div>
  );
}
