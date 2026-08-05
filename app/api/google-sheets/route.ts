/**
 * GET /api/google-sheets — connection status for the org's Google Sheets link.
 */

import { db } from "@/db";
import { googleSheetsTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireOrg, ok } from "@/lib/api";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const [token] = await db.select({ email: googleSheetsTokens.email })
    .from(googleSheetsTokens).where(eq(googleSheetsTokens.orgId, orgId!)).limit(1);
  return ok({ connected: !!token, email: token?.email ?? null });
}
