/**
 * Admin — update the Stripe Customer record's display name for an org.
 *
 * PATCH /api/admin/billing/org/:orgId/customer
 *   { name }
 *
 * Only touches the Stripe Customer object (name shown on the Stripe dashboard
 * and used as the default for any FUTURE invoice generated for this customer).
 * Stripe snapshots the customer's name onto an invoice at creation/finalize
 * time — this does NOT rewrite the name on invoices that already exist.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { stripe } from "@/lib/stripe";
import { requirePlatformAdmin, logBillingEvent } from "@/lib/billing";

export const maxDuration = 30;

const schema = z.object({ name: z.string().trim().min(1).max(255) });

export async function PATCH(req: Request, { params }: { params: { orgId: string } }) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });

  const [sub] = await db
    .select({ id: subscriptions.id, stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.orgId, params.orgId))
    .limit(1);
  if (!sub?.stripeCustomerId) {
    return NextResponse.json({ error: "No Stripe customer for this organisation yet" }, { status: 400 });
  }

  try {
    const customer = await stripe.customers.update(sub.stripeCustomerId, { name: parsed.data.name });
    await logBillingEvent({
      organizationId: params.orgId, actorUserId: userId,
      action: "stripe_customer_renamed",
      metadata: { stripeCustomerId: sub.stripeCustomerId, name: parsed.data.name },
    });
    return NextResponse.json({ ok: true, name: customer.name });
  } catch (e: any) {
    console.error("[admin/billing/org/customer]", e?.message || e);
    return NextResponse.json({ error: e?.message || "Stripe error" }, { status: 502 });
  }
}
