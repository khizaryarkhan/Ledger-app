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
import { and, eq } from "drizzle-orm";
import { getEntity } from "./entities";
import { normalizeRows, groupDocs, ensureIdentityMapping } from "./engine";
import { getOrgQboToken } from "@/lib/qbo-token";
import { RefResolver } from "./ref-resolver";
import { preloadPaymentApplicationIds } from "./builders";
import { detectProvider } from "./provider";
import { runXeroCommitJob } from "./xero/commit";
import { commitOneDoc, docKeyOf } from "./commit-one";

const PROGRESS_EVERY = 10;

export async function runBatchCommitJob(jobId: string): Promise<void> {
  const [job] = await db.select().from(batchJobs).where(eq(batchJobs.id, jobId)).limit(1);
  if (!job || job.status === "done" || job.status === "failed") return;

  // Atomic claim: flip queued → running, and proceed ONLY if this call won the
  // flip. This job may be triggered from two places at once — the Inngest
  // worker AND the inline "kick" the client fires as a fallback (Inngest event
  // delivery isn't reliable in every environment). The conditional UPDATE is a
  // single atomic statement (neon-http has no transactions), so exactly one
  // runner ever gets past here — no duplicate QBO writes.
  const claim = await db.update(batchJobs)
    .set({ status: "running" })
    .where(and(eq(batchJobs.id, jobId), eq(batchJobs.status, "queued")))
    .returning({ id: batchJobs.id });
  if (claim.length === 0) return; // already claimed / running elsewhere

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
  const overrides: Record<string, Record<string, string>> = input.overrides || {};
  const rawRows: any[] = Array.isArray(input.rawRows) ? input.rawRows : [];
  // For updates, preserve the Id/SyncToken identity columns the auto-mapping
  // drops (they aren't data columns) — otherwise every row fails "needs an Id".
  const mapping: Record<string, string> = operation === "modify" && rawRows[0]
    ? ensureIdentityMapping(input.mapping || {}, rawRows[0])
    : (input.mapping || {});

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
  await preloadPaymentApplicationIds(entity.id, docs, resolver);

  const results: any[] = [];
  let successCount = 0;

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    try {
      // Shared with the chunked engine (lib/batch/commit-one.ts) — this used
      // to be its own independent copy of build+estimate-safety-check+sparse+
      // qboPost, which is exactly how it went unfixed when the sparse-vs-full
      // update bug was fixed elsewhere: two copies of the same logic, and
      // only one of them got the fix. This is the path the dedicated
      // /batch/modify screen actually uses (via /api/batch/upload/commit),
      // so an org small enough to run inline (≤100 docs) was hitting the
      // still-broken copy the whole time.
      const r = await commitOneDoc(token, entity, operation, doc, resolver);
      if (r.ok) {
        successCount++;
        results.push({ row: i + 1, ok: true, qboId: r.qboId, docNumber: r.docNumber });
      } else {
        // Keep the source rows on failures so the user can see what failed and
        // re-download JUST the failed rows to fix and re-import (no duplicates).
        results.push({ row: i + 1, ok: false, error: (r as any).error, key: docKeyOf(entity, doc), data: doc.rows });
      }
    } catch (e: any) {
      results.push({ row: i + 1, ok: false, error: e?.message || "Build failed", key: docKeyOf(entity, doc), data: doc.rows });
    }

    if ((i + 1) % PROGRESS_EVERY === 0) {
      // Persist the partial RESULTS too, not just the counts — so if this
      // invocation is killed mid-run (the 60s→300s function limit), the
      // QuickBooks ids created so far survive and the import stays undoable.
      // At most PROGRESS_EVERY rows' ids are lost on a hard kill.
      await db.update(batchJobs)
        .set({ successCount, errorCount: i + 1 - successCount, results })
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
