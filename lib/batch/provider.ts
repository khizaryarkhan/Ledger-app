/**
 * Which accounting system Data Studio should target for an org.
 * QBO takes precedence if both are somehow connected.
 */

import { db } from "@/db";
import { qboTokens, xeroTokens } from "@/db/schema";
import { eq } from "drizzle-orm";

export type Provider = "qbo" | "xero";

export async function detectProvider(orgId: string): Promise<Provider | null> {
  const [qbo] = await db.select({ id: qboTokens.id }).from(qboTokens).where(eq(qboTokens.orgId, orgId)).limit(1);
  if (qbo) return "qbo";
  const [xero] = await db.select({ id: xeroTokens.id }).from(xeroTokens).where(eq(xeroTokens.orgId, orgId)).limit(1);
  if (xero) return "xero";
  return null;
}
