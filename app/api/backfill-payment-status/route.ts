/**
 * Backfill: correct invoices whose open balance is zero but whose
 * paymentStatus is still "Partially Paid"/"Unpaid" (mislabelled by an older
 * sync bug — the invoice upsert path could not emit "Paid"). Balance is the
 * source of truth: a zero open balance means the invoice is fully Paid.
 *
 * Safe to re-run. Only touches invoices (never credit memos) that have a zero
 * open balance and are not already Paid. POST /api/backfill-payment-status
 */
import { db } from "@/db";
import { invoices } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, inArray } from "drizzle-orm";

export async function POST() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  try {
    const rows = await db.select({
      id: invoices.id, total: invoices.total, paid: invoices.paid,
      qboBalance: invoices.qboBalance, xeroBalance: invoices.xeroBalance,
      paymentStatus: invoices.paymentStatus, txnType: invoices.txnType,
    }).from(invoices).where(eq(invoices.orgId, orgId!));

    // Open balance, preferring the accounting-platform balance, else total-paid.
    const openBalance = (r: typeof rows[number]) => {
      const b = r.qboBalance ?? r.xeroBalance;
      return b != null ? b : Number(r.total ?? 0) - Number(r.paid ?? 0);
    };

    const toFix = rows.filter(r =>
      r.txnType !== "CreditMemo" &&
      r.paymentStatus !== "Paid" &&
      openBalance(r) <= 0.005,
    );

    if (toFix.length > 0) {
      // neon-http has no transactions — one multi-row statement is atomic.
      await db.update(invoices)
        .set({ paymentStatus: "Paid", collectionStage: "Closed", updatedAt: new Date() })
        .where(and(eq(invoices.orgId, orgId!), inArray(invoices.id, toFix.map(r => r.id))));
    }

    return ok({ corrected: toFix.length });
  } catch (e: any) {
    console.error("Backfill payment status failed:", e);
    return bad(`Backfill failed: ${e.message}`, 500);
  }
}
