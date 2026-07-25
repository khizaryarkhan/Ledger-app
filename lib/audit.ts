/**
 * Track & Trace — append-only audit event log.
 * logEvent() is always wrapped in try/catch so logging NEVER breaks primary actions.
 */
import { db } from "@/db";
import { auditEvents } from "@/db/schema";

export type EventType =
  // ── Receivables ──────────────────────────────────────────────────────────
  | "email_sent"       // automated reminder email dispatched
  | "email_manual"     // manually composed email sent
  | "note_added"       // internal note added
  | "stage_changed"    // collection stage changed on invoice
  | "payment_recorded" // payment (full or partial) posted
  | "promise_to_pay"   // promise-to-pay date set/updated
  | "dispute_raised"   // dispute reason set
  | "programme_toggled"   // auto-reminder programme on/off
  | "chase_mode_changed"  // customer chase level changed (customer ↔ project)
  | "invoice_synced"   // QBO sync created/updated this invoice
  | "contact_updated"  // contact details changed
  | "user_login"               // a user authenticated
  | "user_deactivated"         // a user's access was removed/deactivated
  | "user_role_changed"        // a user's role was changed
  | "user_password_reset"      // an admin reset a user's password (link or manual)
  | "integration_connected"    // QBO/Xero/Gmail/MS connection established
  | "integration_disconnected" // QBO/Xero/Gmail/MS connection removed
  | "data_exported"            // audit trail / report exported
  // ── Payables / Procurement ───────────────────────────────────────────────
  | "purchase_request_created"
  | "purchase_request_submitted"
  | "purchase_request_approved"
  | "purchase_request_rejected"
  | "purchase_order_created"
  | "purchase_order_submitted"
  | "purchase_order_approved"
  | "purchase_order_rejected"
  | "purchase_order_pushed"
  | "purchase_order_push_failed"
  | "bill_synced"
  | "bill_reviewed"
  | "bill_approved"
  | "bill_rejected"
  | "bill_on_hold"
  | "bill_ready_for_payment"
  | "bill_approval_note_pushed"
  | "supplier_query_created"
  | "supplier_query_resolved"
  | "payment_run_created"
  | "payment_run_submitted"
  | "payment_run_approved"
  | "payment_run_scheduled"
  | "payables_master_data_synced";

export interface LogEventArgs {
  orgId: string;
  eventType: EventType;
  customerId?: string | null;
  projectId?: string | null;
  invoiceId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  meta?: Record<string, unknown>;
}

export async function logEvent(args: LogEventArgs): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      orgId:      args.orgId,
      eventType:  args.eventType,
      customerId: args.customerId  ?? null,
      projectId:  args.projectId  ?? null,
      invoiceId:  args.invoiceId  ?? null,
      actorId:    args.actorId    ?? null,
      actorName:  args.actorName  ?? null,
      meta:       (args.meta      ?? {}) as any,
      occurredAt: new Date(),
    });
  } catch (e) {
    // Logging must never break the primary action
    console.error("[audit] logEvent failed:", e);
  }
}
