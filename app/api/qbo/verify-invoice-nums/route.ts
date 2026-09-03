/**
 * Temporary read-only diagnostic — DELETE after the Aberny Charity duplicate-
 * invoice investigation is closed out. Queries QBO directly (not the local
 * mirror, which can lag) for how many Invoice records currently exist per
 * DocNumber in a given range, to get an authoritative duplicate check.
 *
 * GET /api/qbo/verify-invoice-nums?from=209&to=248
 */

import { db } from "@/db";
import { qboTokens } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq } from "drizzle-orm";
import { decryptSecret } from "@/lib/crypto";

const QBO_API = "https://quickbooks.api.intuit.com/v3/company";

async function refreshToken(token: any): Promise<string> {
  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: decryptSecret(token.refreshToken)! }),
  });
  if (!res.ok) return decryptSecret(token.accessToken)!;
  const d = await res.json();
  return d.access_token as string;
}

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const u = new URL(req.url);
  const from = Number(u.searchParams.get("from") || 0);
  const to = Number(u.searchParams.get("to") || 0);
  if (!from || !to || to < from || to - from > 100) return bad("from/to required, range <= 100");

  const [token] = await db.select().from(qboTokens).where(eq(qboTokens.orgId, orgId!));
  if (!token) return bad("No QBO connection for this org", 400);

  const accessToken = new Date(token.accessTokenExpiresAt).getTime() - Date.now() < 60_000
    ? await refreshToken(token)
    : decryptSecret(token.accessToken)!;

  const results: { docNumber: string; count: number; ids: string[] }[] = [];
  for (let n = from; n <= to; n++) {
    const query = `SELECT Id, DocNumber, TotalAmt, MetaData FROM Invoice WHERE DocNumber = '${n}'`;
    const url = `${QBO_API}/${token.realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
    const data = await res.json().catch(() => null);
    const rows = data?.QueryResponse?.Invoice || [];
    results.push({ docNumber: String(n), count: rows.length, ids: rows.map((r: any) => r.Id) });
  }

  return ok({ results, checkedAt: new Date().toISOString() });
}
