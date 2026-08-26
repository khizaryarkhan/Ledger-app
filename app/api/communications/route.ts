import { db } from "@/db";
import { communications, invoices, customers, projects, contacts } from "@/db/schema";
import { requireOrg, requireReadScope, ok, bad, ownsInOrg } from "@/lib/api";
import { z } from "zod";
import { desc, eq, and, ne, inArray } from "drizzle-orm";
import { logEvent } from "@/lib/audit";
import { isInvoiceInScope } from "@/lib/receivables/rep-scope";

const Schema = z.object({
  customerId: z.string().uuid(),
  invoiceId: z.string().uuid().nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
  direction: z.enum(["Inbound", "Outbound"]),
  channel: z.enum(["Email", "Note", "Phone", "Meeting", "Chase", "StageChange"]),
  sentAt: z.string().optional(), // ISO timestamp — lets manual chases be backdated
  subject: z.string().optional(),
  sender: z.string().optional(),
  recipients: z.string().optional(),
  body: z.string().optional(),
  matchedBy: z.string().optional(),
  isDraft: z.boolean().default(false),
  refNumber: z.string().optional(),
  stageAtSend: z.string().optional(),
  projectId: z.string().uuid().nullable().optional(),
  messageId: z.string().max(998).optional(),
  // When logging a reply, pass the original email's refNumber so the reply
  // gets linked to all invoices that shared that outbound email.
  inReplyToRef: z.string().max(64).optional(),
});

// Stages that should never be auto-overridden (manual-only)
const MANUAL_STAGES = new Set(["Disputed", "Promised", "Promise to Pay", "On Hold", "Escalated"]);

export async function GET(req: Request) {
  const { error, orgIds } = await requireReadScope();
  if (error) return error;
  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId");
  const invoiceId = searchParams.get("invoiceId");

  // IMPORTANT: do NOT use $dynamic().where() chaining here — in Drizzle ORM,
  // a second .where() call replaces (not ANDs) the first, which would drop the
  // orgId filter and allow cross-tenant reads. Build a single and() predicate.
  // orgIds spans the group in consolidated mode, else the single active org.
  const orgFilter = inArray(communications.orgId, orgIds);
  const where = invoiceId
    ? and(orgFilter, eq(communications.invoiceId, invoiceId))
    : customerId
    ? and(orgFilter, eq(communications.customerId, customerId))
    : orgFilter;

  return ok(await db.select().from(communications).where(where).orderBy(desc(communications.sentAt)));
}

export async function POST(req: Request) {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;
  try {
    const data = Schema.parse(await req.json());

    // Ensure every client-supplied reference belongs to this org.
    if (!(await ownsInOrg(customers, data.customerId, orgId!))) return bad("Customer not found in this organisation", 404);
    if (!(await ownsInOrg(invoices, data.invoiceId, orgId!)))   return bad("Invoice not found in this organisation", 404);
    if (!(await ownsInOrg(projects, data.projectId, orgId!)))   return bad("Project not found in this organisation", 404);
    if (!(await ownsInOrg(contacts, data.contactId, orgId!)))   return bad("Contact not found in this organisation", 404);

    // Org ownership isn't enough for a rep: notes/chases attach to an invoice's
    // history, so writing one requires that invoice to be inside their book.
    // (Unrestricted callers — admins, users with no rep record — short-circuit.)
    if (data.invoiceId && !(await isInvoiceInScope(orgId!, (session!.user as any)?.id ?? null, data.invoiceId))) {
      return bad("Invoice not found in this organisation", 404);
    }

    // If this is an outbound email for an invoice, count previous emails to determine auto-stage
    let autoStage: string | null = null;
    let currentStageForLog: string | null = null;

    if (data.invoiceId && !data.isDraft && data.channel === "Email" && data.direction === "Outbound") {
      const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, data.invoiceId), eq(invoices.orgId, orgId!))).limit(1);
      if (inv) {
        currentStageForLog = inv.collectionStage;

        if (!MANUAL_STAGES.has(inv.collectionStage)) {
          // Count previous outbound emails for this invoice (before this one)
          const prevEmails = await db
            .select({ id: communications.id })
            .from(communications)
            .where(and(
              eq(communications.invoiceId, data.invoiceId),
              eq(communications.channel, "Email"),
              eq(communications.direction, "Outbound"),
              eq(communications.isDraft, false),
              eq(communications.orgId, orgId!),
            ));

          // First email moves New → Reminder Sent. We no longer auto-advance to
          // "Second Notice" / "Final Notice" (those stages were retired) — the
          // chase count is surfaced separately, so the stage stays "Reminder Sent".
          const prevCount = prevEmails.length;
          if (prevCount === 0) autoStage = "Reminder Sent";
        }
      }
    }

    const [created] = await db.insert(communications).values({
      orgId: orgId!,
      customerId: data.customerId,
      projectId: data.projectId ?? null,
      invoiceId: data.invoiceId ?? null,
      contactId: data.contactId ?? null,
      direction: data.direction,
      channel: data.channel,
      subject: data.subject,
      sender: data.sender,
      recipients: data.recipients,
      body: data.body,
      matchedBy: data.matchedBy,
      isDraft: data.isDraft ?? false,
      authorId: (session!.user as any).id,
      refNumber: data.refNumber ?? null,
      stageAtSend: data.stageAtSend ?? currentStageForLog ?? null,
      messageId: data.messageId ?? null,
      ...(data.sentAt ? { sentAt: new Date(data.sentAt) } : {}),
    }).returning();

    // Fan-out inbound reply to all invoices that shared the original outbound email.
    // When a batch email covers multiple invoices (same refNumber), a customer reply
    // should appear in every affected invoice's chatbox, not just the one clicked.
    if (data.direction === "Inbound" && data.channel === "Email" && data.inReplyToRef) {
      const siblings = await db
        .select({ invoiceId: communications.invoiceId, projectId: communications.projectId })
        .from(communications)
        .where(and(
          eq(communications.orgId, orgId!),
          eq(communications.customerId, data.customerId),
          eq(communications.refNumber, data.inReplyToRef),
          eq(communications.direction, "Outbound"),
        ));
      const extraInvoiceIds = siblings
        .map(s => s.invoiceId)
        .filter((id): id is string => !!id && id !== (data.invoiceId ?? null));
      if (extraInvoiceIds.length > 0) {
        await db.insert(communications).values(
          extraInvoiceIds.map(invId => {
            const sib = siblings.find(s => s.invoiceId === invId);
            return {
              orgId: orgId!,
              customerId: data.customerId,
              projectId: sib?.projectId ?? null,
              invoiceId: invId,
              contactId: data.contactId ?? null,
              direction: "Inbound" as const,
              channel: "Email" as const,
              subject: data.subject,
              sender: data.sender,
              recipients: data.recipients,
              body: data.body,
              matchedBy: "thread-fanout",
              isDraft: false,
              refNumber: data.inReplyToRef,
              messageId: data.messageId ?? null,
              inReplyTo: created.id, // link back to the primary record
            };
          })
        );
      }
    }

    // Apply auto-stage to invoice
    if (autoStage && data.invoiceId) {
      const today = new Date().toISOString().slice(0, 10);
      await db.update(invoices)
        .set({ lastFollowupDate: today, collectionStage: autoStage, updatedAt: new Date() })
        .where(and(eq(invoices.id, data.invoiceId), eq(invoices.orgId, orgId!)));
    }

    // ── Audit log ─────────────────────────────────────────────────────────────
    const actorId   = (session?.user as any)?.id   ?? null;
    const actorName = (session?.user as any)?.name ?? null;

    if (data.channel === "Note") {
      await logEvent({
        orgId:      orgId!,
        eventType:  "note_added",
        customerId: data.customerId,
        projectId:  data.projectId ?? null,
        invoiceId:  data.invoiceId ?? null,
        actorId,
        actorName,
        meta: { body: data.body ?? "" },
      });
    } else if (data.channel === "Email" && data.direction === "Outbound" && !data.isDraft) {
      // Determine if this was an auto-sent reminder (subject contains "Reminder") or manual
      const isAuto = !!autoStage;
      await logEvent({
        orgId:      orgId!,
        eventType:  isAuto ? "email_sent" : "email_manual",
        customerId: data.customerId,
        projectId:  data.projectId ?? null,
        invoiceId:  data.invoiceId ?? null,
        actorId,
        actorName,
        meta: {
          subject:    data.subject ?? "",
          to:         data.recipients ?? "",
          from:       data.sender ?? "",
          stageAtSend: data.stageAtSend ?? currentStageForLog ?? "",
          autoStage:  autoStage ?? null,
        },
      });
    }

    return ok(created);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error(e);
    return bad("Failed to create communication", 500);
  }
}
