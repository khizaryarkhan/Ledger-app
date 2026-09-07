/**
 * Admin — generate a fresh invoice for an EXISTING Stripe subscription.
 *
 * POST /api/admin/subscriptions/:id/create-invoice
 *
 * For when a subscription's original invoice was voided (e.g. it was
 * finalised with a stale customer name/address) and needs a replacement —
 * without spinning up a second, duplicate subscription. Reuses the same
 * stripeSubscriptionId, so it bills the same recurring price already on the
 * subscription; the new invoice picks up whatever the Stripe Customer's
 * current name/address is at the moment it's created.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { stripe } from "@/lib/stripe";
import { requirePlatformAdmin, logBillingEvent } from "@/lib/billing";

export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;

  const [sub] = await db
    .select({ id: subscriptions.id, orgId: subscriptions.orgId, source: subscriptions.source, stripeCustomerId: subscriptions.stripeCustomerId, stripeSubscriptionId: subscriptions.stripeSubscriptionId })
    .from(subscriptions).where(eq(subscriptions.id, params.id)).limit(1);

  if (!sub) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (sub.source !== "stripe" || !sub.stripeSubscriptionId || !sub.stripeCustomerId) {
    return NextResponse.json({ error: "Not a Stripe subscription" }, { status: 400 });
  }

  try {
    // A subscription created with payment_behavior:'default_incomplete'
    // (our normal path — see create-invoice route) is auto-cancelled by
    // Stripe itself if its defining first invoice is voided rather than
    // paid — there is then no subscription left to attach a new invoice to.
    // Detect that up front and point at the real fix (a fresh subscription)
    // instead of surfacing Stripe's confusing raw "does not have a
    // subscription with ID ..." error.
    let stripeSub;
    try {
      stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
    } catch (e: any) {
      await db.update(subscriptions).set({ status: "canceled", stripeUpdatedAt: new Date() }).where(eq(subscriptions.id, sub.id));
      return NextResponse.json({ error: "This subscription no longer exists in Stripe — it was auto-cancelled when its original invoice was voided. Use \"Create Stripe invoice\" from the Customers list to start a fresh subscription for this org instead." }, { status: 400 });
    }
    if (stripeSub.status === "canceled" || stripeSub.status === "incomplete_expired") {
      await db.update(subscriptions).set({ status: stripeSub.status, stripeUpdatedAt: new Date() }).where(eq(subscriptions.id, sub.id));
      return NextResponse.json({ error: `This subscription is ${stripeSub.status} in Stripe and can't take a new invoice. Use "Create Stripe invoice" from the Customers list to start a fresh subscription for this org instead.` }, { status: 400 });
    }

    // Refuse if there's already an open/draft invoice for this subscription —
    // avoid double-billing the same period. Void the existing one first.
    const existing = await stripe.invoices.list({ subscription: sub.stripeSubscriptionId, limit: 5 });
    const blocking = existing.data.find(i => i.status === "open" || i.status === "draft");
    if (blocking) {
      return NextResponse.json({ error: `Invoice ${blocking.number ?? blocking.id} for this subscription is still ${blocking.status} — void it first.` }, { status: 400 });
    }

    const draft = await stripe.invoices.create({
      customer:     sub.stripeCustomerId,
      subscription: sub.stripeSubscriptionId,
      auto_advance: true,
      metadata:     { orgId: sub.orgId, createdBy: userId ?? "", kind: "regenerated" },
    });
    const invoice = await stripe.invoices.finalizeInvoice(draft.id);

    await logBillingEvent({
      organizationId: sub.orgId, actorUserId: userId,
      action: "invoice_regenerated",
      metadata: { invoiceId: invoice.id, stripeSubscriptionId: sub.stripeSubscriptionId, total: invoice.total },
    });

    return NextResponse.json({
      ok: true,
      invoiceId: invoice.id,
      number: invoice.number ?? null,
      total: invoice.total ?? 0,
      status: invoice.status,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      invoicePdf: invoice.invoice_pdf ?? null,
    });
  } catch (e: any) {
    console.error("[admin/subscriptions/create-invoice]", e?.message || e);
    return NextResponse.json({ error: e?.message || "Stripe error" }, { status: 502 });
  }
}
