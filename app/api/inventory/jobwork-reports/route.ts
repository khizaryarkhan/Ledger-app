/**
 * GET /api/inventory/jobwork-reports?type=vendor-yield
 * Subcontractor yield & wastage performance — ranks job-work vendors by
 * actual material yield / wastage value, computed ONLY from CLOSED orders
 * (an order still in flight has no final wastage figure yet).
 */

import { db } from "@/db";
import { jobWorkOrders } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, isNotNull } from "drizzle-orm";

const round2 = (n: number) => Math.round((n || 0) * 100) / 100;

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "vendor-yield";
  if (type !== "vendor-yield") return bad("Unknown report type", 400);

  const rows = await db.select().from(jobWorkOrders)
    .where(and(eq(jobWorkOrders.orgId, orgId!), eq(jobWorkOrders.status, "Closed"), isNotNull(jobWorkOrders.closedAt)));

  type VendorAgg = {
    vendorId: string | null; vendorLabel: string;
    orderCount: number; totalSentQty: number; totalReceivedQty: number;
    totalSentAmount: number; totalWastageQty: number; totalWastageAmount: number;
    expectedYieldSum: number; expectedYieldCount: number;
    orders: any[];
  };
  const byVendor = new Map<string, VendorAgg>();

  for (const r of rows) {
    const key = r.vendorId ?? r.vendorLabel ?? "unknown";
    const sentQty = Number(r.sentQty);
    const sentAmount = Number(r.sentAmount);
    const receivedQty = Number(r.receivedQty ?? 0);
    const wastageQty = Number(r.wastageQty ?? 0);
    const wastageAmount = Number(r.wastageAmount ?? 0);
    const expected = r.expectedYieldPct != null ? Number(r.expectedYieldPct) : null;
    const actualYieldPct = sentQty > 0 ? round2((receivedQty / sentQty) * 100) : 0;

    let v = byVendor.get(key);
    if (!v) {
      v = { vendorId: r.vendorId, vendorLabel: r.vendorLabel ?? "Unknown vendor", orderCount: 0, totalSentQty: 0, totalReceivedQty: 0, totalSentAmount: 0, totalWastageQty: 0, totalWastageAmount: 0, expectedYieldSum: 0, expectedYieldCount: 0, orders: [] };
      byVendor.set(key, v);
    }
    v.orderCount += 1;
    v.totalSentQty += sentQty;
    v.totalReceivedQty += receivedQty;
    v.totalSentAmount += sentAmount;
    v.totalWastageQty += wastageQty;
    v.totalWastageAmount += wastageAmount;
    if (expected != null) { v.expectedYieldSum += expected; v.expectedYieldCount += 1; }
    v.orders.push({
      id: r.id, docNumber: r.docNumber, sentQty, sentAmount, receivedQty, wastageQty, wastageAmount,
      actualYieldPct, expectedYieldPct: expected, closedAt: r.closedAt, dispatchDate: r.dispatchDate,
    });
  }

  const vendors = [...byVendor.values()].map(v => ({
    vendorId: v.vendorId, vendorLabel: v.vendorLabel, orderCount: v.orderCount,
    totalSentQty: round2(v.totalSentQty), totalReceivedQty: round2(v.totalReceivedQty),
    totalSentAmount: round2(v.totalSentAmount), totalWastageQty: round2(v.totalWastageQty),
    totalWastageAmount: round2(v.totalWastageAmount),
    actualYieldPct: v.totalSentQty > 0 ? round2((v.totalReceivedQty / v.totalSentQty) * 100) : 0,
    avgExpectedYieldPct: v.expectedYieldCount > 0 ? round2(v.expectedYieldSum / v.expectedYieldCount) : null,
    orders: v.orders.sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? "")),
  })).sort((a, b) => b.totalWastageAmount - a.totalWastageAmount);

  const grandTotal = {
    totalSentQty: round2(vendors.reduce((s, v) => s + v.totalSentQty, 0)),
    totalReceivedQty: round2(vendors.reduce((s, v) => s + v.totalReceivedQty, 0)),
    totalWastageAmount: round2(vendors.reduce((s, v) => s + v.totalWastageAmount, 0)),
    orderCount: vendors.reduce((s, v) => s + v.orderCount, 0),
  };

  return ok({ vendors, grandTotal });
}
