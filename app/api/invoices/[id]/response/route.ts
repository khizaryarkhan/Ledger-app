import { db } from "@/db";
import { invoices, invoicePromises, invoiceDisputes, communications } from "@/db/schema";
import { requireOrg, bad, ok } from "@/lib/api";
import { isInvoiceInScope } from "@/lib/receivables/rep-scope";
import { recomputeInvoiceState, DISPUTE_CATEGORIES } from "@/lib/portal";
import { and, eq, inArray } from "drizzle-orm";

/**
 * POST /api/invoices/[id]/response
 * Canonical "set the customer response" action — keeps promise ⇄ dispute ⇄ clear
 * consistent everywhere (board, portal, rep portal).
 * Body: { type: "promise" | "dispute" | "clear", promiseDate?, amount?, note?, category?, reason? }
 *
 * Switching is automatic:
 *  - promise  → resolves any open dispute (dispute → promise), records the promise
 *  - dispute  → raises a dispute (dispute wins over a promise in derived state)
 *  - clear    → resolves open disputes + supersedes active promises (back to neutral)
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  const [inv] = await db
    .select({ id: invoices.id, customerId: invoices.customerId, projectId: invoices.projectId, collectionOwnerId: invoices.collectionOwnerId })
    .from(invoices).where(and(eq(invoices.id, params.id), eq(invoices.orgId, orgId!))).limit(1);
  if (!inv) return bad("Invoice not found", 404);

  // A rep may only act on invoices inside their own book — the id comes from
  // the client, so scope has to be checked here, not just on the list views.
  if (!(await isInvoiceInScope(orgId!, (session?.user as any)?.id ?? null, params.id))) {
    return bad("Invoice not found", 404);
  }

  try {
  const body = await req.json().catch(() => ({}));
  const userId = (session!.user as any).id as string;
  const actorName: string = (session!.user as any).name || (session!.user as any).email || "Staff";
  const source = role === "rep" ? "Rep" : "Accountant";

  // Helper: write an activity entry to the chatbox
  async function logActivity(channel: string, subject: string, commBody: string, direction = "Outbound") {
    await db.insert(communications).values({
      orgId: orgId!, customerId: inv.customerId,
      invoiceId: inv.id, projectId: inv.projectId ?? undefined,
      direction, channel, subject, body: commBody,
      sender: actorName, authorId: userId,
      matchedBy: "Manual", isDraft: false,
    }).catch(() => {});
  }

  // Helper: resolve all open disputes on this invoice
  async function resolveOpenDisputes(outcome: string) {
    await db.update(invoiceDisputes)
      .set({ status: "Resolved", outcome, resolvedBy: userId, resolvedAt: new Date() })
      .where(and(
        eq(invoiceDisputes.orgId, orgId!),
        eq(invoiceDisputes.invoiceId, inv.id),
        inArray(invoiceDisputes.status, ["Open", "Under Review"]),
      ));
  }
  // Helper: supersede active promises
  async function supersedePromises() {
    await db.update(invoicePromises)
      .set({ status: "Superseded" })
      .where(and(
        eq(invoicePromises.orgId, orgId!),
        eq(invoicePromises.invoiceId, inv.id),
        eq(invoicePromises.status, "Active"),
      ));
  }

  if (body.type === "promise") {
    if (!body.promiseDate) return bad("promiseDate is required");
    await resolveOpenDisputes("Customer agreed to pay");
    const amount = body.amount != null && !isNaN(Number(body.amount)) ? Number(body.amount) : null;
    await db.insert(invoicePromises).values({
      orgId: orgId!, invoiceId: inv.id, customerId: inv.customerId,
      promiseDate: String(body.promiseDate).slice(0, 16),
      amount, source, enteredBy: userId,
      note: body.note ? String(body.note).slice(0, 1000) : null, status: "Active",
    });
    const amtStr = amount != null ? String(amount) : "full balance";
    await logActivity("Promise", "Promise to pay logged",
      `Promised ${amtStr} by ${body.promiseDate}${body.note ? `\n${body.note}` : ""}`);
  } else if (body.type === "dispute") {
    const category = DISPUTE_CATEGORIES.includes(body.category) ? body.category : "Other";
    await db.insert(invoiceDisputes).values({
      orgId: orgId!, invoiceId: inv.id, customerId: inv.customerId,
      category, reason: body.reason ? String(body.reason).slice(0, 2000) : null,
      source, raisedBy: userId, assignedTo: inv.collectionOwnerId ?? userId, status: "Open",
    });
    await logActivity("Dispute", `Dispute raised · ${category}`,
      `Category: ${category}${body.reason ? `\n${body.reason}` : ""}`);
  } else if (body.type === "clear") {
    await resolveOpenDisputes("Resolved");
    await supersedePromises();
    await db.update(invoices).set({
      hasOpenDispute: false, automationsPaused: false,
      disputeReason: null, disputeDate: null,
      promiseDate: null, promiseAmount: null, promiseSource: null,
      updatedAt: new Date(),
    }).where(and(eq(invoices.id, inv.id), eq(invoices.orgId, orgId!)));
    await logActivity("Dispute", "Response cleared", "Dispute resolved and promise superseded — back to neutral.");
  } else {
    return bad("Invalid type");
  }

  await recomputeInvoiceState(orgId!, inv.id).catch((e) => console.warn("response recompute failed:", e?.message));
  return ok({ ok: true });
  } catch (e: any) {
    // Surface the real DB error (e.g. a missing column) instead of a generic 500
    console.error("response endpoint error:", e?.message);
    return bad(e?.message?.includes("column") ? `Database not migrated: ${e.message}` : (e?.message || "Failed to update response"), 500);
  }
}
