/**
 * GET /api/admin/customers
 *
 * Unified billing + health workspace — one row per organisation with every
 * field needed to drive the merged Customers page:
 *   • Subscription state (Stripe + manual)
 *   • MRR, expiry, payment status
 *   • Account ref (PA-xxxxx) for display
 *   • All action fields (subId, stripeSubscriptionId, etc.)
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { organisations, subscriptions, users, userOrganisations, crmAccounts } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { requirePlatformAdmin } from "@/lib/billing";

function toMonthly(amount: number | null, interval: string | null): number {
  if (!amount) return 0;
  const major = amount / 100;
  return interval === "year" ? major / 12 : major;
}

function formatRef(refSeq: number | null): string | null {
  if (!refSeq) return null;
  return `PA-${String(refSeq).padStart(5, "0")}`;
}

export async function GET() {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const orgs = await db
    .select({ id: organisations.id, name: organisations.name, accountId: organisations.accountId, enabledModules: organisations.enabledModules })
    .from(organisations);

  const subs = await db.select().from(subscriptions);
  const subByOrg = new Map(subs.map(s => [s.orgId, s]));

  // Billing-contact email per org (first company_admin).
  const adminRows = await db
    .select({ orgId: userOrganisations.orgId, email: users.email })
    .from(userOrganisations)
    .innerJoin(users, eq(users.id, userOrganisations.userId))
    .where(eq(userOrganisations.role, "company_admin"));
  const emailByOrg = new Map<string, string>();
  for (const r of adminRows) if (!emailByOrg.has(r.orgId)) emailByOrg.set(r.orgId, r.email);

  // PA-xxxxx refs from crmAccounts.
  const accountIds = orgs.map(o => o.accountId).filter(Boolean) as string[];
  const refRows = accountIds.length
    ? await db.select({ id: crmAccounts.id, refSeq: crmAccounts.refSeq })
        .from(crmAccounts).where(inArray(crmAccounts.id, accountIds))
    : [];
  const refByAccountId = new Map(refRows.map(r => [r.id, r.refSeq]));

  const now = Date.now();

  const customers = orgs.map(o => {
    const s = subByOrg.get(o.id);
    const isActive = s
      ? s.source === "manual"
          ? (!s.manualExpiresAt || new Date(s.manualExpiresAt).getTime() > now)
          : (s.status === "active" || s.status === "trialing")
      : false;

    const interval = s?.planInterval ?? null;
    const renewsAt = s
      ? s.source === "manual" ? s.manualExpiresAt : s.currentPeriodEnd
      : null;

    const refSeq = o.accountId ? (refByAccountId.get(o.accountId) ?? null) : null;

    return {
      // identity
      orgId:      o.id,
      accountId:  o.accountId ?? null,
      accountRef: formatRef(refSeq),
      name:       o.name,
      email:      emailByOrg.get(o.id) ?? s?.billingEmail ?? null,
      enabledModules: Array.isArray(o.enabledModules) ? o.enabledModules as string[] : [],

      // subscription action fields
      subId:                 s?.id ?? null,
      stripeSubscriptionId:  s?.stripeSubscriptionId ?? null,
      stripeCustomerId:      s?.stripeCustomerId ?? null,

      // billing state
      hasSub:       !!s,
      source:       s?.source ?? null,
      status:       s ? (isActive ? (s.source === "manual" ? "active" : s.status) : s.status) : "none",
      isActive,
      cancelAtPeriodEnd: s?.cancelAtPeriodEnd ?? false,

      // plan
      planName:     s?.planName ?? null,
      planAmount:   s?.planAmount ?? null,
      planCurrency: (s?.planCurrency ?? "gbp").toUpperCase(),
      planInterval: interval,
      billing:      interval === "year" ? "Annual" : interval === "month" ? "Monthly" : (interval ? "Custom" : "—"),
      mrr:          isActive ? toMonthly(s?.planAmount ?? null, interval) : 0,
      renewsAt:     renewsAt ? new Date(renewsAt).getTime() : null,

      // payment
      lastPayment:       s?.lastPaymentDate ? new Date(s.lastPaymentDate).getTime() : null,
      lastPaymentStatus: s?.lastPaymentStatus ?? s?.manualPaymentStatus ?? null,
      lastPaymentAmount: s?.lastPaymentAmount ?? null,

      // manual-specific
      manualExpiresAt:     s?.manualExpiresAt ? new Date(s.manualExpiresAt).getTime() : null,
      manualPaymentStatus: s?.manualPaymentStatus ?? null,
      manualInvoiceRef:    s?.manualInvoiceRef ?? null,
      manualNotes:         s?.manualNotes ?? null,
      billingEmail:        s?.billingEmail ?? null,
      planAmountRaw:       s?.planAmount ?? null, // minor units for edit modal
    };
  });

  customers.sort((a, b) => (Number(b.isActive) - Number(a.isActive)) || a.name.localeCompare(b.name));

  const totalMrr = customers.reduce((s, c) => s + c.mrr, 0);
  const stripeActive  = customers.filter(c => c.source === "stripe" && c.isActive).length;
  const manualActive  = customers.filter(c => c.source === "manual" && c.isActive).length;
  const expiringCount = customers.filter(c => {
    if (c.source !== "manual" || !c.manualExpiresAt) return false;
    const d = Math.ceil((c.manualExpiresAt - now) / 86_400_000);
    return d >= 0 && d <= 7;
  }).length;

  return NextResponse.json({
    customers,
    summary: {
      total: customers.length,
      active: customers.filter(c => c.isActive).length,
      stripeActive,
      manualActive,
      expiringCount,
      totalMrr,
      currency: customers.find(c => c.mrr > 0)?.planCurrency ?? "GBP",
    },
  });
}
