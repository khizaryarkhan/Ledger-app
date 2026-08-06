/**
 * GET /api/batch/estimates/worksheet?status=Accepted
 * Fast estimate worksheet straight from our synced `estimates` table (no QBO
 * round-trip). "Already invoiced" is hydrated separately from QBO by the client.
 */

import { db } from "@/db";
import { estimates, customers, projects } from "@/db/schema";
import { and, eq, isNotNull, desc } from "drizzle-orm";
import { requireOrg, ok } from "@/lib/api";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  // Return ALL estimates (that have a QBO id) with their status; the UI does
  // PBI-style multi-select filtering + counts client-side.
  const rows = await db
    .select({
      qboId: estimates.qboId,
      number: estimates.estimateNumber,
      date: estimates.estimateDate,
      currency: estimates.currency,
      // Ex-tax subtotal — must match the ex-tax line amounts and the ex-tax
      // invoiced amounts so "% Progress" compares like with like. (`total`
      // includes tax, which made progress understated.)
      amount: estimates.amount,
      status: estimates.status,
      notes: estimates.notes,
      lineItems: estimates.lineItems,
      customer: customers.name,
      projectName: projects.name,
      projectCode: projects.code,
    })
    .from(estimates)
    .leftJoin(customers, eq(estimates.customerId, customers.id))
    .leftJoin(projects, eq(estimates.projectId, projects.id))
    .where(and(eq(estimates.orgId, orgId!), isNotNull(estimates.qboId)))
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
      customer: r.customer ?? "—",
      project: r.projectName ? (r.projectCode ? `${r.projectCode} — ${r.projectName}` : r.projectName) : "",
      memo: r.notes || lines[0]?.description || "",
      date: r.date,
      currency: r.currency,
      status: r.status || "(Blank)",
      total: Number(r.amount) || lines.reduce((s, l) => s + l.estAmount, 0),
      lines,
    };
  });

  return ok({ estimates: out });
}
