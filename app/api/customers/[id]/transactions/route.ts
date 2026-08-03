/**
 * Unified transactions for a customer.
 * Aggregates every AR-affecting event (invoices, credit memos, payments,
 * refund receipts) into a single chronological feed — modelled on QBO's
 * Customer → Transactions tab.
 *
 * GET /api/customers/[id]/transactions
 */

import { db } from "@/db";
import { customers, invoices, payments, refundReceipts, journalEntryArLines, deposits, estimates } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, desc } from "drizzle-orm";

export type CustomerTxn = {
  id: string;
  refId: string;          // route param for opening detail (invoice id, etc.)
  txnDate: string;        // YYYY-MM-DD
  type: "Invoice" | "Credit Memo" | "Payment" | "Refund Receipt" | "Journal Entry" | "Deposit" | "Cheque Expense" | "Estimate";
  number: string | null;  // invoice number, payment ref, etc.
  amount: number;         // signed: positive = increases AR, negative = decreases AR
  balance: number;        // open balance (invoice unpaid, CM/payment unapplied) — always >= 0
  currency: string;
  status: string;         // "Paid" | "Partially Paid" | "Unpaid" | "Voided" | "Closed" | ...
  memo: string | null;
  meta?: Record<string, any>;
};

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  // Verify customer belongs to active org
  const [cust] = await db.select({ id: customers.id, currency: customers.currency })
    .from(customers)
    .where(and(eq(customers.id, params.id), eq(customers.orgId, orgId!)))
    .limit(1);
  if (!cust) return bad("Customer not found", 404);

  // Fetch all entity types in parallel
  const [invs, pmts, refs, jes, deps, ests] = await Promise.all([
    db.select().from(invoices).where(and(eq(invoices.orgId, orgId!), eq(invoices.customerId, cust.id))),
    db.select().from(payments).where(and(eq(payments.orgId, orgId!), eq(payments.customerId, cust.id))),
    db.select().from(refundReceipts).where(and(eq(refundReceipts.orgId, orgId!), eq(refundReceipts.customerId, cust.id))),
    db.select().from(journalEntryArLines).where(and(eq(journalEntryArLines.orgId, orgId!), eq(journalEntryArLines.customerId, cust.id))),
    db.select().from(deposits).where(and(eq(deposits.orgId, orgId!), eq(deposits.customerId, cust.id))),
    db.select().from(estimates).where(and(eq(estimates.orgId, orgId!), eq(estimates.customerId, cust.id))),
  ]);

  const rows: CustomerTxn[] = [];

  // Invoices + Credit Memos (both live in invoices table, distinguished by txnType)
  for (const inv of invs) {
    const isCm = inv.txnType === "CreditMemo";
    // Open balance:
    //   - Invoice: total - paid (or qbo_balance if QBO reported it)
    //   - Credit Memo: unapplied portion = absolute value of qboBalance
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

  // Payments — balance is the unapplied portion
  for (const p of pmts) {
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

  // Journal Entries hitting AR (one row per AR-affecting line for this customer)
  for (const je of jes) {
    if ((je as any).voided) continue;
    rows.push({
      id: `je-${je.id}`,
      refId: je.id,
      txnDate: je.txnDate,
      type: "Journal Entry",
      number: je.docNumber || je.qboJournalId,
      amount: je.amount,           // signed
      balance: 0,                  // JEs are immediately posted, no open balance concept
      currency: je.currency,
      status: "Posted",
      memo: (je as any).privateNote || (je as any).description || null,
      meta: {
        accountName: je.accountName,
        qboJournalId: je.qboJournalId,
      },
    });
  }

  // Deposits and Purchases hitting AR (one row per AR-affecting line for this customer).
  // Both entity types are stored in the deposits table; txnSource distinguishes them.
  for (const d of deps) {
    const isPurchase = (d as any).txnSource === "Purchase";
    rows.push({
      id: `dep-${d.id}`,
      refId: d.id,
      txnDate: d.txnDate,
      type: isPurchase ? "Cheque Expense" : "Deposit",
      number: d.qboId,
      amount: d.amount, // signed (negative = customer credit, positive = debit)
      balance: 0,
      currency: d.currency,
      status: "Posted",
      memo: d.description || d.privateNote,
      meta: {
        accountName: d.accountName,
        qboId: d.qboId,
        txnSource: (d as any).txnSource || "Deposit",
      },
    });
  }

  // Refund Receipts — balance is 0 (already paid out)
  for (const r of refs) {
    rows.push({
      id: `ref-${r.id}`,
      refId: r.id,
      txnDate: r.txnDate,
      type: "Refund Receipt",
      number: null,
      amount: r.totalAmount,
      balance: 0,
      currency: r.currency,
      status: "Closed",
      memo: r.privateNote,
      meta: {
        method: r.paymentMethod,
        fromAccount: r.refundFromAccountName,
      },
    });
  }

  // Estimates (quotes/proposals)
  for (const e of ests) {
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
      meta: { expiryDate: e.expiryDate, projectId: e.projectId },
    });
  }

  // Chronological — newest first
  rows.sort((a, b) => (a.txnDate < b.txnDate ? 1 : a.txnDate > b.txnDate ? -1 : 0));

  return ok({
    rows,
    counts: {
      total: rows.length,
      Invoice: rows.filter(r => r.type === "Invoice").length,
      "Credit Memo": rows.filter(r => r.type === "Credit Memo").length,
      Payment: rows.filter(r => r.type === "Payment").length,
      "Refund Receipt": rows.filter(r => r.type === "Refund Receipt").length,
      "Journal Entry": rows.filter(r => r.type === "Journal Entry").length,
      "Deposit": rows.filter(r => r.type === "Deposit").length,
      "Cheque Expense": rows.filter(r => r.type === "Cheque Expense").length,
      "Estimate": rows.filter(r => r.type === "Estimate").length,
    },
  });
}
