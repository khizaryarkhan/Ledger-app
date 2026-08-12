/**
 * CRM custom field definitions.
 * GET  ?entity=account|lead|contact (optional) → definitions, sorted.
 * POST → create a definition.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { crmFieldDefs } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/billing";
import { and, eq, asc } from "drizzle-orm";

const ENTITIES = new Set(["account", "lead", "contact"]);
const TYPES = new Set(["text", "textarea", "number", "money", "date", "select", "multiselect", "boolean", "url", "email", "phone"]);
const slugify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64) || "field";

export async function GET(req: NextRequest) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  const entity = new URL(req.url).searchParams.get("entity");
  const where = entity ? eq(crmFieldDefs.entity, entity) : undefined;
  const defs = await db.select().from(crmFieldDefs).where(where as any).orderBy(asc(crmFieldDefs.entity), asc(crmFieldDefs.sortOrder), asc(crmFieldDefs.label));
  return NextResponse.json({ defs });
}

export async function POST(req: NextRequest) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  const body = await req.json().catch(() => null);
  const entity = String(body?.entity ?? "");
  const label = String(body?.label ?? "").trim();
  const fieldType = String(body?.fieldType ?? "text");
  if (!ENTITIES.has(entity)) return NextResponse.json({ error: "Invalid entity" }, { status: 400 });
  if (!label) return NextResponse.json({ error: "Label is required" }, { status: 400 });
  if (!TYPES.has(fieldType)) return NextResponse.json({ error: "Invalid field type" }, { status: 400 });

  const fieldKey = slugify(body?.fieldKey || label);
  const [dupe] = await db.select({ id: crmFieldDefs.id }).from(crmFieldDefs)
    .where(and(eq(crmFieldDefs.entity, entity), eq(crmFieldDefs.fieldKey, fieldKey))).limit(1);
  if (dupe) return NextResponse.json({ error: `A field with key "${fieldKey}" already exists on ${entity}` }, { status: 409 });

  const options = Array.isArray(body?.options) ? body.options.map((o: any) => String(o).trim()).filter(Boolean) : null;
  const [def] = await db.insert(crmFieldDefs).values({
    entity, fieldKey, label, fieldType,
    options: (fieldType === "select" || fieldType === "multiselect") ? options : null,
    required: !!body?.required,
    sortOrder: Number(body?.sortOrder) || 0,
  }).returning();
  return NextResponse.json({ def });
}
