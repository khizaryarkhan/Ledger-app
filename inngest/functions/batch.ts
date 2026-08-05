import { inngest } from "@/lib/inngest";
import { runBatchCommitJob } from "@/lib/batch/commit-runner";
import { runBatchUndoJob } from "@/lib/batch/undo-runner";

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
