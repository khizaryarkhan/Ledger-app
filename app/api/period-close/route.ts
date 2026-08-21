/**
 * GET  /api/period-close   → fiscal-period status + close history
 * POST /api/period-close   → { action: "close", periodEnd } | { action: "reopen", id }
 *
 * Outside /api/accounting to avoid the [entity] dynamic-route collision.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { periodStatus, closePeriod, reopenPeriod } from "@/lib/accounting/period-close";
import { LedgerValidationError } from "@/lib/ledger";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  return ok(await periodStatus(orgId!));
}

export async function POST(req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);

  const body = await req.json().catch(() => ({}));
  const actorId = (session?.user as any)?.id ?? null;

  try {
    if (body?.action === "close") {
      return ok(await closePeriod(orgId!, String(body.periodEnd ?? ""), actorId));
    }
    if (body?.action === "reopen") {
      return ok(await reopenPeriod(orgId!, String(body.id ?? ""), actorId));
    }
    return bad("Unknown action");
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[period-close] failed:", e);
    return bad("Failed to process period close", 500);
  }
}
