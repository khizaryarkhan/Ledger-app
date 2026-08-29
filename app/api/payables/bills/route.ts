import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { apBills, apSuppliers, organisations } from "@/db/schema";
import { eq, and, ilike, lte, gte, desc } from "drizzle-orm";
import { z } from "zod";

const CreateSchema = z.object({
  supplierId:   z.string().uuid().optional().nullable(),
  billNumber:   z.string().max(64).optional().nullable(),
  reference:    z.string().max(128).optional().nullable(),
  billDate:     z.string().optional().nullable(),
  dueDate:      z.string().optional().nullable(),
  // No hardcoded fallback — an omitted/blank currency defaults to the
  // supplier's own currency, else the org's home currency (resolved
  // server-side in POST).
  currency:     z.string().max(8).optional().nullable(),
  subtotal:     z.number().default(0),
  taxTotal:     z.number().default(0),
  total:        z.number().default(0),
  notes:        z.string().optional().nullable(),
});

async function resolveBillCurrency(orgId: string, explicit: string | null | undefined, supplierId: string | null | undefined): Promise<string> {
  if (explicit?.trim()) return explicit.trim().toUpperCase();
  if (supplierId) {
    const [s] = await db.select({ currency: apSuppliers.currency }).from(apSuppliers).where(and(eq(apSuppliers.id, supplierId), eq(apSuppliers.orgId, orgId))).limit(1);
    if (s?.currency) return s.currency;
  }
  const [org] = await db.select({ currency: organisations.currency }).from(organisations).where(eq(organisations.id, orgId)).limit(1);
  return org?.currency ?? "EUR";
}

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

export async function POST(req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  if (role !== "company_admin" && !isSuperAdmin(session)) {
    return bad("Forbidden", 403);
  }

  try {
    const data = CreateSchema.parse(await req.json());
    const balance = data.total - 0;
    const currency = await resolveBillCurrency(orgId!, data.currency, data.supplierId);

    const [created] = await db.insert(apBills).values({
      orgId:          orgId!,
      supplierId:     data.supplierId ?? null,
      billNumber:     data.billNumber ?? null,
      reference:      data.reference ?? null,
      billDate:       data.billDate ?? null,
      dueDate:        data.dueDate ?? null,
      currency,
      subtotal:       data.subtotal,
      taxTotal:       data.taxTotal,
      total:          data.total,
      amountPaid:     0,
      balance,
      workflowStatus: "Pending Review",
      source:         "manual",
    }).returning();
    return ok(created);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error(e);
    return bad("Failed to create bill", 500);
  }
}
