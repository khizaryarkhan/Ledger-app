/**
 * Shared polling loop for every Data Studio screen that watches a batch job
 * to completion (Import, Update, Delete, Bulk Edit) — previously each page
 * had its own near-identical copy.
 *
 * A chunked job is SUPPOSED to keep advancing on its own: it self-chains via
 * Inngest events (lib/batch/lease.ts's engine + inngest/functions/batch.ts's
 * runBatchChunkLoop), with a batchJobWatchdog cron re-kicking any job whose
 * lease has gone stale every 2 minutes as a server-side safety net. In
 * practice, Inngest's event delivery in this environment is not fully
 * reliable — confirmed repeatedly this week, including during a same-day
 * load test where several chunked jobs sat with zero progress for minutes
 * at a time (well past a single dropped event, and past what the 2-minute
 * watchdog alone should allow) until manually nudged via
 * /api/batch/jobs/[id]/run-chunk-now.
 *
 * The watchdog cron depends on Inngest's cron delivery too, so it shares the
 * same failure mode it's meant to catch. A client-side nudge sidesteps that
 * entirely — it's a plain fetch from the browser to our own Next.js route,
 * nothing Inngest-shaped in the path at all. Since most users watch the
 * progress bar rather than close the tab, this recovers a stalled job in
 * seconds instead of however long Inngest takes to notice (if it ever does).
 *
 * run-chunk-now is safe to call speculatively: claimChunk is atomic, so if
 * the server-side chain is ALSO mid-chunk right now, this nudge just gets a
 * clean "busy" back and does nothing.
 */

export interface BatchJobProgress {
  status: string;
  processed: number;
  total: number;
  successCount: number;
  errorCount: number;
}

export interface PollBatchJobOptions {
  /** Called on every successful poll, including the final one. */
  onProgress: (p: BatchJobProgress) => void;
  /** Called once, when the job reaches done/failed. `job` is the full GET /api/batch/jobs/[id] response. */
  onDone: (job: any) => void;
  /** Called once, if polling has to give up (10 consecutive failed requests). */
  onError: (message: string) => void;
  /** Poll interval in ms. Default 1500. */
  intervalMs?: number;
  /**
   * How many consecutive no-progress ticks (at intervalMs each) before
   * firing a recovery nudge. Default 8 (~12s at the default interval) —
   * long enough that a chunk genuinely still being processed (up to 45s
   * per lib/batch/lease.ts's TIME_BUDGET_MS) isn't mistaken for stalled,
   * since recordItem persists progress per-row during that window, not
   * only at the end of it.
   */
  stallTicks?: number;
}

/** Returns a `stop()` function — call it on unmount to cancel the loop. */
export function pollBatchJob(jobId: string, opts: PollBatchJobOptions): () => void {
  const intervalMs = opts.intervalMs ?? 1500;
  const stallTicks = opts.stallTicks ?? 8;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let misses = 0;
  let lastProcessed = -1;
  let stalledFor = 0;

  const tick = async () => {
    if (stopped) return;
    try {
      const res = await fetch(`/api/batch/jobs/${jobId}`);
      const j = await res.json();
      if (res.ok) {
        misses = 0;
        const processed = j.processed ?? (j.successCount ?? 0) + (j.errorCount ?? 0);
        opts.onProgress({ status: j.status, processed, total: j.totalRows, successCount: j.successCount, errorCount: j.errorCount });

        if (j.status === "done" || j.status === "failed") {
          opts.onDone(j);
          return;
        }

        if (j.status === "running" || j.status === "queued") {
          if (processed === lastProcessed) {
            stalledFor++;
            if (stalledFor === stallTicks) {
              fetch(`/api/batch/jobs/${jobId}/run-chunk-now`, { method: "POST" }).catch(() => {});
            }
          } else {
            stalledFor = 0;
          }
          lastProcessed = processed;
        }
      } else if (++misses > 10) {
        opts.onError("Lost track of the job — check Job History for the result.");
        return;
      }
    } catch {
      if (++misses > 10) {
        opts.onError("Connection lost — check Job History for the result.");
        return;
      }
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };

  tick();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
