/**
 * GET /api/reports/executive-overview
 *
 * A single, whole-business snapshot for a non-bookkeeper reader (owner/CEO):
 * cash, receivables, payables, inventory value, revenue/margin (MTD + YTD),
 * and everything currently awaiting someone's approval. Built entirely from
 * this org's own data (native GL via lib/accounting/financials.ts + the
 * synced invoices/bills tables) — no QBO/Xero report call, so it works
 * whether or not an integration is connected, and always reconciles to the
 * same ledger the other native reports use.
 */

import { db } from "@/db";
import { invoices, apBills, apItems, pendingApprovals, organisations } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { eq, and, inArray } from "drizzle-orm";
import { profitAndLoss, trialBalance, balanceSheet } from "@/lib/accounting/financials";
import { kindOf } from "@/lib/inventory/item-kinds";

const num = (v: any) => Number(v ?? 0);
const round = (n: number) => Math.round(n * 100) / 100;

/** Provider-agnostic open balance for a synced invoice/credit row (mirrors ar-snapshot). */
function openInvoiceBalance(inv: { qboBalance: number | null; xeroBalance: number | null; sageIntacctBalance: number | null; total: number; paid: number }): number {
  if (inv.qboBalance != null) return inv.qboBalance;
  if (inv.xeroBalance != null) return inv.xeroBalance;
  if (inv.sageIntacctBalance != null) return inv.sageIntacctBalance;
  return Math.max(0, num(inv.total) - num(inv.paid));
}

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const orgIds = [orgId!];
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + "-01";
  const yearStart = today.slice(0, 4) + "-01-01";

  const [org] = await db.select({ currency: organisations.currency }).from(organisations).where(eq(organisations.id, orgId!)).limit(1);
  const currency = org?.currency ?? "PKR";

  const [tb, plMtd, plYtd, bs] = await Promise.all([
    trialBalance(orgIds, today),
    profitAndLoss(orgIds, monthStart, today),
    profitAndLoss(orgIds, yearStart, today),
    balanceSheet(orgIds, today),
  ]);

  const sumType = (t: string) => round(tb.rows.filter(r => r.type === t).reduce((s, r) => s + r.debit - r.credit, 0));
  const cash = sumType("Bank");
  const glReceivable = sumType("Accounts Receivable");
  const glPayable = -sumType("Accounts Payable"); // AP is a credit-normal type; trialBalance nets debit-credit, so flip sign to a positive owed amount

  // ── Operational AR (synced invoices — matches the Collections dashboard) ──
  const invRows = await db.select({
    total: invoices.total, paid: invoices.paid, dueDate: invoices.dueDate, paymentStatus: invoices.paymentStatus,
    qboBalance: invoices.qboBalance, xeroBalance: invoices.xeroBalance, sageIntacctBalance: invoices.sageIntacctBalance,
  }).from(invoices).where(eq(invoices.orgId, orgId!));
  let arTotal = 0, arOverdue = 0, arOpenCount = 0;
  for (const inv of invRows) {
    if (inv.paymentStatus === "Written Off") continue;
    const bal = openInvoiceBalance(inv);
    if (Math.abs(bal) < 0.005) continue;
    arOpenCount++;
    arTotal += bal;
    if (inv.dueDate && inv.dueDate < today) arOverdue += bal;
  }

  // ── Operational AP (bills — matches the Payables dashboard) ──
  const bills = await db.select({ balance: apBills.balance, dueDate: apBills.dueDate })
    .from(apBills)
    .where(and(eq(apBills.orgId, orgId!), inArray(apBills.accountingPaymentStatus, ["Unpaid", "Partially Paid"])));
  let apTotal = 0, apOverdue = 0, apOpenCount = 0;
  for (const b of bills) {
    const bal = num(b.balance);
    if (bal <= 0) continue;
    apOpenCount++;
    apTotal += bal;
    if (b.dueDate && b.dueDate < today) apOverdue += bal;
  }

  // ── Inventory value (FIFO cost cache, same figure Stock Valuation shows) ──
  const items = await db.select({ invValue: apItems.invValue, productType: apItems.productType }).from(apItems).where(eq(apItems.orgId, orgId!));
  const inventoryValue = round(items.filter(i => kindOf(i.productType).tracked).reduce((s, i) => s + num(i.invValue), 0));

  // ── Everything awaiting a human decision right now ──
  const pending = await db.select({ amount: pendingApprovals.amount, entityType: pendingApprovals.entityType })
    .from(pendingApprovals).where(and(eq(pendingApprovals.orgId, orgId!), eq(pendingApprovals.status, "Pending")));
  const pendingAmount = round(pending.reduce((s, p) => s + num(p.amount), 0));

  return ok({
    asOf: today,
    currency,
    cash: round(cash),
    ar: { total: round(arTotal), overdue: round(arOverdue), openCount: arOpenCount, glBalance: round(glReceivable) },
    ap: { total: round(apTotal), overdue: round(apOverdue), openCount: apOpenCount, glBalance: round(glPayable) },
    inventoryValue,
    pendingApprovals: { count: pending.length, amount: pendingAmount },
    revenue: { mtd: plMtd.sections[0].total, ytd: plYtd.sections[0].total },
    grossProfit: { mtd: plMtd.grossProfit, ytd: plYtd.grossProfit },
    netProfit: { mtd: plMtd.netProfit, ytd: plYtd.netProfit },
    workingCapital: round(cash + arTotal + inventoryValue - apTotal),
    ledgerIntegrity: { trialBalanceOk: tb.balanced, balanceSheetOk: bs.balanced },
  });
}
