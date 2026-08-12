/**
 * CRM custom field VALUES for one record.
 * GET  ?entity=&entityId= → active defs for that entity + the record's values.
 * POST { entity, entityId, values: { [defId]: value } } → upsert (null clears).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { crmFieldDefs, crmFieldValues } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/billing";
import { and, eq, asc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  const url = new URL(req.url);
  const entity = url.searchParams.get("entity") || "";
  const entityId = url.searchParams.get("entityId") || "";
  if (!entity || !entityId) return NextResponse.json({ error: "entity and entityId required" }, { status: 400 });

  const defs = await db.select().from(crmFieldDefs)
    .where(and(eq(crmFieldDefs.entity, entity), eq(crmFieldDefs.active, true)))
    .orderBy(asc(crmFieldDefs.sortOrder), asc(crmFieldDefs.label));
  const vals = await db.select().from(crmFieldValues)
    .where(and(eq(crmFieldValues.entity, entity), eq(crmFieldValues.entityId, entityId)));
  const byDef: Record<string, any> = {};
  for (const v of vals) byDef[v.defId] = v.value;
  return NextResponse.json({ defs, values: byDef });
}

export async function POST(req: NextRequest) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  const body = await req.json().catch(() => null);
  const entity = String(body?.entity ?? "");
  const entityId = String(body?.entityId ?? "");
  const values = body?.values && typeof body.values === "object" ? body.values : null;
  if (!entity || !entityId || !values) return NextResponse.json({ error: "entity, entityId, values required" }, { status: 400 });

  for (const [defId, value] of Object.entries(values)) {
    const [existing] = await db.select({ id: crmFieldValues.id }).from(crmFieldValues)
      .where(and(eq(crmFieldValues.defId, defId), eq(crmFieldValues.entityId, entityId))).limit(1);
    const isEmpty = value == null || value === "" || (Array.isArray(value) && value.length === 0);
    if (isEmpty) {
      if (existing) await db.delete(crmFieldValues).where(eq(crmFieldValues.id, existing.id));
    } else if (existing) {
      await db.update(crmFieldValues).set({ value: value as any, updatedAt: new Date() }).where(eq(crmFieldValues.id, existing.id));
    } else {
      await db.insert(crmFieldValues).values({ defId, entity, entityId, value: value as any });
    }
  }
  return NextResponse.json({ saved: true });
}
