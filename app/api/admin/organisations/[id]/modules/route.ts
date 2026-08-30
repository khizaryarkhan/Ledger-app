/**
 * PATCH /api/admin/organisations/[id]/modules
 *
 * Assign which product modules an org has access to — see lib/modules.ts.
 * Platform-admin only: this is an onboarding/sales decision (which vertical
 * an org has bought into), not a self-service org setting.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { organisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requirePlatformAdmin, logBillingEvent } from "@/lib/billing";
import { MODULE_KEYS, type ModuleKey } from "@/lib/modules";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const enabledModules = body?.enabledModules;
  if (!Array.isArray(enabledModules) || enabledModules.some((k) => !(MODULE_KEYS as readonly string[]).includes(k))) {
    return NextResponse.json({ error: `enabledModules must be an array of: ${MODULE_KEYS.join(", ")}` }, { status: 400 });
  }

  const [org] = await db.select({ id: organisations.id }).from(organisations).where(eq(organisations.id, params.id)).limit(1);
  if (!org) return NextResponse.json({ error: "Organisation not found" }, { status: 404 });

  await db.update(organisations).set({ enabledModules: enabledModules as ModuleKey[] }).where(eq(organisations.id, params.id));

  await logBillingEvent({
    organizationId: params.id,
    actorUserId:    userId,
    action:         "organisation_modules_updated",
    metadata:       { enabledModules },
  }).catch(() => {});

  return NextResponse.json({ ok: true, enabledModules });
}
