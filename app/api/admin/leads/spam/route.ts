/**
 * Spam-lead cleanup.
 * GET  → active landing_page leads that look like spam (score ≥ 3, for review),
 *        each with its fields + score, worst first.
 * POST { ids[], action: "reject" | "delete" } →
 *        reject = mark rejected (safe, reversible, off the board);
 *        delete = remove the lead rows and any now-orphaned spam account
 *                 (a crmAccount with no org and no remaining leads).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { landingPageRequests, crmAccounts } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/billing";
import { and, eq, inArray, notInArray, desc } from "drizzle-orm";
import { spamScore } from "@/lib/spam";

const OFF = ["rejected", "archived", "converted"]; // exclude already-parked/won

export async function GET() {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const rows = await db.select({
    id: landingPageRequests.id, fullName: landingPageRequests.fullName, email: landingPageRequests.email,
    phone: landingPageRequests.phone, companyName: landingPageRequests.companyName, country: landingPageRequests.country,
    message: landingPageRequests.message, status: landingPageRequests.status, createdAt: landingPageRequests.createdAt,
  }).from(landingPageRequests)
    .where(and(eq(landingPageRequests.source, "landing_page"), notInArray(landingPageRequests.status, OFF)))
    .orderBy(desc(landingPageRequests.createdAt))
    .limit(2000);

  const flagged = rows
    .map((r) => ({ ...r, score: spamScore(r) }))
    .filter((r) => r.score >= 3)
    .sort((a, b) => b.score - a.score);

  return NextResponse.json({ leads: flagged, scanned: rows.length });
}

export async function POST(req: NextRequest) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  const body = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.map(String) : [];
  const action = body?.action === "delete" ? "delete" : "reject";
  if (ids.length === 0) return NextResponse.json({ error: "No leads selected" }, { status: 400 });

  if (action === "reject") {
    await db.update(landingPageRequests).set({ status: "rejected", updatedAt: new Date() }).where(inArray(landingPageRequests.id, ids));
    return NextResponse.json({ rejected: ids.length });
  }

  // delete: grab the affected accounts first, delete the leads, then purge
  // accounts that are now orphaned (no org, no remaining leads).
  const leads = await db.select({ id: landingPageRequests.id, accountId: landingPageRequests.accountId })
    .from(landingPageRequests).where(inArray(landingPageRequests.id, ids));
  const accountIds = [...new Set(leads.map((l) => l.accountId).filter(Boolean) as string[])];

  await db.delete(landingPageRequests).where(inArray(landingPageRequests.id, ids)).catch(() => {});

  let accountsPurged = 0;
  for (const acctId of accountIds) {
    try {
      const [acct] = await db.select({ id: crmAccounts.id, organisationId: crmAccounts.organisationId }).from(crmAccounts).where(eq(crmAccounts.id, acctId)).limit(1);
      if (!acct || acct.organisationId) continue;                         // keep real/customer accounts
      const remaining = await db.select({ id: landingPageRequests.id }).from(landingPageRequests).where(eq(landingPageRequests.accountId, acctId)).limit(1);
      if (remaining.length === 0) { await db.delete(crmAccounts).where(eq(crmAccounts.id, acctId)); accountsPurged++; }
    } catch { /* leave the account if anything references it */ }
  }
  return NextResponse.json({ deleted: ids.length, accountsPurged });
}
