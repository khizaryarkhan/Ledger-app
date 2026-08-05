/**
 * Xero background commit — create/update records from a staged batch job.
 * Mirrors the QBO commit-runner loop but for Xero (no SyncToken; update is the
 * same POST with the record's id present).
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { normalizeRows, groupDocs } from "../engine";
import { getOrgXeroToken } from "@/lib/xero-token";
import { getXeroEntity } from "./registry";
import { xeroPost } from "./client";

const PROGRESS_EVERY = 10;

export async function runXeroCommitJob(job: any): Promise<void> {
  const jobId = job.id as string;
  const fail = (error: string) =>
    db.update(batchJobs).set({ status: "failed", results: [{ ok: false, error }], input: null, finishedAt: new Date() })
      .where(eq(batchJobs.id, jobId));

  const entity = getXeroEntity(job.entityId);
  if (!entity || !entity.build) { await fail("This entity can't be imported to Xero"); return; }

  const token = await getOrgXeroToken(job.orgId).catch(() => null);
  if (!token) { await fail("Xero is not connected for this organisation"); return; }

  const input = (job.input || {}) as any;
  const mapping: Record<string, string> = input.mapping || {};
  const overrides: Record<string, Record<string, string>> = input.overrides || {};
  const rawRows: any[] = Array.isArray(input.rawRows) ? input.rawRows : [];

  const normalized = normalizeRows(rawRows, mapping);
  if (Object.keys(overrides).length) {
    for (const row of normalized)
      for (const [col, map] of Object.entries(overrides)) {
        const cur = row[col];
        if (cur != null && map[String(cur)] != null) row[col] = map[String(cur)];
      }
  }
  const docs = groupDocs(normalized, entity);

  await db.update(batchJobs).set({ status: "running", totalRows: docs.length }).where(eq(batchJobs.id, jobId));

  const results: any[] = [];
  let successCount = 0;

  for (let i = 0; i < docs.length; i++) {
    try {
      const built = entity.build(docs[i]);
      const res = await xeroPost(token, entity.xeroEntity, built.payload);
      if (res.ok) {
        const rec = res.data?.[entity.xeroEntity]?.[0];
        successCount++;
        results.push({
          row: i + 1, ok: true,
          qboId: rec?.[entity.xeroIdKey || "ID"],   // reuse the qboId field for the Xero id (undo uses it)
          docNumber: rec?.InvoiceNumber ?? rec?.CreditNoteNumber ?? rec?.QuoteNumber ?? rec?.Code ?? rec?.Name,
        });
      } else {
        results.push({ row: i + 1, ok: false, error: res.error });
      }
    } catch (e: any) {
      results.push({ row: i + 1, ok: false, error: e?.message || "Build failed" });
    }
    if ((i + 1) % PROGRESS_EVERY === 0)
      await db.update(batchJobs).set({ successCount, errorCount: i + 1 - successCount }).where(eq(batchJobs.id, jobId));
  }

  await db.update(batchJobs).set({
    status: "done", successCount, errorCount: docs.length - successCount,
    results, input: null, finishedAt: new Date(),
  }).where(eq(batchJobs.id, jobId));
}
