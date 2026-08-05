import { db } from "@/db";
import { googleSheetsTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireOrg, ok } from "@/lib/api";

export async function POST() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  await db.delete(googleSheetsTokens).where(eq(googleSheetsTokens.orgId, orgId!));
  return ok({ disconnected: true });
}
