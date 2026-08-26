import { db } from "@/db";
import { invoicePromises, invoices, communications } from "@/db/schema";
import { requireOrg, bad } from "@/lib/api";
import { isInvoiceInScope } from "@/lib/receivables/rep-scope";
import { recomputeInvoiceState } from "@/lib/portal";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * POST /api/invoices/[id]/promises
 * Staff logs a promise-to-pay (e.g. relayed by phone). Body:
 *   { promiseDate, amount?, note?, source? }
 * source defaults to "Rep" for rep users, otherwise "Accountant".
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  const [inv] = await db.select({ id: invoices.id, customerId: invoices.customerId, projectId: invoices.projectId })
    .from(invoices).where(and(eq(invoices.id, params.id), eq(invoices.orgId, orgId!))).limit(1);
  if (!inv) return bad("Invoice not found", 404);

  // A rep may only act on invoices inside their own book — the id comes from
  // the client, so scope has to be checked here, not just on the list views.
  if (!(await isInvoiceInScope(orgId!, (session?.user as any)?.id ?? null, params.id))) {
    return bad("Invoice not found", 404);
  }

  const body = await req.json().catch(() => ({}));
  if (!body.promiseDate) return bad("promiseDate is required");

  const source = body.source || (role === "rep" ? "Rep" : "Accountant");
  const userId = (session!.user as any).id as string;
  const actorName: string = (session!.user as any).name || (session!.user as any).email || "Staff";
  const amount = body.amount != null && !isNaN(Number(body.amount)) ? Number(body.amount) : null;

  await db.insert(invoicePromises).values({
    orgId: orgId!,
    invoiceId: inv.id,
    customerId: inv.customerId,
    promiseDate: String(body.promiseDate).slice(0, 16),
    amount,
    source,
    enteredBy: userId,
    note: body.note ? String(body.note).slice(0, 1000) : null,
    status: "Active",
  });

  // Log to chatbox so the board shows a complete thread
  const amtStr = amount != null ? String(amount) : "full balance";
  await db.insert(communications).values({
    orgId: orgId!,
    customerId: inv.customerId,
    invoiceId: inv.id,
    projectId: inv.projectId ?? undefined,
    direction: "Outbound",
    channel: "Promise",
    subject: `Promise to pay logged`,
    body: `Promised ${amtStr} by ${body.promiseDate}${body.note ? `\n${body.note}` : ""}`,
    sender: actorName,
    authorId: userId,
    matchedBy: "Manual",
    isDraft: false,
  }).catch(() => {});

  await recomputeInvoiceState(orgId!, inv.id);
  return NextResponse.json({ ok: true });
}
