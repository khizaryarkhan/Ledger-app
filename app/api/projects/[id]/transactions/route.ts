/**
 * Unified transactions for a project.
 * Same shape as the customer endpoint, but scoped to a single project.
 *
 * - Invoices/CMs: filtered by projects.id directly (invoices.projectId)
 * - Payments: included if any of their applications target an invoice in this project
 * - Refund receipts: not linked to projects in QBO — omitted at project scope
 *
 * GET /api/projects/[id]/transactions
 */

import { db } from "@/db";
import { projects, invoices, payments, paymentApplications, estimates } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, inArray } from "drizzle-orm";
import type { CustomerTxn } from "@/app/api/customers/[id]/transactions/route";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [proj] = await db.select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, params.id), eq(projects.orgId, orgId!)))
    .limit(1);
  if (!proj) return bad("Project not found", 404);

  // Invoices + CMs for this project
  const invs = await db.select().from(invoices)
    .where(and(eq(invoices.orgId, orgId!), eq(invoices.projectId, proj.id)));

  // Find payments that applied to any of these invoices
  const invoiceIds = invs.map(i => i.id);
  let projectPayments: typeof payments.$inferSelect[] = [];
  if (invoiceIds.length > 0) {
    const appRows = await db
      .select({ paymentId: paymentApplications.paymentId })
      .from(paymentApplications)
      .where(and(
        eq(paymentApplications.orgId, orgId!),
        inArray(paymentApplications.invoiceId, invoiceIds),
      ));
    const paymentIds = [...new Set(appRows.map(a => a.paymentId))];
    if (paymentIds.length > 0) {
      projectPayments = await db
        .select()
        .from(payments)
        .where(and(eq(payments.orgId, orgId!), inArray(payments.id, paymentIds)));
    }
  }

  const rows: CustomerTxn[] = [];

  for (const inv of invs) {
    const isCm = inv.txnType === "CreditMemo";
    const balance = isCm
      ? Math.abs(inv.qboBalance ?? inv.total)
      : Math.max(0, inv.qboBalance ?? (inv.total - (inv.paid || 0)));
    rows.push({
      id: `inv-${inv.id}`,
      refId: inv.id,
      txnDate: inv.invoiceDate,
      type: isCm ? "Credit Memo" : "Invoice",
      number: inv.invoiceNumber,
      amount: isCm ? -Math.abs(inv.total) : inv.total,
      balance,
      currency: inv.currency,
      // Credit memos: mirror QBO terminology — "Applied" when balance=0, "Unpaid" otherwise
      // Invoices: use paymentStatus / collectionStage as normal
      status: isCm
            ? (inv.paymentStatus === "Paid" ? "Applied" : "Unpaid")
            : inv.paymentStatus === "Paid" ? "Paid"
            : inv.collectionStage === "Closed" ? "Closed"
            : inv.paymentStatus,
      memo: inv.notes,
      meta: {
        dueDate: inv.dueDate,
        paid: inv.paid,
        collectionStage: inv.collectionStage,
      },
    });
  }

  for (const p of projectPayments) {
    rows.push({
      id: `pay-${p.id}`,
      refId: p.id,
      txnDate: p.txnDate,
      type: "Payment",
      number: p.paymentRef,
      amount: -p.totalAmount,
      balance: p.unappliedAmount || 0,
      currency: p.currency,
      status: p.unappliedAmount > 0.005 ? "Partially Applied" : "Applied",
      memo: p.privateNote,
      meta: {
        method: p.paymentMethod,
        depositAccount: p.depositAccountName,
      },
    });
  }

  // Estimates scoped to this project
  const projEstimates = await db.select().from(estimates)
    .where(and(eq(estimates.orgId, orgId!), eq(estimates.projectId, proj.id)));
  for (const e of projEstimates) {
    rows.push({
      id: `est-${e.id}`,
      refId: e.id,
      txnDate: e.estimateDate,
      type: "Estimate",
      number: e.estimateNumber,
      amount: e.total,
      balance: 0,
      currency: e.currency,
      status: e.status,
      memo: e.notes,
      meta: { expiryDate: e.expiryDate },
    });
  }

  rows.sort((a, b) => (a.txnDate < b.txnDate ? 1 : a.txnDate > b.txnDate ? -1 : 0));

  return ok({
    rows,
    counts: {
      total: rows.length,
      Invoice: rows.filter(r => r.type === "Invoice").length,
      "Credit Memo": rows.filter(r => r.type === "Credit Memo").length,
      Payment: rows.filter(r => r.type === "Payment").length,
      "Refund Receipt": 0,
      "Estimate": rows.filter(r => r.type === "Estimate").length,
    },
  });
}
