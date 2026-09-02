import { requireOrg, ok, bad } from "@/lib/api";
import { db } from "@/db";
import { apBills, apSuppliers } from "@/db/schema";
import { eq, and, ilike, lte, gte, desc } from "drizzle-orm";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const workflowStatus = searchParams.get("workflowStatus");
  const supplierId     = searchParams.get("supplierId");
  const search         = searchParams.get("search");
  const dueBefore      = searchParams.get("dueBefore");
  const dueAfter       = searchParams.get("dueAfter");

  const conditions: any[] = [eq(apBills.orgId, orgId!)];
  if (workflowStatus) conditions.push(eq(apBills.workflowStatus, workflowStatus));
  if (supplierId)     conditions.push(eq(apBills.supplierId, supplierId));
  if (search)         conditions.push(ilike(apBills.billNumber, `%${search}%`));
  if (dueBefore)      conditions.push(lte(apBills.dueDate, dueBefore));
  if (dueAfter)       conditions.push(gte(apBills.dueDate, dueAfter));

  const rows = await db
    .select({
      id:              apBills.id,
      billNumber:      apBills.billNumber,
      supplierId:      apBills.supplierId,
      supplierName:    apSuppliers.name,
      billDate:        apBills.billDate,
      dueDate:         apBills.dueDate,
      currency:        apBills.currency,
      subtotal:        apBills.subtotal,
      taxTotal:        apBills.taxTotal,
      total:           apBills.total,
      amountPaid:      apBills.amountPaid,
      balance:         apBills.balance,
      accountingStatus: apBills.accountingPaymentStatus,
      workflowStatus:  apBills.workflowStatus,
      approvalStatus:  apBills.approvalStatus,
      purchaseOrderId: apBills.purchaseOrderId,
      qboId:           apBills.qboId,
      xeroId:          apBills.xeroId,
      source:          apBills.source,
      assignedApproverId:  apBills.assignedApproverId,
      approverEmail:          apBills.approverEmail,
      lastApprovalSentAt:     apBills.lastApprovalSentAt,
      approvalNotePushedAt:   apBills.approvalNotePushedAt,
      privateNote:            apBills.privateNote,
      createdAt:              apBills.createdAt,
      updatedAt:              apBills.updatedAt,
    })
    .from(apBills)
    .leftJoin(apSuppliers, eq(apBills.supplierId, apSuppliers.id))
    .where(and(...conditions))
    .orderBy(desc(apBills.dueDate));

  return ok(rows);
}

/**
 * Bill creation deliberately does NOT live here.
 *
 * This endpoint used to insert an `ap_bills` header with no lines, no expense
 * account and `source: "manual"` — an accounting-incomplete record that never
 * reached the general ledger, so a liability could exist in the Payables UI
 * while P&L, the Balance Sheet and the A/P control account knew nothing about
 * it. Nothing in the app ever called it (every Payables caller is a GET or a
 * workflow action), so it was removed rather than repaired.
 *
 * There is now exactly ONE way a bill is created:
 *   - native  → POST /api/documents/Bill (lib/accounting/documents.ts), which
 *               posts Dr expense per line / Cr A/P through lib/ledger.ts and
 *               then mirrors itself into `ap_bills` via bridgeNativeBill(),
 *               so the Payables workflow still manages it;
 *   - synced  → written by lib/qbo-ap-sync.ts / lib/xero-ap-sync.ts, whose
 *               ledger lives in the provider (posting those here would
 *               double-count).
 *
 * Payables is the workflow/approval layer over bills, never their point of
 * entry. Keep it that way.
 */
export async function POST() {
  return bad(
    "Bills are created in Accounting → New → Bill, which posts them to the ledger. " +
    "Payables manages approval and payment of bills that already exist.",
    405,
  );
}
