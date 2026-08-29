import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { paymentRuns, organisations } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";

const CreateSchema = z.object({
  // No hardcoded fallback — an omitted/blank currency defaults to the org's
  // own home currency, resolved server-side in POST.
  currency:             z.string().max(8).optional().nullable(),
  scheduledPaymentDate: z.string().optional().nullable(),
  notes:                z.string().optional().nullable(),
});

async function homeCurrency(orgId: string): Promise<string> {
  const [org] = await db.select({ currency: organisations.currency }).from(organisations).where(eq(organisations.id, orgId)).limit(1);
  return org?.currency ?? "EUR";
}

async function generateRunNumber(orgId: string): Promise<string> {
  const year = new Date().getFullYear();
  const seq  = Date.now().toString().slice(-6);
  return `PR-RUN-${year}-${seq}`;
}

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  const conditions: any[] = [eq(paymentRuns.orgId, orgId!)];
  if (status) conditions.push(eq(paymentRuns.status, status));

  const rows = await db.select().from(paymentRuns)
    .where(and(...conditions))
    .orderBy(desc(paymentRuns.createdAt));
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
    const actorId   = (session?.user as any)?.id ?? null;
    const runNumber = await generateRunNumber(orgId!);
    const currency  = data.currency?.trim() ? data.currency.trim().toUpperCase() : await homeCurrency(orgId!);

    const [created] = await db.insert(paymentRuns).values({
      orgId:                orgId!,
      runNumber,
      currency,
      scheduledPaymentDate: data.scheduledPaymentDate ?? null,
      notes:                data.notes ?? null,
      status:               "Draft",
      totalAmount:          0,
      billCount:            0,
      createdByUserId:      actorId,
    }).returning();

    return ok(created);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error(e);
    return bad("Failed to create payment run", 500);
  }
}
