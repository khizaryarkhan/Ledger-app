import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { apBills, apApprovals, apSuppliers } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { logEvent } from "@/lib/audit";
import { generateApprovalPdf } from "@/lib/approval-pdf";
import { pushBillApprovalAttachment } from "@/lib/bill-attachments";

const Schema = z.object({
  comments: z.string().optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  if (role !== "company_admin" && !isSuperAdmin(session)) {
    return bad("Forbidden", 403);
  }

  const [bill] = await db.select({
    id:           apBills.id,
    orgId:        apBills.orgId,
    billNumber:   apBills.billNumber,
    total:        apBills.total,
    currency:     apBills.currency,
    supplierId:   apBills.supplierId,
    qboId:        apBills.qboId,
    xeroId:       apBills.xeroId,
    source:       apBills.source,
    workflowStatus: apBills.workflowStatus,
    supplierName: apSuppliers.name,
  })
    .from(apBills)
    .leftJoin(apSuppliers, eq(apBills.supplierId, apSuppliers.id))
    .where(and(eq(apBills.id, params.id), eq(apBills.orgId, orgId!)))
    .limit(1);
  if (!bill) return bad("Bill not found", 404);

  try {
    const { comments } = Schema.parse(await req.json().catch(() => ({})));
    const actorId   = (session?.user as any)?.id   ?? null;
    const actorName = (session?.user as any)?.name ?? null;

    const [updated] = await db.update(apBills)
      .set({
        workflowStatus:   "Approved",
        approvalStatus:   "Approved",
        approvedByUserId: actorId,
        approvedAt:       new Date(),
        updatedAt:        new Date(),
      })
      .where(and(eq(apBills.id, params.id), eq(apBills.orgId, orgId!)))
      .returning();

    await db.insert(apApprovals).values({
      orgId:         orgId!,
      entityType:    "bill",
      entityId:      params.id,
      stepNumber:    1,
      approverUserId: actorId,
      status:        "Approved",
      decision:      "Approved",
      comments:      comments ?? null,
      approvedAt:    new Date(),
    });

    await logEvent({
      orgId: orgId!,
      eventType: "bill_approved" as any,
      actorId,
      actorName,
      meta: { billId: params.id, billNumber: bill.billNumber, comments },
    });

    // Push approval certificate to QBO / Xero as a supporting document.
    // Never throws — result is included in the response for diagnostics.
    let attachmentResult = {};
    try {
      const pdfBuffer = await generateApprovalPdf({
        billNumber:   bill.billNumber,
        supplierName: bill.supplierName,
        total:        bill.total,
        currency:     bill.currency,
        approvedAt:   new Date(),
        approverName: actorName,
        comments:     comments ?? null,
      });
      attachmentResult = await pushBillApprovalAttachment(orgId!, bill, pdfBuffer);
    } catch (attachErr: any) {
      console.error("[approve] attachment push failed:", attachErr?.message);
      attachmentResult = { error: attachErr?.message };
    }

    return ok({ ...updated, _attachment: attachmentResult });
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error(e);
    return bad("Failed to approve bill", 500);
  }
}
