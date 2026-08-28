/**
 * GET  /api/inventory/jobwork   → list job work orders (dispatch/receive lifecycle)
 * POST /api/inventory/jobwork   → dispatch material to a job worker
 */

import { db } from "@/db";
import { jobWorkOrders, apItems } from "@/db/schema";
import { requireOrg, ok, bad, canPostInventoryTxn } from "@/lib/api";
import { and, eq, desc, inArray } from "drizzle-orm";
import { dispatchToJobWorker, type DispatchInput } from "@/lib/inventory/jobwork";
import { LedgerValidationError } from "@/lib/ledger";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const rows = await db.select().from(jobWorkOrders).where(eq(jobWorkOrders.orgId, orgId!)).orderBy(desc(jobWorkOrders.createdAt)).limit(200);
  const ids = [...new Set([...rows.map(r => r.sentItemId), ...rows.map(r => r.receivedItemId).filter(Boolean)] as string[])];
  const items = ids.length ? await db.select({ id: apItems.id, name: apItems.name, baseUom: apItems.baseUom }).from(apItems).where(and(eq(apItems.orgId, orgId!), inArray(apItems.id, ids))) : [];
  const byId = new Map(items.map(i => [i.id, i]));
  return ok(rows.map(r => ({ ...r, sentItem: byId.get(r.sentItemId) ?? null, receivedItem: r.receivedItemId ? byId.get(r.receivedItemId) ?? null : null })));
}

export async function POST(req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (!canPostInventoryTxn(role)) return bad("You don't have permission to post job work orders", 403);
  const body = (await req.json().catch(() => ({}))) as DispatchInput;
  try {
    const res = await dispatchToJobWorker(orgId!, body, (session?.user as any)?.id ?? null);
    return ok(res);
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[jobwork] dispatch failed:", e);
    return bad("Failed to dispatch to job worker", 500);
  }
}
