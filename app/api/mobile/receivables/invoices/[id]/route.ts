/**
 * GET /api/mobile/receivables/invoices/[id]
 *   → one invoice with everything the detail screen shows: customer/project,
 *     balance and aging, current stage, promise & dispute history, and the
 *     activity feed (emails, notes, logged calls).
 *
 * Scope is enforced, not assumed: an invoice outside the caller's rep scope
 * returns 404 rather than the row, so guessing an id gains nothing.
 */

import { db } from "@/db";
import {
  invoices, customers, projects, contacts, communications, invoicePromises, invoiceDisputes, users,
} from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, desc } from "drizzle-orm";
import {
  resolveRepScope, invoiceScopeFilter, openBalance, isOpenInvoice, isCreditMemo, daysOverdue,
} from "@/lib/receivables/rep-scope";

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  const scope = await resolveRepScope(orgId!, (session!.user as any)?.id ?? null);
  const scopeFilter = await invoiceScopeFilter(orgId!, scope);

  const where = [eq(invoices.orgId, orgId!), eq(invoices.id, params.id)];
  if (scopeFilter) where.push(scopeFilter);

  const [row] = await db.select({ inv: invoices, custName: customers.name, custEmail: customers.email, projName: projects.name })
    .from(invoices)
    .leftJoin(customers, eq(customers.id, invoices.customerId))
    .leftJoin(projects, eq(projects.id, invoices.projectId))
    .where(and(...where)).limit(1);
  if (!row) return bad("Invoice not found", 404);

  const inv = row.inv;

  const [promises, disputes, feed, custContacts] = await Promise.all([
    db.select().from(invoicePromises)
      .where(and(eq(invoicePromises.orgId, orgId!), eq(invoicePromises.invoiceId, inv.id)))
      .orderBy(desc(invoicePromises.createdAt)),
    db.select().from(invoiceDisputes)
      .where(and(eq(invoiceDisputes.orgId, orgId!), eq(invoiceDisputes.invoiceId, inv.id)))
      .orderBy(desc(invoiceDisputes.createdAt)),
    db.select({
      id: communications.id, direction: communications.direction, channel: communications.channel,
      subject: communications.subject, body: communications.body, sentAt: communications.sentAt,
      sender: communications.sender, authorName: users.name,
    }).from(communications)
      .leftJoin(users, eq(users.id, communications.authorId))
      .where(and(eq(communications.orgId, orgId!), eq(communications.invoiceId, inv.id)))
      .orderBy(desc(communications.sentAt)).limit(100),
    db.select({ id: contacts.id, name: contacts.name, email: contacts.email, phone: contacts.phone, isPrimary: contacts.isPrimary })
      .from(contacts).where(and(eq(contacts.orgId, orgId!), eq(contacts.customerId, inv.customerId))),
  ]);

  return ok({
    invoice: {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      customerId: inv.customerId,
      customerName: row.custName ?? "—",
      customerEmail: row.custEmail ?? null,
      projectName: row.projName ?? null,
      currency: inv.currency,
      total: r2(Number(inv.total || 0)),
      paid: r2(Number(inv.paid || 0)),
      balance: r2(openBalance(inv)),
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      daysOverdue: daysOverdue(inv.dueDate),
      stage: inv.collectionStage || "New",
      paymentStatus: inv.paymentStatus,
      poNumber: inv.poNumber ?? null,
      notes: inv.notes ?? null,
      promiseDate: inv.promiseDate ?? null,
      promiseBroken: !!inv.promiseDate && daysOverdue(inv.promiseDate) > 0,
      disputeReason: inv.disputeReason ?? null,
      escalatedToName: inv.escalatedToName ?? null,
      escalatedToEmail: inv.escalatedToEmail ?? null,
      isCreditMemo: isCreditMemo(inv),
      isOpen: isOpenInvoice(inv),
    },
    contacts: custContacts,
    promises: promises.map(p => ({
      id: p.id, promiseDate: p.promiseDate, amount: p.amount, source: p.source,
      note: p.note, status: p.status, createdAt: p.createdAt,
    })),
    disputes: disputes.map(d => ({
      id: d.id, category: d.category, reason: d.reason, source: d.source,
      status: d.status, outcome: d.outcome, resolution: d.resolution, createdAt: d.createdAt,
    })),
    activity: feed,
  });
}
