import { db } from "@/db";
import { invoiceDisputes, invoices } from "@/db/schema";
import { requireOrg, bad } from "@/lib/api";
import { isInvoiceInScope } from "@/lib/receivables/rep-scope";
import { recomputeInvoiceState, DISPUTE_CATEGORIES } from "@/lib/portal";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * POST /api/invoices/[id]/disputes
 * Staff raises a dispute (e.g. customer queried it by phone). Body:
 *   { category, reason?, source? }
 * Raising a dispute auto-pauses collection automations for the invoice.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  const [inv] = await db.select({ id: invoices.id, customerId: invoices.customerId, collectionOwnerId: invoices.collectionOwnerId })
    .from(invoices).where(and(eq(invoices.id, params.id), eq(invoices.orgId, orgId!))).limit(1);
  if (!inv) return bad("Invoice not found", 404);

  // A rep may only act on invoices inside their own book — the id comes from
  // the client, so scope has to be checked here, not just on the list views.
  if (!(await isInvoiceInScope(orgId!, (session?.user as any)?.id ?? null, params.id))) {
    return bad("Invoice not found", 404);
  }

  const body = await req.json().catch(() => ({}));
  const category = DISPUTE_CATEGORIES.includes(body.category) ? body.category : "Other";
  const source = body.source || (role === "rep" ? "Rep" : "Accountant");
  const userId = (session!.user as any).id as string;

  await db.insert(invoiceDisputes).values({
    orgId: orgId!,
    invoiceId: inv.id,
    customerId: inv.customerId,
    category,
    reason: body.reason ? String(body.reason).slice(0, 2000) : null,
    source,
    raisedBy: userId,
    assignedTo: inv.collectionOwnerId ?? userId, // auto-assign to invoice owner, else the raiser
    status: "Open",
  });

  await recomputeInvoiceState(orgId!, inv.id);
  return NextResponse.json({ ok: true });
}
