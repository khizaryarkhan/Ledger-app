/**
 * GET /api/batch/estimates/worksheet?status=Accepted
 * Fast estimate worksheet straight from our synced `estimates` table (no QBO
 * round-trip). "Already invoiced" is hydrated separately from QBO by the client.
 */

import { db } from "@/db";
import { estimates, customers } from "@/db/schema";
import { and, eq, isNotNull, desc } from "drizzle-orm";
import { requireOrg, ok } from "@/lib/api";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const status = new URL(req.url).searchParams.get("status") || "Accepted";
  const conds = [eq(estimates.orgId, orgId!), isNotNull(estimates.qboId)];
  if (status && status !== "Any") conds.push(eq(estimates.status, status));

  const rows = await db
    .select({
      qboId: estimates.qboId,
      number: estimates.estimateNumber,
      date: estimates.estimateDate,
      currency: estimates.currency,
      total: estimates.total,
      lineItems: estimates.lineItems,
      customer: customers.name,
    })
    .from(estimates)
    .leftJoin(customers, eq(estimates.customerId, customers.id))
    .where(and(...conds))
    .orderBy(desc(estimates.estimateDate));

  const out = rows.map((r) => {
    const items = Array.isArray(r.lineItems) ? (r.lineItems as any[]) : [];
    const lines = items.map((li, index) => ({
      index,
      item: li.item ?? li.name ?? "",
      description: li.description ?? "",
      qty: li.qty ?? null,
      rate: li.unitPrice ?? li.rate ?? null,
      estAmount: Number(li.amount) || 0,
    }));
    return {
      id: r.qboId!,
      number: r.number,
      customer: r.customer ?? "",
      date: r.date,
      currency: r.currency,
      total: Number(r.total) || lines.reduce((s, l) => s + l.estAmount, 0),
      lines,
    };
  });

  return ok({ estimates: out });
}
