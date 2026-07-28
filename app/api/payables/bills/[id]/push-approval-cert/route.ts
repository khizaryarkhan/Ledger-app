import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { apBills, apSuppliers } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { logEvent } from "@/lib/audit";
import { generateApprovalPdf } from "@/lib/approval-pdf";
import { pushBillApprovalAttachment } from "@/lib/bill-attachments";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  if (role !== "company_admin" && !isSuperAdmin(session)) {
    return bad("Forbidden", 403);
  }

  const [bill] = await db
    .select({
      id:           apBills.id,
      orgId:        apBills.orgId,
      billNumber:   apBills.billNumber,
      total:        apBills.total,
      currency:     apBills.currency,
      qboId:        apBills.qboId,
      xeroId:       apBills.xeroId,
      workflowStatus: apBills.workflowStatus,
      approvedAt:   apBills.approvedAt,
      supplierName: apSuppliers.name,
    })
    .from(apBills)
    .leftJoin(apSuppliers, eq(apBills.supplierId, apSuppliers.id))
    .where(and(eq(apBills.id, params.id), eq(apBills.orgId, orgId!)))
    .limit(1);

  if (!bill) return bad("Bill not found", 404);

  const ELIGIBLE = ["Approved", "Ready for Payment", "Scheduled", "Paid"];
  if (!ELIGIBLE.includes(bill.workflowStatus)) {
    return bad("Bill must be Approved before pushing a certificate", 400);
  }

  if (!bill.qboId && !bill.xeroId) {
    return bad("Bill has no QBO or Xero ID — nothing to push to", 400);
  }

  const actorName = (session?.user as any)?.name ?? null;
  const actorId   = (session?.user as any)?.id   ?? null;

  try {
    const pdfBuffer = await generateApprovalPdf({
      billNumber:   bill.billNumber,
      supplierName: bill.supplierName,
      total:        bill.total,
      currency:     bill.currency,
      approvedAt:   bill.approvedAt ? new Date(bill.approvedAt) : new Date(),
      approverName: actorName,
      comments:     null,
    });

    const pushResult = await pushBillApprovalAttachment(orgId!, bill, pdfBuffer);

    const pushed = pushResult.qbo?.ok || pushResult.xero?.ok;
    if (pushed) {
      await db
        .update(apBills)
        .set({ approvalNotePushedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(apBills.id, params.id), eq(apBills.orgId, orgId!)));

      await logEvent({
        orgId: orgId!,
        eventType: "bill_approval_note_pushed" as any,
        actorId,
        actorName,
        meta: { billId: params.id, billNumber: bill.billNumber },
      });
    }

    return ok({ pushed, result: pushResult });
  } catch (e: any) {
    console.error("[push-approval-cert]", e?.message);
    return bad(e?.message ?? "Failed to push certificate", 500);
  }
}
