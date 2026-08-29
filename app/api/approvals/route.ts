/** GET /api/approvals → pending approval inbox (org-wide, any admin can act on any). */

import { db } from "@/db";
import { pendingApprovals, users } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { and, eq, desc, inArray } from "drizzle-orm";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const rows = await db.select().from(pendingApprovals)
    .where(and(eq(pendingApprovals.orgId, orgId!), eq(pendingApprovals.status, "Pending")))
    .orderBy(desc(pendingApprovals.createdAt));
  const userIds = [...new Set(rows.map(r => r.requestedBy).filter(Boolean) as string[])];
  const people = userIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : [];
  const byId = new Map(people.map(p => [p.id, p.name]));
  return ok(rows.map(r => ({ ...r, requestedByName: r.requestedBy ? byId.get(r.requestedBy) ?? null : null })));
}
