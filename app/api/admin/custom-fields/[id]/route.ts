/** Update / delete a CRM custom field definition. */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { crmFieldDefs } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/billing";
import { eq } from "drizzle-orm";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  const patch: any = { updatedAt: new Date() };
  if (body.label != null) patch.label = String(body.label).trim();
  if (body.required != null) patch.required = !!body.required;
  if (body.active != null) patch.active = !!body.active;
  if (body.sortOrder != null) patch.sortOrder = Number(body.sortOrder) || 0;
  if (body.options !== undefined) patch.options = Array.isArray(body.options) ? body.options.map((o: any) => String(o).trim()).filter(Boolean) : null;

  const [row] = await db.update(crmFieldDefs).set(patch).where(eq(crmFieldDefs.id, params.id)).returning();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ def: row });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  const [row] = await db.delete(crmFieldDefs).where(eq(crmFieldDefs.id, params.id)).returning();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
