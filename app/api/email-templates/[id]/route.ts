/**
 * PATCH  /api/email-templates/[id]  — update a template
 * DELETE /api/email-templates/[id]  — delete a template
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { emailTemplates } from "@/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { requireOrg } from "@/lib/api";
import { z } from "zod";

const PatchSchema = z.object({
  name:             z.string().min(1).max(255).optional(),
  subject:          z.string().min(1).max(512).optional(),
  body:             z.string().min(1).optional(),
  collectionStage:  z.string().max(64).nullable().optional(),
  isActive:         z.boolean().optional(),
  isDefault:        z.boolean().optional(),
  sendIntervalDays: z.number().int().min(1).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const raw = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  // When marking a template as default, clear the flag on all others first.
  if (parsed.data.isDefault === true) {
    await db
      .update(emailTemplates)
      .set({ isDefault: false })
      .where(and(eq(emailTemplates.orgId, orgId!), ne(emailTemplates.id, params.id)));
  }

  const [updated] = await db
    .update(emailTemplates)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(emailTemplates.id, params.id), eq(emailTemplates.orgId, orgId!)))
    .returning();

  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  await db
    .delete(emailTemplates)
    .where(and(eq(emailTemplates.id, params.id), eq(emailTemplates.orgId, orgId!)));

  return NextResponse.json({ ok: true });
}
