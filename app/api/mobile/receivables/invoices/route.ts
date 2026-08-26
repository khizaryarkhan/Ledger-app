/**
 * GET /api/mobile/receivables/invoices
 *   ?q=            search invoice no. / customer / project
 *   &filter=       open (default) | overdue | promised | disputed | escalated | all
 *   &customerId=   restrict to one customer
 *   &limit= &offset=
 *
 * The rep's working list. Scoped server-side, and returns the row shape the
 * list screen needs (customer/project name, open balance, days overdue, stage)
 * so the app doesn't have to fetch and join four collections to draw a row.
 */

import { db } from "@/db";
import { invoices, customers, projects, invoiceDisputes, organisations } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { and, eq, inArray, desc } from "drizzle-orm";
import { DEFAULT_STAGES, ensureLockedStages, resolveStageLabel, type Stage } from "@/lib/stages";
import {
  resolveRepScope, invoiceScopeFilter, openBalance, isOpenInvoice, isCreditMemo, daysOverdue,
} from "@/lib/receivables/rep-scope";

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function GET(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const filter = url.searchParams.get("filter") || "open";
  const customerId = url.searchParams.get("customerId");
  const limit = Math.min(Number(url.searchParams.get("limit") || 100), 300);
  const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0);

  const scope = await resolveRepScope(orgId!, (session!.user as any)?.id ?? null);
  const scopeFilter = await invoiceScopeFilter(orgId!, scope);

  const where = [eq(invoices.orgId, orgId!)];
  if (scopeFilter) where.push(scopeFilter);
  if (customerId) where.push(eq(invoices.customerId, customerId));

  const [rows, [org]] = await Promise.all([
    db.select({ inv: invoices, custName: customers.name, projName: projects.name })
      .from(invoices)
      .leftJoin(customers, eq(customers.id, invoices.customerId))
      .leftJoin(projects, eq(projects.id, invoices.projectId))
      .where(and(...where))
      .orderBy(desc(invoices.dueDate)),
    db.select({ stages: organisations.stages }).from(organisations)
      .where(eq(organisations.id, orgId!)).limit(1),
  ]);
  const stages: Stage[] = ensureLockedStages((org?.stages as Stage[] | null) ?? DEFAULT_STAGES);

  // Which of these have an unresolved dispute — the list shows a marker, and
  // the "disputed" filter needs it. One query rather than one per row.
  const ids = rows.map(r => r.inv.id);
  const openDisputeIds = new Set<string>();
  if (ids.length) {
    const ds = await db.select({ invoiceId: invoiceDisputes.invoiceId, status: invoiceDisputes.status })
      .from(invoiceDisputes)
      .where(and(eq(invoiceDisputes.orgId, orgId!), inArray(invoiceDisputes.invoiceId, ids)));
    for (const d of ds) if (d.status === "Open" || d.status === "Under Review") openDisputeIds.add(d.invoiceId);
  }

  let mapped = rows.map(({ inv, custName, projName }) => {
    const balance = openBalance(inv);
    const overdue = daysOverdue(inv.dueDate);
    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      customerId: inv.customerId,
      customerName: custName ?? "—",
      projectName: projName ?? null,
      currency: inv.currency,
      total: r2(Number(inv.total || 0)),
      balance: r2(balance),
      dueDate: inv.dueDate,
      daysOverdue: overdue,
      stage: inv.collectionStage || "New",
      stageLabel: resolveStageLabel(inv.collectionStage || "New", stages),
      paymentStatus: inv.paymentStatus,
      promiseDate: inv.promiseDate ?? null,
      // A promise whose date has passed is a BROKEN commitment, not a
      // commitment — the board shows it in red and so should the app.
      promiseBroken: !!inv.promiseDate && daysOverdue(inv.promiseDate) > 0,
      disputeReason: inv.disputeReason ?? null,
      hasOpenDispute: openDisputeIds.has(inv.id),
      escalatedTo: inv.escalatedToName ?? null,
      isCreditMemo: isCreditMemo(inv),
      isOpen: isOpenInvoice(inv),
    };
  });

  switch (filter) {
    case "all": break;
    case "overdue":   mapped = mapped.filter(i => i.isOpen && i.daysOverdue > 0); break;
    case "promised":  mapped = mapped.filter(i => i.isOpen && !!i.promiseDate); break;
    case "disputed":  mapped = mapped.filter(i => i.isOpen && (i.hasOpenDispute || !!i.disputeReason)); break;
    case "escalated": mapped = mapped.filter(i => i.isOpen && i.stage === "Escalated"); break;
    default:          mapped = mapped.filter(i => i.isOpen); break;
  }

  if (q) {
    mapped = mapped.filter(i =>
      i.invoiceNumber.toLowerCase().includes(q) ||
      i.customerName.toLowerCase().includes(q) ||
      (i.projectName ?? "").toLowerCase().includes(q));
  }

  // Most urgent first: furthest overdue, then largest balance.
  mapped.sort((a, b) => (b.daysOverdue - a.daysOverdue) || (b.balance - a.balance));

  return ok({ total: mapped.length, invoices: mapped.slice(offset, offset + limit) });
}
