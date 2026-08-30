/**
 * GET    /api/inventory/jobwork/[id] → one order + its individual receipt tranches
 * DELETE /api/inventory/jobwork/[id] → void a job work order (guarded)
 */

import { db } from "@/db";
import { jobWorkOrders, jobWorkReceipts } from "@/db/schema";
import { and, eq, asc } from "drizzle-orm";
import { requireOrg, ok, bad, canPostInventoryTxn } from "@/lib/api";
import { voidJobWorkOrder } from "@/lib/inventory/void";
import { LedgerValidationError } from "@/lib/ledger";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const [jwo] = await db.select().from(jobWorkOrders).where(and(eq(jobWorkOrders.id, params.id), eq(jobWorkOrders.orgId, orgId!))).limit(1);
  if (!jwo) return bad("Job work order not found", 404);
  const receipts = await db.select().from(jobWorkReceipts).where(and(eq(jobWorkReceipts.orgId, orgId!), eq(jobWorkReceipts.jobWorkOrderId, params.id))).orderBy(asc(jobWorkReceipts.createdAt));
  return ok({ ...jwo, receipts });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!canPostInventoryTxn(role)) return bad("You don't have permission for this action", 403);
  try { return ok(await voidJobWorkOrder(orgId!, params.id)); }
  catch (e: any) { if (e instanceof LedgerValidationError) return bad(e.message, 409); console.error("[jobwork void]", e); return bad("Could not void job work order", 500); }
}
