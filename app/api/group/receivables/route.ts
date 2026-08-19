/**
 * GET /api/group/receivables — consolidated open receivables across every
 * branch in the caller's active Group Account. Read-only. Authorised + scoped
 * by requireGroupScope() (group access via org_group_users / super admin), so
 * it can only ever return orgs that belong to the active group.
 */

import { db } from "@/db";
import { invoices, organisations, customers } from "@/db/schema";
import { requireGroupScope, ok } from "@/lib/api";
import { inArray, eq } from "drizzle-orm";

export const runtime = "nodejs";

export async function GET() {
  const { error, orgIds, groupId } = await requireGroupScope();
  if (error) return error;

  const empty = { groupId, orgs: [] as any[], summary: { count: 0, totalsByCurrency: {} as Record<string, number>, aging: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 } }, rows: [] as any[] };
  if (orgIds.length === 0) return ok(empty);

  const raw = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      orgId: invoices.orgId,
      orgName: organisations.name,
      customerName: customers.name,
      currency: invoices.currency,
      total: invoices.total,
      paid: invoices.paid,
      dueDate: invoices.dueDate,
      stage: invoices.collectionStage,
      status: invoices.paymentStatus,
    })
    .from(invoices)
    .innerJoin(organisations, eq(organisations.id, invoices.orgId))
    .leftJoin(customers, eq(customers.id, invoices.customerId))
    .where(inArray(invoices.orgId, orgIds));

  const now = Date.now();
  const rows = raw
    .map((r) => {
      const outstanding = Math.round(((r.total ?? 0) - (r.paid ?? 0)) * 100) / 100;
      const due = r.dueDate ? new Date(r.dueDate).getTime() : NaN;
      const days = Number.isFinite(due) ? Math.floor((now - due) / 86400000) : 0;
      return {
        id: r.id, invoiceNumber: r.invoiceNumber, orgId: r.orgId, orgName: r.orgName,
        customerName: r.customerName ?? "—", currency: r.currency ?? "EUR",
        outstanding, dueDate: r.dueDate, days, stage: r.stage, status: r.status,
      };
    })
    .filter((r) => r.outstanding > 0.005)
    .sort((a, b) => b.days - a.days);

  // Summary — totals per currency + aging buckets + per-org rollup.
  const totalsByCurrency: Record<string, number> = {};
  const aging = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
  const perOrg = new Map<string, { orgId: string; orgName: string; outstanding: number; count: number }>();

  for (const r of rows) {
    totalsByCurrency[r.currency] = (totalsByCurrency[r.currency] ?? 0) + r.outstanding;
    if (r.days <= 0) aging.current += r.outstanding;
    else if (r.days <= 30) aging.d1_30 += r.outstanding;
    else if (r.days <= 60) aging.d31_60 += r.outstanding;
    else if (r.days <= 90) aging.d61_90 += r.outstanding;
    else aging.d90plus += r.outstanding;

    const o = perOrg.get(r.orgId) ?? { orgId: r.orgId, orgName: r.orgName, outstanding: 0, count: 0 };
    o.outstanding += r.outstanding; o.count += 1;
    perOrg.set(r.orgId, o);
  }
  for (const k of Object.keys(totalsByCurrency)) totalsByCurrency[k] = Math.round(totalsByCurrency[k] * 100) / 100;

  return ok({
    groupId,
    orgs: [...perOrg.values()].sort((a, b) => b.outstanding - a.outstanding),
    summary: { count: rows.length, totalsByCurrency, aging },
    rows: rows.slice(0, 500), // cap payload; summary reflects all
    truncated: rows.length > 500,
  });
}
