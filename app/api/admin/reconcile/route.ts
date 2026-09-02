/**
 * GET /api/admin/reconcile[?orgId=]
 *
 * Runs the accounting-foundation reconciliation (lib/accounting/reconcile.ts)
 * INSIDE the deployed app, so it always sees the real production database
 * without anyone copying credentials to a laptop. Platform-admin only.
 */

import { requirePlatformAdmin } from "@/lib/billing";
import { NextResponse } from "next/server";
import { reconcileAll } from "@/lib/accounting/reconcile";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: Request) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const orgId = new URL(req.url).searchParams.get("orgId");
  try {
    const orgs = await reconcileAll(orgId);
    return NextResponse.json({
      orgs,
      totals: {
        orgs: orgs.length,
        failing: orgs.filter(o => o.failures > 0).length,
        failures: orgs.reduce((s, o) => s + o.failures, 0),
      },
    });
  } catch (e: any) {
    console.error("[reconcile]", e);
    return NextResponse.json({ error: e?.message || "Reconciliation failed" }, { status: 500 });
  }
}
