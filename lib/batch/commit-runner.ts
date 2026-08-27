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
import { qboPost, qboReadOne } from "./qbo-client";
import { RefResolver } from "./ref-resolver";
import { detectProvider } from "./provider";
import { runXeroCommitJob } from "./xero/commit";

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

  const results: any[] = [];
  let successCount = 0;

  // A human-readable identifier for a document (e.g. its Invoice No / Name), so
  // a failed row in Job History says WHICH record failed, not just "row 42".
  const keyOf = (d: any): string | null => {
    const r = d?.rows?.[0] ?? {};
    const cands = [entity.docKey, entity.refNumberColumn, "Name", "DisplayName", "Title"].filter(Boolean) as string[];
    for (const c of cands) {
      const v = r[c] ?? r[c + " "] ?? r[(c || "").trim()];
      if (v != null && String(v).trim() !== "") return String(v).trim().slice(0, 120);
    }
    return null;
  };

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    try {
      const built = await entity.build(doc, resolver);
      let payload = built.payload;

      if (operation === "modify") {
        const id = doc.rows[0]["Id"] ?? doc.rows[0]["QBO Id"];
        const syncToken = doc.rows[0]["SyncToken"] ?? doc.rows[0]["Sync Token"];
        if (!id) throw new Error("Update needs an 'Id' column (download the records first)");

        // SAFETY: an Estimate that has been invoiced via progress invoicing
        // carries LinkedTxn to those invoices. Any update through the public API
        // silently DROPS that link while Progress Invoicing is ON (a documented
        // QBO limitation) — and the API cannot re-create it. The update file has
        // no LinkedTxn data, so we can't preserve it in the payload either.
        // Refuse to touch a linked estimate rather than destroy the link.
        if (entity.id === "estimate") {
          const existing = await qboReadOne(token, entity.qboEntity!, String(id));
          const links = Array.isArray(existing?.LinkedTxn)
            ? existing.LinkedTxn.filter((l: any) => l?.TxnType === "Invoice")
            : [];
          if (links.length > 0) {
            throw new Error(
              `Skipped — this estimate is linked to ${links.length} invoice(s) via progress invoicing. Updating it through the API removes that link and it can't be restored, so it was left unchanged. Edit it directly in QuickBooks.`,
            );
          }
        }

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
        // Keep the source rows on failures so the user can see what failed and
        // re-download JUST the failed rows to fix and re-import (no duplicates).
        results.push({ row: i + 1, ok: false, error: res.error, key: keyOf(doc), data: doc.rows });
      }
    } catch (e: any) {
      results.push({ row: i + 1, ok: false, error: e?.message || "Build failed", key: keyOf(doc), data: doc.rows });
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

function firstRecord(data: any) {
  if (!data) return null;
  const key = Object.keys(data).find((k) => k !== "time");
  return key ? data[key] : null;
}
