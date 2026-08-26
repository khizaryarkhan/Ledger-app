/**
 * GET /api/mobile/notifications
 *   → the alerts feed: what changed on your book that you didn't do yourself.
 *
 * There is no push infrastructure and no per-user read state yet, so this is
 * deliberately DERIVED from real records rather than a notifications table:
 * customer replies, disputes raised, commitments broken, invoices escalated to
 * you. Nothing here is invented — every item points at the row that caused it,
 * so tapping one lands on that invoice.
 *
 * `since` (ISO date, default 30 days ago) bounds the window. Ordering is newest
 * first, and `actionable` counts the items that represent a problem rather than
 * just news — that's what the tab badge shows.
 */

import { db } from "@/db";
import {
  invoices, customers, projects, communications, invoiceDisputes, organisations,
} from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { and, eq, gte, inArray, desc } from "drizzle-orm";
import { DEFAULT_STAGES, ensureLockedStages, resolveStageLabel, type Stage } from "@/lib/stages";
import {
  resolveRepScope, invoiceScopeFilter, openBalance, isOpenInvoice, daysOverdue,
} from "@/lib/receivables/rep-scope";

type Alert = {
  id: string;
  kind: "reply" | "dispute" | "broken" | "escalation";
  tone: "promise" | "dispute" | "danger" | "warn";
  title: string;
  body: string | null;
  at: string;
  actionable: boolean;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  currency: string;
  balance: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const DEFAULT_WINDOW_DAYS = 30;

export async function GET(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  const userId = (session!.user as any)?.id ?? null;
  const email = String((session!.user as any)?.email ?? "").toLowerCase();

  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam && !Number.isNaN(Date.parse(sinceParam))
    ? new Date(sinceParam)
    : new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86_400_000);

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

  // Only open invoices can generate an alert worth acting on.
  const openRows = rows.filter(r => isOpenInvoice(r.inv) && openBalance(r.inv) > 0);
  const byId = new Map(openRows.map(r => [r.inv.id, r]));
  const openIds = [...byId.keys()];

  const meta = (id: string) => {
    const r = byId.get(id)!;
    return {
      invoiceId: id,
      invoiceNumber: r.inv.invoiceNumber,
      customerName: r.custName ?? "—",
      currency: r.inv.currency,
      balance: r2(openBalance(r.inv)),
    };
  };

  const [replies, disputes] = await Promise.all([
    openIds.length
      ? db.select({
          id: communications.id, invoiceId: communications.invoiceId, channel: communications.channel,
          subject: communications.subject, body: communications.body, sentAt: communications.sentAt,
          sender: communications.sender,
        }).from(communications)
        .where(and(
          eq(communications.orgId, orgId!),
          eq(communications.direction, "Inbound"),
          inArray(communications.invoiceId, openIds),
          gte(communications.sentAt, since),
        )).orderBy(desc(communications.sentAt)).limit(100)
      : Promise.resolve([]),
    openIds.length
      ? db.select({
          id: invoiceDisputes.id, invoiceId: invoiceDisputes.invoiceId, category: invoiceDisputes.category,
          reason: invoiceDisputes.reason, status: invoiceDisputes.status, source: invoiceDisputes.source,
          createdAt: invoiceDisputes.createdAt,
        }).from(invoiceDisputes)
        .where(and(
          eq(invoiceDisputes.orgId, orgId!),
          inArray(invoiceDisputes.invoiceId, openIds),
          gte(invoiceDisputes.createdAt, since),
        )).orderBy(desc(invoiceDisputes.createdAt)).limit(100)
      : Promise.resolve([]),
  ]);

  const alerts: Alert[] = [];

  // A customer wrote back. This is the highest-signal event in collections and
  // the one most easily missed when it lands in a shared mailbox.
  for (const c of replies) {
    if (!c.invoiceId || !byId.has(c.invoiceId)) continue;
    alerts.push({
      id: `reply:${c.id}`,
      kind: "reply",
      tone: "promise",
      title: `Reply from ${c.sender || "customer"}`,
      body: c.subject || (c.body ? String(c.body).slice(0, 240) : null),
      at: new Date(c.sentAt as any).toISOString(),
      actionable: true,
      ...meta(c.invoiceId),
    });
  }

  for (const d of disputes) {
    if (!byId.has(d.invoiceId)) continue;
    const stillOpen = d.status === "Open" || d.status === "Under Review";
    alerts.push({
      id: `dispute:${d.id}`,
      kind: "dispute",
      tone: "dispute",
      title: stillOpen ? `Dispute raised · ${d.category}` : `Dispute ${String(d.status).toLowerCase()} · ${d.category}`,
      body: d.reason ?? null,
      at: new Date(d.createdAt as any).toISOString(),
      actionable: stillOpen,
      ...meta(d.invoiceId),
    });
  }

  // Broken commitments have no event row of their own — they happen by the
  // calendar moving, which is exactly why they need surfacing. Dated on the
  // promise date so they sort into the feed where they actually occurred.
  for (const [id, r] of byId) {
    const promise = r.inv.promiseDate;
    if (!promise) continue;
    const late = daysOverdue(promise);
    if (late <= 0) continue;
    const at = new Date(`${String(promise).slice(0, 10)}T00:00:00Z`);
    if (at < since) continue;
    alerts.push({
      id: `broken:${id}`,
      kind: "broken",
      tone: "danger",
      title: `Commitment missed · ${late}d ago`,
      body: `${r.custName ?? "Customer"} promised payment by ${String(promise).slice(0, 10)}.`,
      at: at.toISOString(),
      actionable: true,
      ...meta(id),
    });
  }

  // Escalated to me, matched on user id or email — an escalation can name
  // someone who has no user account yet.
  for (const [id, r] of byId) {
    const inv = r.inv;
    if (inv.collectionStage !== "Escalated") continue;
    const mine = (userId && inv.escalatedToUserId === userId)
      || (!!email && String(inv.escalatedToEmail ?? "").toLowerCase() === email);
    if (!mine) continue;
    const at = inv.escalatedAt ? new Date(inv.escalatedAt as any) : null;
    if (!at || at < since) continue;
    alerts.push({
      id: `escalation:${id}`,
      kind: "escalation",
      tone: "warn",
      title: `Escalated to you${inv.escalationType ? ` · ${inv.escalationType}` : ""}`,
      body: `${resolveStageLabel(inv.collectionStage, stages)} · ${daysOverdue(inv.dueDate)}d overdue`,
      at: at.toISOString(),
      actionable: true,
      ...meta(id),
    });
  }

  alerts.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return ok({
    since: since.toISOString(),
    actionable: alerts.filter(a => a.actionable).length,
    alerts: alerts.slice(0, 150),
  });
}
