import { db } from "@/db";
import { contacts, customers, projects } from "@/db/schema";
import { requireOrg, requireReadScope, ok, bad, ownsInOrg } from "@/lib/api";
import { z } from "zod";
import { eq, and, isNull, inArray } from "drizzle-orm";

const Schema = z.object({
  customerId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(255),
  title: z.string().optional(),
  email: z.string().min(1).refine(
    (v) => v.split(",").map((e) => e.trim()).every((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)),
    { message: "One or more email addresses are invalid" }
  ),
  phone: z.string().optional(),
  type: z.enum(["Billing", "Finance", "Project", "Escalation", "Legal", "Other"]).default("Billing"),
  isPrimary: z.boolean().default(false),
  isEscalation: z.boolean().default(false),
  receivesAuto: z.boolean().default(true),
});

export async function GET(req: Request) {
  const { error, orgIds } = await requireReadScope();
  if (error) return error;
  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId");
  const projectId = searchParams.get("projectId");
  if (projectId) return ok(await db.select().from(contacts).where(and(inArray(contacts.orgId, orgIds), eq(contacts.projectId, projectId))));
  if (customerId) return ok(await db.select().from(contacts).where(and(inArray(contacts.orgId, orgIds), eq(contacts.customerId, customerId))));
  return ok(await db.select().from(contacts).where(inArray(contacts.orgId, orgIds)));
}

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  try {
    const data = Schema.parse(await req.json());
    if (!(await ownsInOrg(customers, data.customerId, orgId!))) return bad("Customer not found in this organisation", 404);
    if (!(await ownsInOrg(projects, data.projectId, orgId!)))   return bad("Project not found in this organisation", 404);
    const [created] = await db.insert(contacts).values({
      orgId: orgId!,
      customerId: data.customerId,
      projectId: data.projectId ?? null,
      name: data.name,
      title: data.title,
      email: data.email,
      phone: data.phone,
      type: data.type ?? "Billing",
      isPrimary: data.isPrimary ?? false,
      isEscalation: data.isEscalation ?? false,
      receivesAuto: data.receivesAuto ?? true,
    }).returning();
    return ok(created);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    return bad("Failed to create contact", 500);
  }
}
