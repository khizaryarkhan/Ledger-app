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
import { invoices, customers, projects, organisations } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { and, eq, desc } from "drizzle-orm";
import { DEFAULT_STAGES, ensureLockedStages, type Stage } from "@/lib/stages";
import { resolveRepScope, invoiceScopeFilter } from "@/lib/receivables/rep-scope";
import { openDisputeIds, toInvoiceRow } from "@/lib/receivables/rows";

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

  const openDisputes = await openDisputeIds(orgId!, rows.map(r => r.inv.id));

  let mapped = rows.map(({ inv, custName, projName }) =>
    toInvoiceRow(inv, custName, projName, stages, openDisputes.has(inv.id)));

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
