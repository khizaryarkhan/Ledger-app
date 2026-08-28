import { db } from "@/db";
import { invoices, invoicePromises, invoiceDisputes, communications } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { isInvoiceInScope } from "@/lib/receivables/rep-scope";
import { eq, and } from "drizzle-orm";
import { logEvent } from "@/lib/audit";
import { recomputeInvoiceState } from "@/lib/portal";
import { linksForAny } from "@/lib/accounting/links";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, params.id), eq(invoices.orgId, orgId!))).limit(1);
  if (!inv) return bad("Not found", 404);
  // Whatever settled this invoice — a native Payment (transaction_links) or a
  // QBO/Xero-synced one (payment_applications) — same shape either way.
  const linkedTransactions = await linksForAny(orgId!, "Invoice", inv.id).catch(() => []);
  return ok({ ...inv, linkedTransactions });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  // Fetch before-state for change detection
  const [before] = await db.select().from(invoices).where(and(eq(invoices.id, params.id), eq(invoices.orgId, orgId!))).limit(1);
  if (!before) return bad("Not found", 404);

  // Reps may only edit invoices in their own book (see the list endpoints —
  // scope has to hold on writes too, since the id is client-supplied).
  if (!(await isInvoiceInScope(orgId!, (session?.user as any)?.id ?? null, params.id))) {
    return bad("Not found", 404);
  }

  const body = await req.json();

  // When moving away from Escalated, always clear the assignee and escalation
  // context — even if client forgot to send the null fields (server-side safety net).
  if (body.collectionStage && body.collectionStage !== "Escalated" && before.collectionStage === "Escalated") {
    body.escalatedToUserId  = null;
    body.escalatedToName    = null;
    body.escalatedToEmail   = null;
    body.escalationType     = null;
    body.escalationNote     = null;
    body.escalatedAt        = null;
  }
  // Entering Escalated — stamp when it happened (server clock, not client).
  if (body.collectionStage === "Escalated" && before.collectionStage !== "Escalated") {
    body.escalatedAt = new Date();
  }
  // escalatedAt arrives as an ISO string from JSON when the client echoes it back — coerce.
  if (typeof body.escalatedAt === "string") body.escalatedAt = new Date(body.escalatedAt);

  const [updated] = await db.update(invoices)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(invoices.id, params.id), eq(invoices.orgId, orgId!)))
    .returning();
  if (!updated) return bad("Not found", 404);

  const actorId   = (session?.user as any)?.id   ?? null;
  const actorName = (session?.user as any)?.name  ?? null;
  const base = {
    orgId: orgId!,
    customerId: updated.customerId,
    projectId:  updated.projectId ?? null,
    invoiceId:  updated.id,
    actorId,
    actorName,
  };

  // ── Stage changed ──────────────────────────────────────────────────────────
  if (body.collectionStage && body.collectionStage !== before.collectionStage) {
    const toStage   = body.collectionStage as string;
    const fromStage = before.collectionStage ?? "—";
    const assigneeName  = toStage === "Escalated" ? (body.escalatedToName  ?? updated.escalatedToName  ?? null) : null;
    const assigneeEmail = toStage === "Escalated" ? (body.escalatedToEmail ?? updated.escalatedToEmail ?? null) : null;
    const escType       = toStage === "Escalated" ? (body.escalationType   ?? updated.escalationType   ?? null) : null;
    const escNote       = toStage === "Escalated" ? (body.escalationNote   ?? updated.escalationNote   ?? null) : null;

    await logEvent({
      ...base,
      eventType: "stage_changed",
      meta: { fromStage, toStage, invoiceNo: updated.invoiceNumber, escalatedToName: assigneeName, escalatedToEmail: assigneeEmail, escalationType: escType },
    });

    // Write a StageChange communication so it surfaces in the activity feed.
    // Wrapped in try/catch so a DB error here never blocks the invoice update response.
    try {
      await db.insert(communications).values({
        orgId:      orgId!,
        customerId: updated.customerId,
        projectId:  updated.projectId ?? null,
        invoiceId:  updated.id,
        direction:  "Outbound",
        channel:    "StageChange",
        subject:    escType ? `${fromStage} → ${toStage} · ${escType}` : `${fromStage} → ${toStage}`,
        body:       assigneeName
                      ? [`${assigneeName}${assigneeEmail ? ` · ${assigneeEmail}` : ""}`, escNote ? `“${escNote}”` : null]
                          .filter(Boolean).join("\n")
                      : null,
        sender:     actorName ?? "Staff",
        matchedBy:  "System",
        isDraft:    false,
        ...(actorId ? { authorId: actorId } : {}),
      });
    } catch (e) {
      console.error("[StageChange] Failed to log activity:", e);
    }
  }

  // ── Promise to pay ─────────────────────────────────────────────────────────
  if (body.promiseDate && body.promiseDate !== before.promiseDate) {
    await logEvent({
      ...base,
      eventType: "promise_to_pay",
      meta: {
        promiseDate: body.promiseDate,
        invoiceNo:   updated.invoiceNumber,
      },
    });
  }

  // ── Dispute raised / updated ───────────────────────────────────────────────
  if (body.disputeReason && body.disputeReason !== before.disputeReason) {
    await logEvent({
      ...base,
      eventType: "dispute_raised",
      meta: {
        reason:    body.disputeReason,
        invoiceNo: updated.invoiceNumber,
      },
    });
  }

  // ── Unify with the Customer Response system ─────────────────────────────────
  // When staff log a promise/dispute via the board or invoice modals, also
  // create the corresponding EVENT so it appears in the Responses inbox and the
  // invoice timeline — and recompute derived state (board stage, auto-pause).
  // This makes the event tables the single source of truth (no duplication).
  const staffSource = role === "rep" ? "Rep" : "Accountant";
  let touchedEvents = false;

  if (body.promiseDate && body.promiseDate !== before.promiseDate) {
    await db.insert(invoicePromises).values({
      orgId: orgId!, invoiceId: updated.id, customerId: updated.customerId,
      promiseDate: String(body.promiseDate).slice(0, 16),
      amount: null, source: staffSource, enteredBy: actorId, status: "Active",
    });
    touchedEvents = true;
  }

  if (body.disputeReason && body.disputeReason !== before.disputeReason) {
    await db.insert(invoiceDisputes).values({
      orgId: orgId!, invoiceId: updated.id, customerId: updated.customerId,
      category: "Other", reason: body.disputeReason,
      source: staffSource, raisedBy: actorId,
      assignedTo: updated.collectionOwnerId ?? actorId,
      status: "Open",
    });
    touchedEvents = true;
  }

  if (touchedEvents) {
    await recomputeInvoiceState(orgId!, updated.id).catch(() => {});
  }

  return ok(updated);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  await db.delete(invoices).where(and(eq(invoices.id, params.id), eq(invoices.orgId, orgId!)));
  return ok({ ok: true });
}
