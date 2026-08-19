import { db } from "@/db";
import { tasks, customers, invoices } from "@/db/schema";
import { requireOrg, requireReadScope, ok, bad, ownsInOrg, userInOrg } from "@/lib/api";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";

const Schema = z.object({
  customerId: z.string().uuid().nullable().optional(),
  invoiceId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(512),
  description: z.string().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: z.string().optional(),
  priority: z.enum(["Low", "Medium", "High", "Urgent"]).default("Medium"),
  labels: z.array(z.string()).default([]),
});

export async function GET(req: Request) {
  const { error, orgIds } = await requireReadScope();
  if (error) return error;
  const { searchParams } = new URL(req.url);
  const invoiceId = searchParams.get("invoiceId");
  const customerId = searchParams.get("customerId");
  // Build a single AND predicate so the orgId filter is never overwritten by a
  // second .where() call (Drizzle's $dynamic().where() replaces, not appends).
  const orgFilter = inArray(tasks.orgId, orgIds);
  const where = invoiceId
    ? and(orgFilter, eq(tasks.invoiceId, invoiceId))
    : customerId
    ? and(orgFilter, eq(tasks.customerId, customerId))
    : orgFilter;
  return ok(await db.select().from(tasks).where(where).orderBy(desc(tasks.createdAt)));
}

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  try {
    const data = Schema.parse(await req.json());
    if (!(await ownsInOrg(customers, data.customerId, orgId!))) return bad("Customer not found in this organisation", 404);
    if (!(await ownsInOrg(invoices, data.invoiceId, orgId!)))   return bad("Invoice not found in this organisation", 404);
    if (!(await userInOrg(data.assigneeId, orgId!)))            return bad("Assignee is not a member of this organisation", 404);
    const [created] = await db.insert(tasks).values({
      orgId: orgId!,
      customerId: data.customerId ?? null,
      invoiceId: data.invoiceId ?? null,
      title: data.title,
      description: data.description,
      assigneeId: data.assigneeId ?? null,
      dueDate: data.dueDate,
      priority: data.priority ?? "Medium",
      labels: data.labels ?? [],
    }).returning();
    return ok(created);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    return bad("Failed to create task", 500);
  }
}
