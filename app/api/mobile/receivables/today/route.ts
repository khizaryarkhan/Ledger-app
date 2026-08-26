/**
 * GET /api/mobile/receivables/today
 *   → the day's work queue, in priority order.
 *
 * The invoice list answers "show me everything matching X". This answers the
 * question a rep actually opens the app with: what do I do next? So it returns
 * ordered SECTIONS rather than one list — a broken commitment outranks a
 * merely-overdue invoice, because someone already promised and missed.
 *
 * Every section carries full invoice rows (not just counts), so the screen
 * draws itself in one request and works offline-ish on a bad connection.
 */

import { db } from "@/db";
import { invoices, customers, projects, organisations } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { and, eq } from "drizzle-orm";
import { DEFAULT_STAGES, ensureLockedStages, type Stage } from "@/lib/stages";
import { resolveRepScope, invoiceScopeFilter, daysOverdue } from "@/lib/receivables/rep-scope";
import { openDisputeIds, toInvoiceRow, type InvoiceRow } from "@/lib/receivables/rows";

/** How many rows per section. The queue is for acting on, not for browsing. */
const PER_SECTION = 15;

export async function GET() {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  const userId = (session!.user as any)?.id ?? null;
  const email = String((session!.user as any)?.email ?? "").toLowerCase();

  const scope = await resolveRepScope(orgId!, userId);
  const scopeFilter = await invoiceScopeFilter(orgId!, scope);

  const [rows, [org]] = await Promise.all([
    db.select({ inv: invoices, custName: customers.name, projName: projects.name })
      .from(invoices)
      .leftJoin(customers, eq(customers.id, invoices.customerId))
      .leftJoin(projects, eq(projects.id, invoices.projectId))
      .where(scopeFilter ? and(eq(invoices.orgId, orgId!), scopeFilter) : eq(invoices.orgId, orgId!)),
    db.select({ stages: organisations.stages }).from(organisations)
      .where(eq(organisations.id, orgId!)).limit(1),
  ]);
  const stages: Stage[] = ensureLockedStages((org?.stages as Stage[] | null) ?? DEFAULT_STAGES);

  const openDisputes = await openDisputeIds(orgId!, rows.map(r => r.inv.id));

  // Escalation is a named hand-off, so "escalated to me" is matched on the user
  // (or their email — an escalation can name someone with no account yet)
  // rather than on rep scope, exactly as the escalations screen does.
  const escalatedToMe = new Set(
    rows.filter(({ inv }) =>
      inv.collectionStage === "Escalated" &&
      ((userId && inv.escalatedToUserId === userId) ||
       (!!email && String(inv.escalatedToEmail ?? "").toLowerCase() === email)))
      .map(r => r.inv.id));

  const all: InvoiceRow[] = rows.map(({ inv, custName, projName }) =>
    toInvoiceRow(inv, custName, projName, stages, openDisputes.has(inv.id)));
  const open = all.filter(i => i.isOpen && !i.isCreditMemo && i.balance > 0);

  const byUrgency = (a: InvoiceRow, b: InvoiceRow) =>
    (b.daysOverdue - a.daysOverdue) || (b.balance - a.balance);
  const byBalance = (a: InvoiceRow, b: InvoiceRow) => b.balance - a.balance;

  const broken = open.filter(i => i.promiseBroken).sort(byUrgency);
  const dueToday = open.filter(i => !i.promiseBroken && i.promiseDate && daysOverdue(i.promiseDate) === 0).sort(byBalance);
  const escalated = open.filter(i => escalatedToMe.has(i.id)).sort(byUrgency);
  const disputed = open.filter(i => i.hasOpenDispute || !!i.disputeReason).sort(byBalance);
  // Anything already surfaced above is excluded — a queue that lists the same
  // invoice in four sections reads as four jobs when it's one.
  const claimed = new Set([...broken, ...dueToday, ...escalated, ...disputed].map(i => i.id));
  const overdue = open.filter(i => i.daysOverdue > 0 && !claimed.has(i.id)).sort(byUrgency);
  const dueSoon = open.filter(i => i.daysOverdue <= 0 && i.daysOverdue >= -7 && !claimed.has(i.id)).sort(
    (a, b) => a.daysOverdue - b.daysOverdue);

  const section = (key: string, title: string, blurb: string, tone: string, list: InvoiceRow[]) => ({
    key, title, blurb, tone,
    count: list.length,
    value: Math.round(list.reduce((s, i) => s + i.balance, 0) * 100) / 100,
    invoices: list.slice(0, PER_SECTION),
  });

  const sections = [
    section("broken", "Broken commitments", "Promised, then missed the date — chase these first", "danger", broken),
    section("dueToday", "Committed today", "Payment promised for today — confirm it landed", "promise", dueToday),
    section("escalated", "Escalated to you", "Waiting on your decision", "warn", escalated),
    section("disputed", "Open disputes", "Blocked until the query is resolved", "dispute", disputed),
    section("overdue", "Overdue", "Past due with no commitment on file", "danger", overdue),
    section("dueSoon", "Due this week", "Get ahead of these before they age", "neutral", dueSoon),
  ].filter(s => s.count > 0);

  return ok({
    scoped: !!scope.visibleRepIds,
    // The single number worth putting on a tab badge: things gone wrong, not
    // things merely outstanding.
    actionable: broken.length + escalated.length + disputed.length,
    sections,
  });
}
