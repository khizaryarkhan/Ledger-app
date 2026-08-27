import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { eq, and, inArray, isNull, lt } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { runBatchCommitJob } from "@/lib/batch/commit-runner";
import { runBatchUndoJob } from "@/lib/batch/undo-runner";
import { runScheduledImport, findDueScheduleIds } from "@/lib/batch/scheduled-runner";
import { runEstimateInvoiceBatch } from "@/lib/batch/estimate-batch-runner";
import { processUploadChunk } from "@/lib/batch/chunk-runner";
import { processDeleteChunk } from "@/lib/batch/delete-chunk-runner";
import { processFieldEditChunk } from "@/lib/batch/fieldedit-chunk-runner";

/**
 * Processes a queued Data Studio import/update job in the background so large
 * files aren't bound by the request timeout. retries: 0 — record creation is
 * not idempotent, so a re-run would duplicate rows.
 */
export const runBatchCommit = inngest.createFunction(
  { id: "run-batch-commit", retries: 0, triggers: [{ event: "batch/commit" }] },
  async ({ event, step }) => {
    const jobId = event.data.jobId as string;
    await step.run("commit", () => runBatchCommitJob(jobId));
    return { jobId };
  },
);

/** Reverses an import — deletes the records it created. retries: 0. */
export const runBatchUndo = inngest.createFunction(
  { id: "run-batch-undo", retries: 0, triggers: [{ event: "batch/undo" }] },
  async ({ event, step }) => {
    const jobId = event.data.jobId as string;
    await step.run("undo", () => runBatchUndoJob(jobId));
    return { jobId };
  },
);

/** Hourly scan: enqueue a run for each scheduled import that's due. */
export const scheduledImportScan = inngest.createFunction(
  { id: "scheduled-import-scan", triggers: [{ cron: "0 * * * *" }] },
  async ({ step }) => {
    const now = Date.now();
    const due = await step.run("find-due", () => findDueScheduleIds(now));
    if (due.length > 0) {
      await inngest.send(due.map((id) => ({ name: "batch/scheduled-run" as const, data: { scheduleId: id } })));
    }
    return { queued: due.length };
  },
);

/** Runs one scheduled import (reads the sheet, enqueues a commit). retries: 0. */
export const runScheduledImportFn = inngest.createFunction(
  { id: "run-scheduled-import", retries: 0, triggers: [{ event: "batch/scheduled-run" }] },
  async ({ event, step }) => {
    const scheduleId = event.data.scheduleId as string;
    await step.run("run", () => runScheduledImport(scheduleId));
    return { scheduleId };
  },
);

/** Bulk-creates invoices from the Invoice-from-Estimates worksheet. retries: 0. */
export const runEstimateInvoiceBatchFn = inngest.createFunction(
  { id: "run-estimate-invoice-batch", retries: 0, triggers: [{ event: "batch/estimate-invoice-batch" }] },
  async ({ event, step }) => {
    const jobId = event.data.jobId as string;
    await step.run("run", () => runEstimateInvoiceBatch(jobId));
    return { jobId };
  },
);


/**
 * Drives a chunked job (upload/modify, delete, or bulk-edit) to completion
 * SERVER-SIDE, one bounded slice per invocation, self-chaining via
 * step.sendEvent until the job reports done.
 *
 * This replaces what used to be a browser-tab-driven loop for uploads (the
 * client called /api/batch/upload/chunk in a `while(!done)` loop) and a
 * fully-synchronous single request for delete and bulk-edit. Either design
 * means the import/delete/edit stops the moment the browser stops asking for
 * it — a closed tab, a laptop sleeping, a flaky connection outlasting the
 * client's retry budget, or (for delete/bulk-edit) simply outrunning the
 * platform's request time limit. The job would sit at whatever cursor it
 * reached, silently, until the stale-job reaper eventually marked it
 * "failed" with no record of how many records were never even attempted —
 * which is the exact shape of bug reported: a 300-row import showing 70
 * success / 1 failed, with the other 229 unaccounted for anywhere in the UI.
 *
 * Each invocation here is short and durable (the shared engine in
 * lib/batch/lease.ts persists every single item before moving to the next),
 * so retries are safe: a retried step just re-reads the current cursor and
 * continues — it can't duplicate or skip work. `dispatchChunk` decides which
 * processor a job needs; `input.fieldEdit` is what distinguishes a bulk-edit
 * job from a sheet-based one, since both are stored with operation="modify"
 * (bulk-edit deliberately reuses that value so Job History's existing
 * operation labels/icons keep working without a schema change).
 */
async function dispatchChunk(orgId: string, jobId: string, operation: string, input: any) {
  if (operation === "delete") return processDeleteChunk(orgId, jobId);
  if (operation === "modify" && input?.fieldEdit) return processFieldEditChunk(orgId, jobId);
  return processUploadChunk(orgId, jobId); // upload, or a sheet-based modify
}

export const runBatchChunkLoop = inngest.createFunction(
  // retries > 0 is safe here (unlike the whole-job runners above, which stay
  // at 0): the lease+cursor makes a retried step idempotent — it resumes from
  // whatever the cursor already reflects rather than redoing or duplicating
  // committed work.
  { id: "run-batch-chunk-loop", retries: 2, triggers: [{ event: "batch/chunk-run" }] },
  async ({ event, step }) => {
    const { jobId, orgId } = event.data as { jobId: string; orgId: string };

    const [job] = await step.run("load-job", () =>
      db.select({ operation: batchJobs.operation, input: batchJobs.input, status: batchJobs.status })
        .from(batchJobs).where(eq(batchJobs.id, jobId)).limit(1));
    if (!job || job.status === "done" || job.status === "failed") return { jobId, skipped: true };

    const outcome = await step.run("process-chunk", () => dispatchChunk(orgId, jobId, job.operation, job.input));

    if (outcome.accepted && !outcome.done) {
      // Not finished — chain to another invocation. Using Inngest's own event
      // queue as the loop (rather than looping inside one function call) keeps
      // every invocation short and keeps each slice's durability guarantee
      // independent of how long the whole job ultimately takes.
      await step.sendEvent("continue", { name: "batch/chunk-run", data: { jobId, orgId } });
    } else if (!outcome.accepted && outcome.busy) {
      // Another invocation (a client "nudge", or an overlapping retry) is
      // actively holding the lease. Back off briefly and re-check rather than
      // spinning — the other holder will finish or expire its lease shortly.
      await step.sleep("wait-for-lease", "2s");
      await step.sendEvent("retry", { name: "batch/chunk-run", data: { jobId, orgId } });
    }

    return { jobId, ...outcome };
  },
);

/**
 * Safety net: finds chunked jobs whose lease has gone stale (the event chain
 * above should keep it fresh every ~1-2s while genuinely progressing — a
 * stale lease past 2 minutes means an event was dropped, not that the job is
 * dead) and re-kicks them. Runs independently of anyone opening Job History,
 * so an interrupted run self-heals within a couple of minutes rather than
 * waiting for a human to notice and revisit the page.
 *
 * Only jobs that were ever leased (leaseUntil is not null) are chunked jobs —
 * the whole-file Xero/legacy runners never set a lease, so they're untouched
 * here and continue to age out via the reaper in lib/batch/reap.ts.
 */
export const batchJobWatchdog = inngest.createFunction(
  { id: "batch-job-watchdog", triggers: [{ cron: "*/2 * * * *" }] },
  async ({ step }) => {
    const stale = await step.run("find-stale", () =>
      db.select({ id: batchJobs.id, orgId: batchJobs.orgId })
        .from(batchJobs)
        .where(and(
          inArray(batchJobs.status, ["queued", "running"]),
          isNull(batchJobs.finishedAt),
          isNull(batchJobs.undoneAt),
          // NOT NULL is deliberate — do not also match `isNull(leaseUntil)`.
          // The chunked start routes set an (already-expired) leaseUntil at
          // creation time specifically so this column is the structural
          // marker of "this is a chunk-resumable job". Legacy/scheduled
          // whole-job runners (runBatchCommitJob, Xero commit) NEVER touch
          // leaseUntil at all, so it stays permanently null for them — if
          // this also matched isNull, every one of THOSE jobs would look
          // "stale" on every single tick while genuinely, healthily running
          // (they never set a lease to begin with), and re-sending
          // batch/chunk-run at them would start a SECOND, concurrent
          // processor against the same job — duplicate QBO writes. The
          // reaper (lib/batch/reap.ts) is what watches over the legacy path.
          lt(batchJobs.leaseUntil, new Date(Date.now() - 2 * 60 * 1000)),
        )));
    if (stale.length === 0) return { nudged: 0 };

    await inngest.send(stale.map((j) => ({ name: "batch/chunk-run" as const, data: { jobId: j.id, orgId: j.orgId } })));
    return { nudged: stale.length };
  },
);
