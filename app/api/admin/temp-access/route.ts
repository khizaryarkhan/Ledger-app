import { NextResponse } from "next/server";
import { db } from "@/db";
import { tempAccessRequests, organisations, users } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/billing";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";

export async function GET() {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const rows = await db
    .select({
      id:                tempAccessRequests.id,
      status:            tempAccessRequests.status,
      reason:            tempAccessRequests.reason,
      requestedByEmail:  tempAccessRequests.requestedByEmail,
      expiresAt:         tempAccessRequests.expiresAt,
      adminNotes:        tempAccessRequests.adminNotes,
      reviewedAt:        tempAccessRequests.reviewedAt,
      createdAt:         tempAccessRequests.createdAt,
      orgName:           organisations.name,
      orgSlug:           organisations.slug,
    })
    .from(tempAccessRequests)
    .leftJoin(organisations, eq(organisations.id, tempAccessRequests.orgId))
    .orderBy(desc(tempAccessRequests.createdAt));

  return NextResponse.json({ requests: rows });
}

// POST — an admin PROACTIVELY grants access to an org (comp / non-payment
// grace), without waiting for the org to request it. Creates an already-
// approved grant that the billing gate honours immediately. Stripe billing
// state is left untouched (it stays the source of truth); this is a separate,
// audited entitlement override the admin can revoke.
const grantSchema = z.object({
  orgId:      z.string().uuid(),
  daysAccess: z.number().int().min(1).max(3650),   // up to ~10y for long-term comps
  notes:      z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;

  const parsed = grantSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "orgId and daysAccess (1-3650) are required" }, { status: 400 });
  const { orgId, daysAccess, notes } = parsed.data;

  const [org] = await db.select({ id: organisations.id }).from(organisations).where(eq(organisations.id, orgId)).limit(1);
  if (!org) return NextResponse.json({ error: "Organisation not found" }, { status: 404 });

  const now = new Date();
  const [row] = await db.insert(tempAccessRequests).values({
    orgId,
    status:            "approved",
    reason:            "Access granted by admin",
    reviewedByAdminId: userId ?? null,
    reviewedAt:        now,
    expiresAt:         new Date(now.getTime() + daysAccess * 86_400_000),
    adminNotes:        notes ?? null,
    createdAt:         now,
    updatedAt:         now,
  }).returning({ id: tempAccessRequests.id, expiresAt: tempAccessRequests.expiresAt });

  return NextResponse.json({ ok: true, id: row.id, expiresAt: row.expiresAt });
}
