/**
 * Admin — full billing record for one organisation.
 *
 * GET /api/admin/billing/org/:orgId   (platform/super admin)
 *
 * Returns the org, its subscription, every Stripe invoice for its customer,
 * payment history (paid invoices), computed MRR and billing stats. One call
 * powers the org billing detail page.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { organisations, subscriptions, users, userOrganisations } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { stripe } from "@/lib/stripe";
import { requirePlatformAdmin } from "@/lib/billing";

export const maxDuration = 60;

/** Normalise a plan amount (smallest unit) to a monthly figure for MRR. */
function toMonthly(amount: number | null, interval: string | null): number {
  if (!amount) return 0;
  if (interval === "year") return Math.round(amount / 12);
  return amount; // month / custom → treat as monthly
}

export async function GET(_req: Request, { params }: { params: { orgId: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const [org] = await db
    .select({ id: organisations.id, name: organisations.name, slug: organisations.slug, enabledModules: organisations.enabledModules })
    .from(organisations)
    .where(eq(organisations.id, params.orgId))
    .limit(1);
  if (!org) return NextResponse.json({ error: "Organisation not found" }, { status: 404 });

  // CRM link: the lead this customer originated from (via its opportunity), so the
  // Customers page can open the same unified company 360. (Phase 0 unification.)
  let crmLeadId: string | null = null;
  try {
    const { opportunities } = await import("@/db/schema");
    const [opp] = await db.select({ leadId: opportunities.leadId }).from(opportunities)
      .where(eq(opportunities.orgId, params.orgId)).limit(1);
    crmLeadId = opp?.leadId ?? null;
  } catch { /* opportunities table may not exist */ }

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.orgId, params.orgId))
    .limit(1);

  // Org admins (for context / billing contact).
  const admins = await db
    .select({ name: users.name, email: users.email, role: users.role })
    .from(userOrganisations)
    .innerJoin(users, eq(users.id, userOrganisations.userId))
    .where(and(eq(userOrganisations.orgId, params.orgId), eq(userOrganisations.role, "company_admin")))
    .limit(5);

  // Invoices for this org's Stripe customer.
  let invoices: any[] = [];
  if (sub?.stripeCustomerId) {
    try {
      const list = await stripe.invoices.list({ customer: sub.stripeCustomerId, limit: 100 });
      invoices = list.data.map((inv: any) => {
        const isSubscription = !!(inv.subscription ?? inv.parent?.subscription_details?.subscription);
        const interval: string | null = inv.lines?.data?.[0]?.price?.recurring?.interval ?? null;
        const m = inv.metadata ?? {};
        return {
          id: inv.id, number: inv.number, status: inv.status,
          total: inv.total, amountDue: inv.amount_due, amountPaid: inv.amount_paid,
          currency: (inv.currency || "eur").toUpperCase(),
          created: inv.created ? inv.created * 1000 : null,
          dueDate: inv.due_date ? inv.due_date * 1000 : null,
          paidAt: inv.status_transitions?.paid_at ? inv.status_transitions.paid_at * 1000 : null,
          receivedDate: m.paid_received_date || null,
          hostedInvoiceUrl: inv.hosted_invoice_url, invoicePdf: inv.invoice_pdf,
          isSubscription,
          billingLabel: isSubscription ? (interval === "year" ? "Annual" : interval === "month" ? "Monthly" : "Recurring") : "One-off",
          paidMethod: m.paid_method ?? null, paidOutOfBand: m.paid_out_of_band === "true",
          refunded: m.refunded === "true",
        };
      });
    } catch (e: any) {
      console.error("[admin/billing/org] stripe list:", e?.message);
    }
  }

  // Credit notes (refunds/adjustments against invoices).
  let creditNotes: any[] = [];
  if (sub?.stripeCustomerId) {
    try {
      const cn = await stripe.creditNotes.list({ customer: sub.stripeCustomerId, limit: 100 });
      creditNotes = cn.data.map((c: any) => ({
        id: c.id, number: c.number, total: c.total,
        currency: (c.currency || "eur").toUpperCase(),
        created: c.created ? c.created * 1000 : null,
        status: c.status, reason: c.reason,
        invoiceId: typeof c.invoice === "string" ? c.invoice : c.invoice?.id ?? null,
        memo: c.memo ?? null, pdf: c.pdf ?? null,
      }));
    } catch (e: any) {
      console.error("[admin/billing/org] credit notes:", e?.message);
    }
  }

  // Stats.
  const billable = invoices.filter(i => i.status !== "draft" && i.status !== "void");
  const totalBilled = billable.reduce((s, i) => s + (i.total || 0), 0);
  const totalPaid   = invoices.reduce((s, i) => s + (i.amountPaid || 0), 0);
  const outstanding = invoices.filter(i => i.status === "open").reduce((s, i) => s + (i.amountDue || 0), 0);

  const now = Date.now();
  const isActive = sub
    ? (sub.source === "manual"
        ? (!sub.manualExpiresAt || new Date(sub.manualExpiresAt).getTime() > now)
        : (sub.status === "active" || sub.status === "trialing"))
    : false;
  const mrr = isActive ? toMonthly(sub!.planAmount, sub!.planInterval) : 0;

  const currency = (sub?.planCurrency || invoices[0]?.currency || "GBP").toUpperCase();

  // Payment history = paid invoices, newest first.
  const payments = invoices
    .filter(i => i.status === "paid")
    .map(i => ({
      date: i.receivedDate ? new Date(i.receivedDate).getTime() : i.paidAt,
      amount: i.amountPaid || i.total, currency: i.currency,
      method: i.paidOutOfBand ? (i.paidMethod ?? "offline") : "stripe",
      invoiceNumber: i.number, invoiceId: i.id, refunded: i.refunded,
    }))
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0));

  return NextResponse.json({
    org,
    crmLeadId,
    admins,
    subscription: sub
      ? {
          id: sub.id, source: sub.source, status: sub.status,
          planName: sub.planName, planAmount: sub.planAmount, planCurrency: sub.planCurrency, planInterval: sub.planInterval,
          billingEmail: sub.billingEmail,
          currentPeriodEnd: sub.currentPeriodEnd, manualExpiresAt: sub.manualExpiresAt,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd, stripeCustomerId: sub.stripeCustomerId,
          isActive,
        }
      : null,
    invoices: invoices.sort((a, b) => (b.created ?? 0) - (a.created ?? 0)),
    payments,
    creditNotes,
    stats: { totalBilled, totalPaid, outstanding, mrr, currency },
  });
}
