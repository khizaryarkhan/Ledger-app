import { db } from "@/db";
import { reps } from "@/db/schema";
import { requireOrg, requireReadScope, ok, bad } from "@/lib/api";
import { eq, and, inArray } from "drizzle-orm";

export async function GET() {
  const { error, orgIds } = await requireReadScope();
  if (error) return error;
  const all = await db.select().from(reps).where(inArray(reps.orgId, orgIds));
  return ok(all);
}

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const { name, email, tier } = await req.json();
  if (!name?.trim()) return bad("Name is required");
  const validTiers = ["rep", "rd", "ed"];
  const safeTier = validTiers.includes(tier) ? tier : "rep";
  const [rep] = await db.insert(reps).values({ orgId: orgId!, name: name.trim(), email: email?.trim() || null, tier: safeTier }).returning();
  return ok(rep);
}

export async function DELETE(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const { id } = await req.json();
  if (!id) return bad("id required");
  await db.delete(reps).where(and(eq(reps.id, id), eq(reps.orgId, orgId!)));
  return ok({ deleted: true });
}
