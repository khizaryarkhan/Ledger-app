import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { apSuppliers, apBills, organisations } from "@/db/schema";
import { eq, and, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";

const CreateSchema = z.object({
  name:         z.string().min(1).max(255),
  displayName:  z.string().max(255).optional(),
  code:         z.string().max(64).optional(),
  email:        z.string().email().optional().nullable(),
  phone:        z.string().max(64).optional().nullable(),
  address:      z.string().optional().nullable(),
  country:      z.string().max(64).optional().nullable(),
  // No hardcoded fallback — an omitted/blank currency defaults to the org's
  // own home currency (resolved server-side in POST), never a fixed literal.
  currency:     z.string().max(8).optional().nullable(),
  paymentTerms: z.number().int().default(30),
  taxNumber:    z.string().max(64).optional().nullable(),
  status:       z.enum(["Active", "Inactive", "Suspended"]).default("Active"),
  riskRating:   z.enum(["Low", "Medium", "High"]).default("Low"),
  notes:        z.string().optional().nullable(),
});

// A blank currency defaults to the org's home currency — EXCEPT when
// multi-currency is on, where it's left "" (apSuppliers.currency is NOT
// NULL, so "" is the "unset" sentinel) so the supplier's currency locks to
// whatever its first real bill/transaction uses instead of presuming home
// currency up front (see lib/accounting/documents.ts's postDocument).
async function defaultCurrency(orgId: string): Promise<string> {
  const [org] = await db.select({ currency: organisations.currency, mc: organisations.multicurrencyEnabled }).from(organisations).where(eq(organisations.id, orgId)).limit(1);
  if (org?.mc) return "";
  return org?.currency ?? "EUR";
}

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const search = searchParams.get("search");

  const conditions = [eq(apSuppliers.orgId, orgId!)];
  if (status) conditions.push(eq(apSuppliers.status, status));
  if (search) {
    conditions.push(
      or(
        ilike(apSuppliers.name, `%${search}%`),
        ilike(apSuppliers.displayName, `%${search}%`),
        ilike(apSuppliers.email, `%${search}%`),
        ilike(apSuppliers.code, `%${search}%`),
      ) as any,
    );
  }

  const rows = await db
    .select({
      id:           apSuppliers.id,
      orgId:        apSuppliers.orgId,
      name:         apSuppliers.name,
      displayName:  apSuppliers.displayName,
      code:         apSuppliers.code,
      email:        apSuppliers.email,
      phone:        apSuppliers.phone,
      address:      apSuppliers.address,
      country:      apSuppliers.country,
      currency:     apSuppliers.currency,
      paymentTerms: apSuppliers.paymentTerms,
      taxNumber:    apSuppliers.taxNumber,
      status:       apSuppliers.status,
      riskRating:   apSuppliers.riskRating,
      notes:        apSuppliers.notes,
      qboId:        apSuppliers.qboId,
      xeroId:       apSuppliers.xeroId,
      source:       apSuppliers.source,
      lastSyncedAt: apSuppliers.lastSyncedAt,
      createdAt:    apSuppliers.createdAt,
      updatedAt:    apSuppliers.updatedAt,
      lastSynced:   apSuppliers.lastSyncedAt,
      totalOutstanding: sql<number>`COALESCE(SUM(CASE WHEN ${apBills.balance} > 0 THEN ${apBills.balance} ELSE 0 END), 0)`,
      openBillsCount:   sql<number>`COUNT(CASE WHEN ${apBills.balance} > 0 THEN 1 ELSE NULL END)::int`,
      overdueCount:     sql<number>`COUNT(CASE WHEN ${apBills.balance} > 0 AND ${apBills.dueDate} IS NOT NULL AND ${apBills.dueDate} < to_char(CURRENT_DATE, 'YYYY-MM-DD') THEN 1 ELSE NULL END)::int`,
    })
    .from(apSuppliers)
    .leftJoin(apBills, and(eq(apBills.supplierId, apSuppliers.id), eq(apBills.orgId, apSuppliers.orgId)))
    .where(and(...conditions))
    .groupBy(apSuppliers.id)
    .orderBy(apSuppliers.name);

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
    const currency = data.currency?.trim().toUpperCase() || await defaultCurrency(orgId!);
    const [created] = await db.insert(apSuppliers).values({
      orgId:        orgId!,
      name:         data.name,
      displayName:  data.displayName ?? null,
      code:         data.code ?? null,
      email:        data.email ?? null,
      phone:        data.phone ?? null,
      address:      data.address ?? null,
      country:      data.country ?? null,
      currency,
      paymentTerms: data.paymentTerms,
      taxNumber:    data.taxNumber ?? null,
      status:       data.status,
      riskRating:   data.riskRating,
      notes:        data.notes ?? null,
      source:       "manual",
    }).returning();
    return ok(created);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error(e);
    return bad("Failed to create supplier", 500);
  }
}
