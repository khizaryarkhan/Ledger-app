/**
 * AR Aging engine — point-in-time receivables calculation.
 *
 * Implements the QBO-style Report Date aging method:
 *   - Includes only transactions dated on or before reportDate
 *   - Reduces balances only by payments/credits applied on or before reportDate
 *   - Buckets by daysPastDue = reportDate - dueDate
 *
 * Inputs the engine uses (all org-scoped):
 *   - invoices (incl. credit memos via txnType='CreditMemo')
 *   - payments + payment_applications
 *   - journal_entry_ar_lines (AR write-offs, adjustments, inter-company)
 *   - deposits (AR-affecting lines — negative = customer credit on account)
 *   - refund_receipts (money paid back to customer, reduces net AR)
 *
 * Known limitations (vs. QBO's exact aging):
 *   - Direct CreditMemo → Invoice applications via QBO's LinkedTxn on the CM
 *     itself (no Payment intermediary) are not yet captured. The historical
 *     net AR may differ from QBO by the amount of such direct CM applications.
 *     The ar-reconcile card surfaces any remaining variance so users can
 *     investigate. This is the primary driver of sub-1% discrepancies.
 *   - Voided/deleted transactions: QBO returns voided invoices with Balance=0
 *     so they drop out naturally; Written Off invoices are explicitly skipped.
 */

import { db } from "@/db";
import { invoices, payments, paymentApplications, journalEntryArLines, deposits, refundReceipts } from "@/db/schema";
import { and, eq, lte, sql } from "drizzle-orm";

export type AgingBucket = "Current" | "1-30" | "31-60" | "61-90" | "90+" | "91+";
export const BUCKETS: AgingBucket[] = ["Current", "1-30", "31-60", "61-90", "90+"];

export type AppliedTxn = {
  paymentId: string;
  paymentQboId: string | null;
  paymentDate: string;
  amount: number;
};

export type DetailRow = {
  customerId: string;
  customerQboId: string | null;
  projectId: string | null;
  txnType: "Invoice" | "Credit Memo" | "Journal Entry";
  txnNumber: string;
  txnId: string;            // our internal ID
  qboId: string | null;
  txnDate: string;
  dueDate: string;
  originalAmount: number;   // gross face value (signed: invoices positive, CMs/JE credits negative)
  applied: AppliedTxn[];    // payments/credits applied on or before reportDate
  totalApplied: number;     // sum of amountApplied across applied[]
  openBalance: number;      // remaining open as of reportDate (signed)
  daysPastDue: number;      // reportDate − dueDate; <=0 means current
  bucket: AgingBucket;
  currency: string;
  flags: string[];          // e.g., 'missing-due-date', 'unapplied-credit', 'negative-balance', 'journal-entry'
};

export type SummaryRow = {
  customerId: string;
  customerQboId: string | null;
  buckets: Record<AgingBucket, number>;
  total: number;
};

export type AgingResult = {
  asOf: string;
  detail: DetailRow[];
  summary: SummaryRow[];
  grandTotals: Record<AgingBucket, number> & { total: number };
  /** Per-customer unapplied payment totals (keyed by our customerId).
   *  These are payments received but not yet applied to any invoice.
   *  Consumers (e.g. ar-snapshot) add these as synthetic credit rows so
   *  every downstream report agrees with the main AR Aging grand total. */
  unappliedByCustomer: Record<string, number>;
  /** Per-customer deposit credit totals (keyed by our customerId).
   *  Negative QBO Deposit AR lines — stored separately so ar-snapshot can
   *  net them against open invoice rows (matching QBO's applied-deposit
   *  behaviour) rather than injecting them as separate synthetic rows. */
  depositCreditsByCustomer: Record<string, number>;
  flags: {
    missingDueDate: number;
    negativeCustomerBalances: string[]; // customerIds with overall negative AR
    unappliedCredits: number;            // count of CMs with open negative balance
    voidedSuspected: number;             // invoices with Balance=0 and Total=0 (likely voided)
  };
  meta: {
    invoiceCount: number;
    creditMemoCount: number;
    paymentCount: number;
    applicationCount: number;
  };
};

function bucketFor(daysPastDue: number): AgingBucket {
  if (daysPastDue <= 0)   return "Current";
  if (daysPastDue <= 30)  return "1-30";
  if (daysPastDue <= 60)  return "31-60";
  if (daysPastDue <= 90)  return "61-90";
  return "90+";
}

function daysBetween(later: string, earlier: string): number {
  const a = new Date(later  + "T00:00:00Z").getTime();
  const b = new Date(earlier + "T00:00:00Z").getTime();
  return Math.floor((a - b) / 86400000);
}

function emptyBuckets(): Record<AgingBucket, number> {
  return { "Current": 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0, "91+": 0 };
}

/**
 * Compute AR Aging as of a specific date for an org.
 *
 * @param includeClosed - when true, also returns transactions whose computed
 *   open balance is 0 (paid invoices, fully-applied CMs, applied payments).
 *   Useful for diagnosing why a customer's total differs from QBO.
 *
 * Methodology:
 *   - For TODAY: trusts the invoice's sync snapshot (qbo_balance / paid)
 *     as the source of truth. Captures closures we don't have event data for
 *     (direct CM-to-Invoice applications, write-offs, refund receipts, etc.).
 *   - For HISTORICAL dates: walks payment_applications to reconstruct the
 *     state at that date. Best accuracy where we have event data.
 */
export async function computeArAging(orgId: string, asOf: string, includeClosed = false): Promise<AgingResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new Error("asOf must be YYYY-MM-DD");
  }
  const today = new Date().toISOString().slice(0, 10);
  const isToday = asOf >= today;

  // 1. Load all invoices + credit memos dated on or before asOf
  const allInvs = await db.select().from(invoices)
    .where(and(eq(invoices.orgId, orgId), lte(invoices.invoiceDate, asOf)));

  // 2. Load all payments dated on or before asOf
  const validPayments = await db
    .select({
      id: payments.id,
      qboId: payments.qboId,
      txnDate: payments.txnDate,
      customerId: payments.customerId,
      unappliedAmount: payments.unappliedAmount,
    })
    .from(payments)
    .where(and(eq(payments.orgId, orgId), lte(payments.txnDate, asOf)));
  const paymentById = new Map(validPayments.map(p => [p.id, p]));

  // 3. Load applications and group by invoiceId, filtered to payments dated <= asOf
  const allApps = await db.select().from(paymentApplications)
    .where(eq(paymentApplications.orgId, orgId));

  const appsByInvoiceId = new Map<string, AppliedTxn[]>();
  for (const app of allApps) {
    if (!app.invoiceId) continue;
    const pay = paymentById.get(app.paymentId);
    if (!pay) continue; // payment is after asOf
    const arr = appsByInvoiceId.get(app.invoiceId) || [];
    arr.push({
      paymentId: pay.id,
      paymentQboId: pay.qboId,
      paymentDate: pay.txnDate,
      amount: app.amountApplied,
    });
    appsByInvoiceId.set(app.invoiceId, arr);
  }

  // 3b. Load every Journal Entry AR line dated on or before asOf (both today
  // and historical). Earlier versions of this engine skipped JEs for today on
  // the (wrong) assumption that the invoice snapshot already accounted for
  // their effect — it doesn't. The JE is a separate AR-posting transaction
  // and must be summed in its own right.
  const jeArRows = await db.select().from(journalEntryArLines)
    .where(and(
      eq(journalEntryArLines.orgId, orgId),
      lte(journalEntryArLines.txnDate, asOf),
      eq(journalEntryArLines.voided, false),
    ));

  // 3c. Load payment_applications that target Journal Entries.
  //
  // Per Intuit docs, a Payment.Line.LinkedTxn with TxnType=JournalEntry
  // identifies a JE application; Payment.Line.Amount is the partial amount
  // applied to that JE. The optional Payment.Line.LinkedTxn.TxnLineId
  // identifies which specific AR line of the JE the payment hit — important
  // because one JE header can carry multiple AR lines for different
  // customers and they age independently.
  //
  // We aggregate applied amounts two ways so the JE-line netting can pick
  // whichever is most precise:
  //   - keyed by (qboJournalId, qboLineId) when TxnLineId is present
  //   - keyed by qboJournalId when TxnLineId is absent (header-level fallback)
  const jeApps = await db
    .select({
      targetQboId:   paymentApplications.targetQboId,
      targetLineId:  paymentApplications.targetLineId,
      amountApplied: paymentApplications.amountApplied,
      paymentId:     paymentApplications.paymentId,
    })
    .from(paymentApplications)
    .where(and(
      eq(paymentApplications.orgId, orgId),
      eq(paymentApplications.targetType, "JournalEntry"),
    ));
  const appliedByJeLine   = new Map<string, number>(); // key = `${qboJournalId}|${qboLineId}`
  const appliedByJeHeader = new Map<string, number>(); // key = qboJournalId (fallback)
  for (const a of jeApps) {
    // Skip applications whose underlying payment is dated after asOf — they
    // shouldn't reduce the JE's open amount as of a historical report date.
    const pay = paymentById.get(a.paymentId);
    if (!pay) continue;
    if (!a.targetQboId) continue;
    if (a.targetLineId) {
      const k = `${a.targetQboId}|${a.targetLineId}`;
      appliedByJeLine.set(k, (appliedByJeLine.get(k) ?? 0) + (a.amountApplied ?? 0));
    } else {
      appliedByJeHeader.set(
        a.targetQboId,
        (appliedByJeHeader.get(a.targetQboId) ?? 0) + (a.amountApplied ?? 0),
      );
    }
  }
  // For the header-fallback case (TxnLineId absent), we'd over-apply if a
  // JE has multiple AR lines, so we distribute the header total across the
  // JE's AR lines proportional to their |amount|. This is computed lazily
  // inside the JE detail loop when needed.

  // 3d. Load AR-affecting Deposits dated on or before asOf. A QBO Deposit
  // line that posts to AR for a specific customer is a one-shot AR change
  // (typically negative — a customer credit / overpayment sitting on
  // account). No application-netting concept — each deposit row stands
  // alone the way a JE line does.
  const depositRows = await db.select().from(deposits)
    .where(and(
      eq(deposits.orgId, orgId),
      lte(deposits.txnDate, asOf),
    ));

  // 3e. Native settlement, from the links graph — NOT payment_applications.
  //
  // A native invoice (one posted through our own GL: journal_entry_id set, no
  // provider id) is settled by transaction_links, not payment_applications,
  // which is only ever written by the QBO sync. Without this, a partially-paid
  // native invoice's totalApplied came out 0 for every historical asOf, so it
  // reported its FULL total as open — wrong on any back-dated aging run. The
  // settling document's own entry_date is the date the money moved, so we
  // date-filter on that (context_entry_id is the payment/credit that created
  // the link; from_id is the same document, used as a fallback).
  const nativeLinksRes: any = await db.execute(sql`
    select tl.to_id as entry_id,
           coalesce(tl.context_entry_id, tl.from_id) as settle_id,
           tl.amount as amount,
           se.entry_date as settle_date
      from transaction_links tl
      join journal_entries se on se.id = coalesce(tl.context_entry_id, tl.from_id)
     where tl.org_id = ${orgId}
       and tl.relation in ('payment','credit')
       and se.entry_date <= ${asOf}
  `);
  const nativeLinks: any[] = nativeLinksRes?.rows ?? nativeLinksRes ?? [];

  const nativeAppliedByEntryId = new Map<string, AppliedTxn[]>();
  for (const r of nativeLinks as { entry_id: string; settle_id: string; amount: string | number; settle_date: string }[]) {
    if (!r.entry_id) continue;
    const arr = nativeAppliedByEntryId.get(r.entry_id) || [];
    arr.push({ paymentId: r.settle_id, paymentQboId: null, paymentDate: r.settle_date, amount: Number(r.amount) || 0 });
    nativeAppliedByEntryId.set(r.entry_id, arr);
  }

  // 4. Build detail rows
  const detail: DetailRow[] = [];
  let missingDueDate = 0, voidedSuspected = 0, unappliedCredits = 0;

  for (const inv of allInvs) {
    const isCm = inv.txnType === "CreditMemo";

    // Skip voided and written-off invoices.
    // • QBO returns voided invoices with Balance=0 and Total=0 — drop them.
    // • Written Off status means the balance was cleared via a write-off JE;
    //   the JE is captured separately as a journalEntryArLine so it already
    //   reduces the customer's AR. Keeping the invoice would double-count.
    if (inv.paymentStatus === "Written Off") continue;
    if (inv.total === 0 && (inv.qboBalance ?? 0) === 0 && !isCm) {
      voidedSuspected++;
      continue;
    }

    // Compute open balance:
    //   Today:      qboBalance (QBO snapshot) — captures write-offs, direct CM
    //               applications, and refund receipts that have no application rows.
    //   Historical: paidAt shortcut for fully-paid invoices (more reliable than
    //               payment_applications completeness); applications-based for
    //               partial/open invoices. CMs reconstructed from payment_applications
    //               if available, otherwise fall back to current qboBalance.
    let openBalance: number;
    let totalApplied = 0;
    const applied: AppliedTxn[] = [];

    // A native invoice is settled via the links graph; a provider-mirrored one
    // via payment_applications. journal_entry_id + absence of a provider id is
    // the trustworthy discriminator — `invoices.source` is not (it defaults to
    // 'native' even on synced rows). See lib/accounting/reconcile.ts.
    const isNative = inv.journalEntryId != null && inv.qboId == null && inv.xeroId == null && (inv as any).sageIntacctId == null;
    const settleApps = isNative
      ? (inv.journalEntryId ? nativeAppliedByEntryId.get(inv.journalEntryId) || [] : [])
      : (appsByInvoiceId.get(inv.id) || []);

    if (isCm) {
      // CM's stored qboBalance is the CURRENT unapplied amount (negative).
      // For today: trust the QBO snapshot directly.
      // For historical: reconstruct using payment_applications dated <= asOf,
      // falling back to qboBalance if no applications exist for this CM.
      if (isToday) {
        openBalance = inv.qboBalance ?? inv.total; // negative
      } else {
        const cmApps = settleApps;
        applied.push(...cmApps);
        totalApplied = cmApps.reduce((s, a) => s + a.amount, 0);
        // CM total is negative; applications reduce the unapplied credit toward 0.
        // If no application records exist, fall back to current qboBalance.
        openBalance = cmApps.length > 0
          ? Math.min(0, inv.total + totalApplied)
          : (inv.qboBalance ?? inv.total);
      }
      if (openBalance < -0.005) unappliedCredits++;
    } else {
      const apps = settleApps;
      applied.push(...apps);
      totalApplied = apps.reduce((s, a) => s + a.amount, 0);

      if (isToday) {
        // For today's view use qboBalance directly — it is the QBO source of
        // truth and captures closures not yet in payment_applications
        // (direct CM applications, refund receipts, write-offs, etc.).
        // NOTE: collectionStage === "Closed" is intentionally NOT used here.
        // collectionStage is a user-defined collection tracking field; it does
        // not mean the invoice is paid in QBO. Using it would cause today's
        // snapshot to diverge from historical snapshots (which correctly show
        // these invoices as open because they have no paidAt / payment_applications).
        const snapshotOpen = inv.qboBalance ?? Math.max(0, inv.total - (inv.paid || 0));
        const isSnapshotClosed = (snapshotOpen < 0.005) ||
                                 inv.paymentStatus === "Paid";
        openBalance = isSnapshotClosed ? 0 : snapshotOpen;
      } else {
        // Historical reconstruction.
        // paidAt is the authoritative payment receipt date from QBO. If it falls
        // on or before asOf the invoice was fully settled by the report date.
        // This is more reliable than payment_applications completeness.
        //
        // NOTE: collectionStage === "Closed" is deliberately NOT used here.
        // collectionStage is a user-controlled collection-tracking field that
        // can be set independently of actual QBO payment state. Using it would
        // cause historical AR snapshots to diverge from the today snapshot for
        // invoices where the user closed the stage before (or without) payment.
        const fullyPaidByDate =
          inv.paymentStatus === "Paid" &&
          inv.paidAt != null &&
          inv.paidAt <= asOf;

        if (fullyPaidByDate) {
          openBalance = 0;
        } else if (
          inv.paymentStatus === "Paid" &&
          inv.paidAt == null &&
          totalApplied < 0.005
        ) {
          // Invoice is definitively closed in QBO (paymentStatus=Paid) but we have
          // no payment date (paidAt=null) and no application records. This happens
          // for invoices settled via credit memo or journal entry where no cash
          // Payment transaction exists. We cannot determine the historical close
          // date until the next QBO sync (which will populate paidAt via LinkedTxn).
          // Exclude from ALL historical dates to avoid ghost AR — the next sync will
          // backfill paidAt and restore accurate point-in-time reporting.
          openBalance = 0;
        } else {
          // Partially paid or unpaid: reconstruct from payment_applications.
          openBalance = Math.max(0, inv.total - totalApplied);
        }
      }
    }

    // Exclude fully-closed items from the detail (open balance = 0)
    // unless caller asked for them (diagnostic mode).
    if (!includeClosed && Math.abs(openBalance) < 0.005) continue;

    // Due date and aging
    const effectiveDueDate = inv.dueDate || inv.invoiceDate;
    const flags: string[] = [];
    if (!inv.dueDate) { flags.push("missing-due-date"); missingDueDate++; }
    if (isCm && openBalance < 0) flags.push("unapplied-credit");

    const dpd = daysBetween(asOf, effectiveDueDate);
    const bucket = bucketFor(dpd);

    detail.push({
      customerId: inv.customerId,
      customerQboId: inv.qboCustomerId,
      projectId: inv.projectId,
      txnType: isCm ? "Credit Memo" : "Invoice",
      txnNumber: inv.invoiceNumber,
      txnId: inv.id,
      qboId: inv.qboId,
      txnDate: inv.invoiceDate,
      dueDate: effectiveDueDate,
      originalAmount: inv.total,
      applied,
      totalApplied,
      openBalance,
      daysPastDue: dpd,
      bucket,
      currency: inv.currency,
      flags,
    });
  }

  // 4b. Add Journal Entry AR lines as their own detail rows, NET of any
  // applications captured during sync.
  //
  // Critical detail: the netting is PER JE LINE, not per JE header. A JE can
  // post multiple AR lines (e.g. to different customers) under one header,
  // and a payment that applies to one of them must not reduce the others.
  //
  // Matching priority:
  //   1. If we have a per-line application (TxnLineId present), use it directly.
  //   2. Otherwise, distribute the header-level applied total across all
  //      AR lines under that JE proportional to their |amount|. This is
  //      the conservative fallback for QBO payloads that omit TxnLineId.
  //   3. If neither, the JE is fully open.
  //
  // Examples:
  //   JE -€1,000,000 line A, €400,000 applied to line A → open = -€600,000
  //   JE -€1,000,000 line A, fully applied              → open = €0 (dropped)
  //   JE header +€500,000 across 2 lines, no apps       → each line shows full

  // Pre-compute, for each JE header that has header-level applications, the
  // proportional allocation across that JE's AR lines.
  type AllocRow = { id: string; abs: number };
  const headerAllocations = new Map<string, Map<string, number>>(); // qboJournalId → Map(jeId → allocatedAbs)
  if (appliedByJeHeader.size > 0) {
    const linesByHeader = new Map<string, AllocRow[]>();
    for (const je of jeArRows) {
      const a = Math.abs(je.amount ?? 0);
      if (a < 0.005) continue;
      const arr = linesByHeader.get(je.qboJournalId) ?? [];
      arr.push({ id: je.id, abs: a });
      linesByHeader.set(je.qboJournalId, arr);
    }
    for (const [header, totalApplied] of appliedByJeHeader.entries()) {
      const lines = linesByHeader.get(header);
      if (!lines || lines.length === 0) continue;
      const sumAbs = lines.reduce((s, l) => s + l.abs, 0);
      if (sumAbs < 0.005) continue;
      const alloc = new Map<string, number>();
      let remaining = totalApplied;
      // Allocate proportionally, give any rounding residue to the last line.
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        let share: number;
        if (i === lines.length - 1) share = remaining;
        else share = (l.abs / sumAbs) * totalApplied;
        alloc.set(l.id, share);
        remaining -= share;
      }
      headerAllocations.set(header, alloc);
    }
  }

  for (const je of jeArRows) {
    if (!je.customerId) continue;
    if (Math.abs(je.amount) < 0.005) continue;

    // Pick the line-level application if QBO gave us TxnLineId for this JE
    // line; otherwise fall back to this line's share of the header total.
    let appliedAmount = 0;
    if (je.qboLineId) {
      appliedAmount = appliedByJeLine.get(`${je.qboJournalId}|${je.qboLineId}`) ?? 0;
    }
    if (appliedAmount === 0) {
      appliedAmount = headerAllocations.get(je.qboJournalId)?.get(je.id) ?? 0;
    }

    const openMagnitude = Math.max(0, Math.abs(je.amount) - appliedAmount);
    const jeOpenBalance = Math.sign(je.amount) * openMagnitude;
    if (!includeClosed && Math.abs(jeOpenBalance) < 0.005) continue;

    const dpd = daysBetween(asOf, je.txnDate);
    const bucket = bucketFor(dpd);
    const flags = ["journal-entry"];
    if (appliedAmount > 0.005 && openMagnitude > 0.005) flags.push("partially-applied");

    detail.push({
      customerId: je.customerId,
      customerQboId: je.qboCustomerId,
      projectId: null,
      txnType: "Journal Entry",
      txnNumber: je.docNumber || `JE-${je.qboJournalId}`,
      txnId: je.id,
      qboId: je.qboJournalId,
      txnDate: je.txnDate,
      dueDate: je.txnDate, // JEs have no DueDate — age from TxnDate
      originalAmount: je.amount,
      applied: [],
      totalApplied: appliedAmount,
      openBalance: jeOpenBalance,
      daysPastDue: dpd,
      bucket,
      currency: je.currency,
      flags,
    });
  }

  // 4c. Deposit AR lines and Purchase (Cheque Expense) AR lines.
  //
  // QBO Deposit lines that post to AR are typically customer credits
  // (negative amount — customer overpayment sitting on account). QBO's own
  // Aged Receivable Detail report does NOT show these as separate line items;
  // it folds them into the customer's net balance. To match QBO's display:
  //
  //   • Negative deposits (AR credits) → accumulated per customer and
  //     deducted from the customer's summary total in step 5b, exactly like
  //     unapplied payments. No separate detail row.
  //
  //   • Positive deposits (Purchase / Cheque Expense AR debits) → treated as
  //     invoice-like debits and added as detail rows so they age correctly.
  //
  // This prevents the "showing twice" symptom where a customer appears once
  // for their open invoice and again for a deposit credit that nets it out.
  const depositCreditsByCustomer = new Map<string, number>(); // customerId → total credit

  for (const d of depositRows) {
    if (!d.customerId) continue;
    if (Math.abs(d.amount) < 0.005) continue;

    if (d.amount < 0) {
      // AR credit (QBO Deposit) — net into the customer's summary total,
      // not as a separate detail row. Matches QBO Aged Receivable Detail.
      depositCreditsByCustomer.set(
        d.customerId,
        (depositCreditsByCustomer.get(d.customerId) ?? 0) + Math.abs(d.amount),
      );
    } else {
      // AR debit (Purchase / Cheque Expense) — add as a detail row so it
      // ages and shows alongside the customer's open invoices.
      const dpd    = daysBetween(asOf, d.txnDate);
      const bucket = bucketFor(dpd);
      detail.push({
        customerId:    d.customerId,
        customerQboId: d.qboCustomerId,
        projectId:     null,
        txnType:       "Journal Entry",
        txnNumber:     d.qboId,
        txnId:         d.id,
        qboId:         d.qboId,
        txnDate:       d.txnDate,
        dueDate:       d.txnDate,
        originalAmount: d.amount,
        applied:       [],
        totalApplied:  0,
        openBalance:   d.amount,
        daysPastDue:   dpd,
        bucket,
        currency:      d.currency,
        flags:         ["purchase-ar"],
      });
    }
  }

  // 4d. Refund Receipts — money paid OUT to a customer. In QBO this reduces
  // the customer's AR (or their unapplied credits). We deduct refund totals
  // from the customer's summary the same way we deduct unapplied payments —
  // bucket waterfall, Current first. This prevents ghost AR on customers who
  // received a refund without a specific invoice being voided.
  const refundRows = await db.select({
    customerId: refundReceipts.customerId,
    totalAmount: refundReceipts.totalAmount,
  }).from(refundReceipts)
    .where(and(
      eq(refundReceipts.orgId, orgId),
      lte(refundReceipts.txnDate, asOf),
    ));

  const refundsByCustomer = new Map<string, number>();
  for (const r of refundRows) {
    if (!r.customerId || (r.totalAmount ?? 0) < 0.005) continue;
    refundsByCustomer.set(
      r.customerId,
      (refundsByCustomer.get(r.customerId) ?? 0) + (r.totalAmount ?? 0),
    );
  }

  // 5. Build per-customer summary
  const byCustomer = new Map<string, SummaryRow>();
  for (const row of detail) {
    let s = byCustomer.get(row.customerId);
    if (!s) {
      s = {
        customerId: row.customerId,
        customerQboId: row.customerQboId,
        buckets: emptyBuckets(),
        total: 0,
      };
      byCustomer.set(row.customerId, s);
    }
    s.buckets[row.bucket] += row.openBalance;
    s.total += row.openBalance;
  }
  const summary = [...byCustomer.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

  // 5b. Deduct unapplied payment amounts per customer.
  //
  // Matches PBI methodology: payments received but not yet applied to any
  // invoice reduce the customer's net AR balance. QBO records these as
  // UnappliedAmt on the Payment. We deduct them from the Current bucket
  // first, then spill into older buckets — the customer overpaid or paid
  // early and the credit sits on account.
  const unappliedByCustomer = new Map<string, number>();
  for (const p of validPayments) {
    if (!p.customerId || (p.unappliedAmount ?? 0) < 0.005) continue;
    unappliedByCustomer.set(
      p.customerId,
      (unappliedByCustomer.get(p.customerId) ?? 0) + (p.unappliedAmount ?? 0),
    );
  }
  for (const s of summary) {
    let remaining = unappliedByCustomer.get(s.customerId) ?? 0;
    if (remaining < 0.005) continue;
    // Apply credit to Current bucket first, then 1-30, 31-60, 61-90, 91+
    for (const b of BUCKETS) {
      if (remaining < 0.005) break;
      const reduce = Math.min(remaining, Math.max(0, s.buckets[b]));
      s.buckets[b] -= reduce;
      s.total      -= reduce;
      remaining    -= reduce;
    }
  }

  // Deduct deposit credits (QBO Deposit lines that post a customer credit to
  // AR). These are accumulated in depositCreditsByCustomer above and applied
  // here — same bucket-waterfall logic as unapplied payments — so the grand
  // total matches QBO without deposit credits appearing as separate rows.
  for (const s of summary) {
    let remaining = depositCreditsByCustomer.get(s.customerId) ?? 0;
    if (remaining < 0.005) continue;
    for (const b of BUCKETS) {
      if (remaining < 0.005) break;
      const reduce = Math.min(remaining, Math.max(0, s.buckets[b]));
      s.buckets[b] -= reduce;
      s.total      -= reduce;
      remaining    -= reduce;
    }
  }

  // Deduct Refund Receipts — money paid back to the customer reduces their AR.
  // Applied with the same bucket-waterfall (Current first) so the summary
  // accurately reflects the net AR after refunds.
  for (const s of summary) {
    let remaining = refundsByCustomer.get(s.customerId) ?? 0;
    if (remaining < 0.005) continue;
    for (const b of BUCKETS) {
      if (remaining < 0.005) break;
      const reduce = Math.min(remaining, Math.max(0, s.buckets[b]));
      s.buckets[b] -= reduce;
      s.total      -= reduce;
      remaining    -= reduce;
    }
  }

  // 6. Grand totals
  const grandTotals = { ...emptyBuckets(), total: 0 };
  for (const s of summary) {
    for (const b of BUCKETS) grandTotals[b] += s.buckets[b];
    grandTotals.total += s.total;
  }

  // 7. Flag customers with net negative AR (more credits than invoices)
  const negativeCustomerBalances = summary
    .filter(s => s.total < -0.005)
    .map(s => s.customerId);

  return {
    asOf,
    detail,
    summary,
    grandTotals,
    unappliedByCustomer: Object.fromEntries(unappliedByCustomer),
    depositCreditsByCustomer: Object.fromEntries(depositCreditsByCustomer),
    flags: {
      missingDueDate,
      negativeCustomerBalances,
      unappliedCredits,
      voidedSuspected,
    },
    meta: {
      invoiceCount: detail.filter(r => r.txnType === "Invoice").length,
      creditMemoCount: detail.filter(r => r.txnType === "Credit Memo").length,
      paymentCount: validPayments.length,
      applicationCount: allApps.length,
      journalEntryCount: detail.filter(r => r.txnType === "Journal Entry").length,
    } as any,
  };
}
