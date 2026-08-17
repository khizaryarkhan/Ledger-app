/**
 * Background runner for a batch commit (import / update).
 *
 * Reads a queued batch_jobs row + its staged input, builds a QBO payload per
 * document, creates/updates each in QuickBooks, and writes progress back to the
 * row incrementally so the UI can show a live progress bar. Cleared input on
 * finish. Not retried by the caller — record creation isn't idempotent.
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getEntity } from "./entities";
import { normalizeRows, groupDocs } from "./engine";
import { getOrgQboToken } from "@/lib/qbo-token";
import { qboPost } from "./qbo-client";
import { RefResolver } from "./ref-resolver";
import { detectProvider } from "./provider";
import { runXeroCommitJob } from "./xero/commit";

const PROGRESS_EVERY = 10;

export async function runBatchCommitJob(jobId: string): Promise<void> {
  const [job] = await db.select().from(batchJobs).where(eq(batchJobs.id, jobId)).limit(1);
  if (!job || job.status === "done" || job.status === "failed") return;

  const fail = (error: string) =>
    db.update(batchJobs).set({ status: "failed", results: [{ ok: false, error }], input: null, finishedAt: new Date() })
      .where(eq(batchJobs.id, jobId));

  // A single top-level guard. Everything past the "running" update below (ref
  // preload, doc grouping, the final write) can throw — e.g. a ref preload
  // query failing. Without this, an uncaught throw left the row pinned at
  // "running" forever (Inngest has retries:0), and the UI polled a job that
  // never completed. Now any crash marks the job failed with the real reason.
  try {
    await runInner();
  } catch (e: any) {
    await fail(e?.message || "The batch job crashed unexpectedly").catch(() => {});
  }
  return;

  async function runInner(): Promise<void> {
  // Route to the connected provider.
  if ((await detectProvider(job.orgId)) === "xero") {
    await runXeroCommitJob(job);
    return;
  }

  const entity = getEntity(job.entityId);
  if (!entity || !entity.build) { await fail("Unknown entity or no builder"); return; }

  const token = await getOrgQboToken(job.orgId).catch(() => null);
  if (!token) { await fail("QuickBooks is not connected for this organisation"); return; }

  const input = (job.input || {}) as any;
  const operation: "upload" | "modify" = job.operation === "modify" ? "modify" : "upload";
  const mapping: Record<string, string> = input.mapping || {};
  const overrides: Record<string, Record<string, string>> = input.overrides || {};
  const rawRows: any[] = Array.isArray(input.rawRows) ? input.rawRows : [];

  const normalized = normalizeRows(rawRows, mapping);
  if (Object.keys(overrides).length) {
    for (const row of normalized) {
      for (const [col, map] of Object.entries(overrides)) {
        const cur = row[col];
        if (cur != null && map[String(cur)] != null) row[col] = map[String(cur)];
      }
    }
  }
  const docs = groupDocs(normalized, entity);

  await db.update(batchJobs).set({ status: "running", totalRows: docs.length }).where(eq(batchJobs.id, jobId));

  const resolver = new RefResolver(token);
  if (entity.refs?.length) await resolver.preload(entity.refs);

  const results: any[] = [];
  let successCount = 0;

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    try {
      const built = await entity.build(doc, resolver);
      let payload = built.payload;

      if (operation === "modify") {
        const id = doc.rows[0]["Id"] ?? doc.rows[0]["QBO Id"];
        const syncToken = doc.rows[0]["SyncToken"] ?? doc.rows[0]["Sync Token"];
        if (!id) throw new Error("Update needs an 'Id' column (download the records first)");
        payload = { ...payload, Id: String(id), SyncToken: String(syncToken ?? "0"), sparse: true };
      }

      const res = await qboPost(token, entity.qboEntity!, payload, {
        operation: operation === "modify" ? "update" : undefined,
      });

      if (res.ok) {
        const created = firstRecord(res.data);
        successCount++;
        results.push({ row: i + 1, ok: true, qboId: created?.Id, docNumber: created?.DocNumber });
      } else {
        results.push({ row: i + 1, ok: false, error: res.error });
      }
    } catch (e: any) {
      results.push({ row: i + 1, ok: false, error: e?.message || "Build failed" });
    }

    if ((i + 1) % PROGRESS_EVERY === 0) {
      await db.update(batchJobs)
        .set({ successCount, errorCount: i + 1 - successCount })
        .where(eq(batchJobs.id, jobId));
    }
  }

  await db.update(batchJobs).set({
    status: "done",
    successCount,
    errorCount: docs.length - successCount,
    results,
    input: null,
    finishedAt: new Date(),
  }).where(eq(batchJobs.id, jobId));
  }
}

function firstRecord(data: any) {
  if (!data) return null;
  const key = Object.keys(data).find((k) => k !== "time");
  return key ? data[key] : null;
}
