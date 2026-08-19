import { db } from "@/db";
import { customers } from "@/db/schema";
import { requireOrg, requireReadScope, ok, bad } from "@/lib/api";
import { getRepScope } from "@/lib/rep-scope";
import { z } from "zod";
import { desc, eq, and, inArray } from "drizzle-orm";

const Schema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(64),
  country: z.string().optional(),
  currency: z.string().default("EUR"),
  paymentTerms: z.number().int().default(30),
  taxNumber: z.string().optional(),
  riskRating: z.enum(["Low", "Medium", "High"]).default("Low"),
  status: z.enum(["Active", "On Hold", "Inactive"]).default("Active"),
  creditLimit: z.number().nullable().optional(),
  accountOwnerId: z.string().uuid().nullable().optional(),
  collectionOwnerId: z.string().uuid().nullable().optional(),
  notes: z.string().optional(),
  companyName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  addressStreet: z.string().optional(),
  addressCity: z.string().optional(),
  addressPostcode: z.string().optional(),
  paymentMethod: z.string().optional(),
});

export async function GET() {
  const { error, orgId, orgIds, role, repId } = await requireReadScope();
  if (error) return error;

  const rows = await db.select().from(customers).where(inArray(customers.orgId, orgIds)).orderBy(desc(customers.createdAt));

  // Reps only see customers in their book (plus any referenced by a visible invoice).
  const scope = await getRepScope(orgId!, role, repId);
  if (scope) return ok(rows.filter((c) => scope.customerIds.has(c.id)));
  return ok(rows);
}

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  try {
    const body = await req.json();
    const data = Schema.parse(body);
    const [existing] = await db.select().from(customers).where(and(eq(customers.code, data.code), eq(customers.orgId, orgId!))).limit(1);
    if (existing) return bad(`Customer code "${data.code}" already exists`, 409);
    const [created] = await db.insert(customers).values({
      orgId: orgId!,
      name: data.name,
      code: data.code,
      country: data.country,
      currency: data.currency ?? "EUR",
      paymentTerms: data.paymentTerms ?? 30,
      taxNumber: data.taxNumber,
      riskRating: data.riskRating ?? "Low",
      status: data.status ?? "Active",
      creditLimit: data.creditLimit ?? null,
      accountOwnerId: data.accountOwnerId ?? null,
      collectionOwnerId: data.collectionOwnerId ?? null,
      notes: data.notes,
    }).returning();
    return ok(created);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error(e);
    return bad("Failed to create customer", 500);
  }
}
