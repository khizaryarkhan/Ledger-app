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
  const listParam = u.searchParams.get("list"); // comma-separated doc numbers, alternative to from/to
  const nums: number[] = listParam
    ? listParam.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n))
    : (from && to && to >= from ? Array.from({ length: to - from + 1 }, (_, i) => from + i) : []);
  if (nums.length === 0) return bad("from/to or list= required");
  if (nums.length > 800) return bad("too many doc numbers in one request (max 800)");

  const [token] = await db.select().from(qboTokens).where(eq(qboTokens.orgId, orgId!));
  if (!token) return bad("No QBO connection for this org", 400);

  const accessToken = new Date(token.accessTokenExpiresAt).getTime() - Date.now() < 60_000
    ? await refreshToken(token)
    : decryptSecret(token.accessToken)!;

  // One QBO query per ~30 doc numbers via an IN clause, instead of one query
  // per number — the per-number loop this used to be made a full-range check
  // (800+ numbers) impossibly slow (800 sequential API calls).
  const IN_CHUNK = 30;
  const byDoc = new Map<string, any[]>();
  for (let i = 0; i < nums.length; i += IN_CHUNK) {
    const chunk = nums.slice(i, i + IN_CHUNK);
    const inList = chunk.map((n) => `'${n}'`).join(",");
    const query = `SELECT Id, DocNumber, TotalAmt, MetaData FROM Invoice WHERE DocNumber IN (${inList})`;
    const url = `${QBO_API}/${token.realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
    const data = await res.json().catch(() => null);
    const rows = data?.QueryResponse?.Invoice || [];
    for (const r of rows) {
      const dn = String(r.DocNumber);
      if (!byDoc.has(dn)) byDoc.set(dn, []);
      byDoc.get(dn)!.push(r);
    }
  }

  const results = nums.map((n) => {
    const rows = byDoc.get(String(n)) || [];
    return {
      docNumber: String(n), count: rows.length, ids: rows.map((r: any) => r.Id),
      detail: rows.map((r: any) => ({ id: r.Id, total: r.TotalAmt, createTime: r.MetaData?.CreateTime, lastUpdated: r.MetaData?.LastUpdatedTime })),
    };
  });

  return ok({ results, checkedAt: new Date().toISOString() });
}
