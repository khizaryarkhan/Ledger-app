import { inngest } from "@/lib/inngest";
import { runBatchCommitJob } from "@/lib/batch/commit-runner";
import { runBatchUndoJob } from "@/lib/batch/undo-runner";
import { runScheduledImport, findDueScheduleIds } from "@/lib/batch/scheduled-runner";
import { runEstimateInvoiceBatch } from "@/lib/batch/estimate-batch-runner";

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
