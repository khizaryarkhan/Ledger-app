import { requireOrg } from "@/lib/api";
import { db } from "@/db";
import { organisations, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

// Sanity/identity endpoint for the mobile app — exercises the bearer-token
// path through requireOrg() exactly like every other protected route.
export async function GET() {
  const { error, session, orgId, role } = await requireOrg();
  if (error) return error;

  const userId = (session!.user as any).id as string;
  const [[user], [org]] = await Promise.all([
    db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.id, userId)).limit(1),
    db.select({ id: organisations.id, name: organisations.name }).from(organisations).where(eq(organisations.id, orgId!)).limit(1),
  ]);

  return NextResponse.json({ user, org, role });
}
