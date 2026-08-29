/**
 * GET  /api/settings/approval-thresholds → all four entity types' configured
 *      threshold (defaults shown for any not yet configured — Job Work
 *      dispatch defaults to always-required, the other three to no gate).
 * PUT  /api/settings/approval-thresholds → upsert one entity type's setting.
 */

import { db } from "@/db";
import { approvalThresholds } from "@/db/schema";
import { requireOrg, ok, bad, requireRole } from "@/lib/api";
import { and, eq } from "drizzle-orm";

const ENTITY_TYPES = ["jobwork_dispatch", "production_build", "goods_receipt", "shipment"] as const;

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const rows = await db.select().from(approvalThresholds).where(eq(approvalThresholds.orgId, orgId!));
  const byType = new Map(rows.map(r => [r.entityType, r]));
  return ok(ENTITY_TYPES.map(t => {
    const r = byType.get(t);
    return {
      entityType: t,
      thresholdAmount: r?.thresholdAmount != null ? Number(r.thresholdAmount) : null,
      alwaysRequire: r?.alwaysRequire ?? (t === "jobwork_dispatch"),
    };
  }));
}

export async function PUT(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!role || !requireRole(role, "company_admin")) return bad("Admins only", 403);
  const body = await req.json().catch(() => ({}));
  const entityType = String(body?.entityType ?? "");
  if (!ENTITY_TYPES.includes(entityType as any)) return bad("Unknown entity type");
  const thresholdAmount = body?.thresholdAmount == null || body.thresholdAmount === "" ? null : Number(body.thresholdAmount);
  const alwaysRequire = !!body?.alwaysRequire;

  await db.insert(approvalThresholds).values({
    orgId: orgId!, entityType, thresholdAmount: thresholdAmount != null ? thresholdAmount.toFixed(2) : null, alwaysRequire,
  } as any).onConflictDoUpdate({
    target: [approvalThresholds.orgId, approvalThresholds.entityType],
    set: { thresholdAmount: thresholdAmount != null ? thresholdAmount.toFixed(2) : null, alwaysRequire, updatedAt: new Date() },
  });
  return ok({ saved: true });
}
