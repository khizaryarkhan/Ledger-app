/**
 * Temporary one-off correction — DELETE after the Aberny Charity 842-row
 * import (job 6c8e2ee0) is closed out.
 *
 * POST /api/batch/jobs/[id]/reconcile-batch-faults
 *
 * That job's results wrongly mark 101 rows as failed ("Duplicate Document
 * Number") when QBO's Batch API had actually created every one of them —
 * confirmed by a full manual check of all 842 doc numbers against QBO
 * directly. This rewrites those specific rows' results to ok:true with
 * their real QBO Id, and corrects successCount/errorCount to match — so the
 * job's own record (and anything reading it, e.g. Undo, Job History) stops
 * disagreeing with what's actually in QBO. Verifies each row itself before
 * touching it (existence by DocNumber, only for rows currently marked
 * failed) rather than trusting the earlier manual check blindly.
 */

import { db } from "@/db";
import { batchJobs, qboTokens } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";
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

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [job] = await db.select().from(batchJobs)
    .where(and(eq(batchJobs.id, params.id), eq(batchJobs.orgId, orgId!))).limit(1);
  if (!job) return bad("Job not found", 404);
  if (job.entityId !== "invoice") return bad("This correction is scoped to invoice jobs");

  const results = Array.isArray(job.results) ? (job.results as any[]) : [];
  const failed = results.filter((r) => !r.ok && r.key);
  if (failed.length === 0) return ok({ corrected: 0, message: "No failed rows with a doc number key to check" });

  const [token] = await db.select().from(qboTokens).where(eq(qboTokens.orgId, orgId!));
  if (!token) return bad("No QBO connection for this org", 400);
  const accessToken = new Date(token.accessTokenExpiresAt).getTime() - Date.now() < 60_000
    ? await refreshToken(token)
    : decryptSecret(token.accessToken)!;

  const IN_CHUNK = 30;
  const docNums = [...new Set(failed.map((r) => String(r.key)))];
  const byDoc = new Map<string, { Id: string; DocNumber: string }>();
  for (let i = 0; i < docNums.length; i += IN_CHUNK) {
    const chunk = docNums.slice(i, i + IN_CHUNK);
    const inList = chunk.map((n) => `'${n}'`).join(",");
    const query = `SELECT Id, DocNumber FROM Invoice WHERE DocNumber IN (${inList})`;
    const url = `${QBO_API}/${token.realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
    const data = await res.json().catch(() => null);
    const rows = data?.QueryResponse?.Invoice || [];
    for (const r of rows) byDoc.set(String(r.DocNumber), { Id: String(r.Id), DocNumber: String(r.DocNumber) });
  }

  let corrected = 0;
  const stillFailed: string[] = [];
  const newResults = results.map((r) => {
    if (r.ok || !r.key) return r;
    const match = byDoc.get(String(r.key));
    if (!match) { stillFailed.push(String(r.key)); return r; }
    corrected++;
    return { ok: true, row: r.row, qboId: match.Id, docNumber: match.DocNumber, note: "Corrected: QBO's Batch API had created this record despite reporting a Fault (see CLAUDE.md 2026-09-03)" };
  });

  const newSuccessCount = (job.successCount ?? 0) + corrected;
  const newErrorCount = (job.errorCount ?? 0) - corrected;

  await db.update(batchJobs)
    .set({ results: newResults, successCount: newSuccessCount, errorCount: newErrorCount })
    .where(eq(batchJobs.id, params.id));

  return ok({ corrected, stillFailed, newSuccessCount, newErrorCount });
}
