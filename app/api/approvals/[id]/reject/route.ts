/** POST /api/approvals/[id]/reject → mark a pending request Rejected. No posting. */

import { db } from "@/db";
import { pendingApprovals } from "@/db/schema";
import { requireOrg, ok, bad, requireRole } from "@/lib/api";
import { and, eq } from "drizzle-orm";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (!role || !requireRole(role, "company_admin")) return bad("Admins only", 403);
  const body = await req.json().catch(() => ({}));
  const reason = String(body?.reason ?? "").trim();
  if (!reason) return bad("A reason is required to reject a request");

  const [pending] = await db.select().from(pendingApprovals)
    .where(and(eq(pendingApprovals.id, params.id), eq(pendingApprovals.orgId, orgId!))).limit(1);
  if (!pending) return bad("Approval request not found", 404);
  if (pending.status !== "Pending") return bad("This request has already been decided", 409);

  await db.update(pendingApprovals).set({
    status: "Rejected", approvedBy: (session?.user as any)?.id ?? null, approvedAt: new Date(), rejectedReason: reason,
  }).where(and(eq(pendingApprovals.id, pending.id), eq(pendingApprovals.orgId, orgId!)));
  return ok({ rejected: true });
}
