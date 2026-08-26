/**
 * GET /api/mobile/receivables/escalations
 *   → open invoices escalated TO the signed-in user.
 *
 * Deliberately not rep-scoped: escalation is an explicit hand-off to a named
 * person, so the boundary is "escalated to me", matched on user id or email
 * (the same pair the web portal and the no-login owner portal use, since an
 * escalation can name someone who has no user account yet).
 */

import { db } from "@/db";
import { invoices, customers, projects } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { and, eq, or, sql } from "drizzle-orm";
import { openBalance, daysOverdue, isOpenInvoice } from "@/lib/receivables/rep-scope";

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function GET() {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  const userId = (session!.user as any)?.id ?? null;
  const email = String((session!.user as any)?.email ?? "").toLowerCase();

  const rows = await db.select({ inv: invoices, custName: customers.name, projName: projects.name })
    .from(invoices)
    .leftJoin(customers, eq(customers.id, invoices.customerId))
    .leftJoin(projects, eq(projects.id, invoices.projectId))
    .where(and(
      eq(invoices.orgId, orgId!),
      eq(invoices.collectionStage, "Escalated"),
      or(
        userId ? eq(invoices.escalatedToUserId, userId) : sql`false`,
        email ? sql`lower(${invoices.escalatedToEmail}) = ${email}` : sql`false`,
      ),
    ));

  const open = rows.filter(r => isOpenInvoice(r.inv) && openBalance(r.inv) > 0);

  return ok({
    total: r2(open.reduce((s, r) => s + openBalance(r.inv), 0)),
    count: open.length,
    invoices: open.map(({ inv, custName, projName }) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      customerName: custName ?? "—",
      projectName: projName ?? null,
      currency: inv.currency,
      balance: r2(openBalance(inv)),
      dueDate: inv.dueDate,
      daysOverdue: daysOverdue(inv.dueDate),
      // escalation_type already stores the label from lib/escalation-types.
      escalationType: inv.escalationType ?? null,
      escalatedToName: inv.escalatedToName ?? null,
      escalatedAt: inv.escalatedAt ?? null,
    })).sort((a, b) => b.daysOverdue - a.daysOverdue),
  });
}
