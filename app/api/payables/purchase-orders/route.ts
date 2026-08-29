import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { purchaseOrders, apSuppliers, organisations } from "@/db/schema";
import { eq, and, ilike, desc } from "drizzle-orm";
import { z } from "zod";
import { logEvent } from "@/lib/audit";

const CreateSchema = z.object({
  supplierId:           z.string().uuid().optional().nullable(),
  poDate:               z.string().optional().nullable(),
  expectedDeliveryDate: z.string().optional().nullable(),
  // No hardcoded fallback — an omitted/blank currency defaults to the
  // selected supplier's own currency, else the org's home currency.
  currency:             z.string().max(8).optional().nullable(),
  notes:                z.string().optional().nullable(),
});

/** Blank currency → the supplier's own currency, else the org's home currency. */
async function resolvePoCurrency(orgId: string, explicit: string | null | undefined, supplierId: string | null | undefined): Promise<string> {
  if (explicit?.trim()) return explicit.trim().toUpperCase();
  if (supplierId) {
    const [s] = await db.select({ currency: apSuppliers.currency }).from(apSuppliers).where(and(eq(apSuppliers.id, supplierId), eq(apSuppliers.orgId, orgId))).limit(1);
    if (s?.currency) return s.currency;
  }
  const [org] = await db.select({ currency: organisations.currency }).from(organisations).where(eq(organisations.id, orgId)).limit(1);
  return org?.currency ?? "EUR";
}

async function generatePoNumber(orgId: string): Promise<string> {
  const year = new Date().getFullYear();
  const seq  = Date.now().toString().slice(-6);
  return `PO-${year}-${seq}`;
}

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const search = searchParams.get("search");

  const conditions: any[] = [eq(purchaseOrders.orgId, orgId!)];
  if (status) conditions.push(eq(purchaseOrders.status, status));
  if (search) conditions.push(ilike(purchaseOrders.poNumber, `%${search}%`));

  const rows = await db.select().from(purchaseOrders)
    .where(and(...conditions))
    .orderBy(desc(purchaseOrders.createdAt));
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
    const actorId   = (session?.user as any)?.id   ?? null;
    const actorName = (session?.user as any)?.name ?? null;
    const poNumber  = await generatePoNumber(orgId!);
    const currency  = await resolvePoCurrency(orgId!, data.currency, data.supplierId);

    const [created] = await db.insert(purchaseOrders).values({
      orgId:                orgId!,
      poNumber,
      supplierId:           data.supplierId ?? null,
      poDate:               data.poDate ?? null,
      expectedDeliveryDate: data.expectedDeliveryDate ?? null,
      currency,
      notes:                data.notes ?? null,
      status:               "Draft",
      approvalStatus:       "Pending",
      createdByUserId:      actorId,
    }).returning();

    await logEvent({
      orgId: orgId!,
      eventType: "purchase_order_created" as any,
      actorId,
      actorName,
      meta: { poNumber: created.poNumber },
    });

    return ok(created);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error(e);
    return bad("Failed to create purchase order", 500);
  }
}
