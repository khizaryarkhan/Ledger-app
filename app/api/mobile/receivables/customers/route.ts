/**
 * GET /api/mobile/receivables/customers
 *   → the rep's customers, rolled up: open balance, overdue, invoice count.
 *
 * Derived from the invoices the caller can see rather than from customer.repId,
 * which is the same rule the web portal uses: a customer surfaces because they
 * have visible invoices, so customer-level, project-level and mixed
 * assignment setups all behave correctly.
 */

import { db } from "@/db";
import { invoices, customers } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { and, eq } from "drizzle-orm";
import {
  resolveRepScope, invoiceScopeFilter, openBalance, isOpenInvoice, daysOverdue,
} from "@/lib/receivables/rep-scope";

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function GET() {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  const scope = await resolveRepScope(orgId!, (session!.user as any)?.id ?? null);
  const scopeFilter = await invoiceScopeFilter(orgId!, scope);

  const rows = await db.select({ inv: invoices, custName: customers.name, custCode: customers.code })
    .from(invoices)
    .leftJoin(customers, eq(customers.id, invoices.customerId))
    .where(scopeFilter ? and(eq(invoices.orgId, orgId!), scopeFilter) : eq(invoices.orgId, orgId!));

  type Agg = {
    id: string; name: string; code: string | null; currency: string;
    balance: number; overdue: number; openCount: number; oldestDays: number;
  };
  const byCustomer = new Map<string, Agg>();

  for (const { inv, custName, custCode } of rows) {
    if (!isOpenInvoice(inv)) continue;
    const bal = openBalance(inv);
    if (bal <= 0) continue;
    const d = daysOverdue(inv.dueDate);
    const cur = byCustomer.get(inv.customerId) ?? {
      id: inv.customerId, name: custName ?? "—", code: custCode ?? null,
      currency: inv.currency, balance: 0, overdue: 0, openCount: 0, oldestDays: 0,
    };
    cur.balance += bal;
    if (d > 0) cur.overdue += bal;
    cur.openCount += 1;
    cur.oldestDays = Math.max(cur.oldestDays, d);
    byCustomer.set(inv.customerId, cur);
  }

  const list = [...byCustomer.values()]
    .map(c => ({ ...c, balance: r2(c.balance), overdue: r2(c.overdue) }))
    .sort((a, b) => b.overdue - a.overdue || b.balance - a.balance);

  return ok({ count: list.length, customers: list });
}
