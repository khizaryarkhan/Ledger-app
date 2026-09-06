/**
 * The lease + cursor primitive behind every chunked job (upload/modify,
 * delete, bulk-edit).
 *
 * Extracted from what used to be upload-only logic in chunk-runner.ts. Delete
 * and bulk-edit used to run their whole list in a single synchronous request —
 * no cursor, no incremental persistence, so a request that outran its function
 * time limit (very possible past a few hundred records at real QBO latency)
 * just vanished mid-run: the batch_jobs row stayed "running" forever, with
 * NONE of the work done before the cutoff recorded anywhere. Upload had
 * already solved this once (chunk-runner.ts); this file is that solution made
 * reusable so all three get it instead of each having its own — and
 * differently buggy — version.
 *
 * Concurrency-safety (neon-http has no transactions — see CLAUDE.md — so every
 * step below is a single atomic UPDATE, not a read-then-write):
 *  - claimChunk: an atomic conditional UPDATE on (id, processedCount, expired
 *    lease) — only the caller that flips it proceeds. Two overlapping
 *    invocations (a client "nudge" racing the server-driven Inngest chain,
 *    say) never process the same cursor twice.
 *  - recordItem: cursor advance + result append + count increments + lease
 *    renewal, all in ONE statement, per item — so a crash between items loses
 *    at most the in-flight one, and a retry resumes exactly where the cursor
 *    says, never re-doing (and never duplicating) completed work.
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { and, eq, sql, isNull, or, lt } from "drizzle-orm";

export const LEASE_MS = 120_000;
export const TIME_BUDGET_MS = 45_000;     // return well before any 60s function cap
// Was 400 — an artificial ceiling well below what TIME_BUDGET_MS already
// allows in practice. Confirmed live 2026-09-06: a 10,000-row job stopping
// every ~180-240 records (well under 400, since a round's size is
// concurrency*batchSize and doesn't divide evenly) to hand off to a fresh
// chunk invocation spent much more wall-clock time WAITING for that next
// invocation to start (Inngest self-chain latency, or a client nudge) than
// it spent actually doing QBO work. TIME_BUDGET_MS is what actually bounds
// a single invocation's real duration — this just stops it from quitting
// early while there's still budget left, cutting the number of handoffs a
// 10k-row job needs from ~25 down to a handful.
export const MAX_ITEMS_PER_CHUNK = 3000;

// Flat shape, not a discriminated union: this project runs with
// strictNullChecks:false, under which TS does not narrow a boolean-literal
// discriminant (`claimed: true` vs `claimed: false`) — `if (!claim.claimed)`
// would still type as the whole union and every field access errors. A flat
// optional-fields shape (matching ChunkOutcome's existing style) sidesteps it.
export type ClaimResult = {
  claimed: boolean;
  processedCount: number;
  totalRows: number;
  status: string | null;
  busy: boolean;
};

/** Atomically claim the right to process from the job's current cursor. */
export async function claimChunk(jobId: string, cursor: number): Promise<ClaimResult> {
  const now = new Date();
  const claim = await db.update(batchJobs)
    .set({ leaseUntil: new Date(Date.now() + LEASE_MS), status: "running" })
    .where(and(
      eq(batchJobs.id, jobId),
      eq(batchJobs.processedCount, cursor),
      or(isNull(batchJobs.leaseUntil), lt(batchJobs.leaseUntil, now)),
    ))
    .returning({ id: batchJobs.id });
  if (claim.length > 0) return { claimed: true, processedCount: cursor, totalRows: 0, status: null, busy: false };

  const [cur] = await db.select({
    pc: batchJobs.processedCount, lu: batchJobs.leaseUntil, st: batchJobs.status, tr: batchJobs.totalRows,
  }).from(batchJobs).where(eq(batchJobs.id, jobId)).limit(1);
  return {
    claimed: false,
    processedCount: cur?.pc ?? cursor,
    totalRows: cur?.tr ?? 0,
    status: cur?.st ?? null,
    busy: !!(cur?.lu && cur.lu > now),
  };
}

export type ItemResult = { ok: boolean; [k: string]: any };

/** Advance the cursor by one item — durably, in a single statement. */
export async function recordItem(jobId: string, index: number, result: ItemResult): Promise<void> {
  await db.update(batchJobs).set({
    processedCount: index + 1,
    results: sql`COALESCE(${batchJobs.results}, '[]'::jsonb) || ${JSON.stringify([result])}::jsonb`,
    successCount: sql`${batchJobs.successCount} + ${result.ok ? 1 : 0}`,
    errorCount: sql`${batchJobs.errorCount} + ${result.ok ? 0 : 1}`,
    leaseUntil: new Date(Date.now() + LEASE_MS),
  }).where(eq(batchJobs.id, jobId));
}

/**
 * Close out a chunk call: mark done + clear the lease/input when the whole
 * list is processed, or set the lease to NOW (expired but recent) so the next
 * call can claim it immediately while the stale-job reaper's 2-minute grace
 * still protects an actively-progressing job from being killed mid-run.
 */
export async function finishChunkCall(jobId: string, done: boolean): Promise<void> {
  await db.update(batchJobs)
    .set(done
      ? { status: "done", leaseUntil: null, input: null, finishedAt: new Date() }
      : { status: "running", leaseUntil: new Date() })
    .where(eq(batchJobs.id, jobId));
}

/** Release the lease (without clearing progress) so a failed call can be retried. */
export async function releaseLeaseOnError(jobId: string): Promise<void> {
  await db.update(batchJobs).set({ leaseUntil: new Date() }).where(eq(batchJobs.id, jobId)).catch(() => {});
}

export type ChunkOutcome = {
  accepted: boolean;
  processedCount: number;
  totalRows: number;
  done: boolean;
  status?: string;
  busy?: boolean;
  error?: string;
  successCount?: number;
  errorCount?: number;
};

/**
 * Drive a bounded slice of `total` items through `processOne`, honouring the
 * shared time/count budget, with per-item durability via recordItem.
 * `processOne(index)` must not throw for an expected per-record failure — it
 * should return `{ ok: false, error }`; a THROW is still caught and recorded
 * as a failed item, but should be reserved for genuinely unexpected bugs.
 */
export async function runChunkLoop(
  jobId: string,
  cursor: number,
  total: number,
  processOne: (index: number) => Promise<ItemResult>,
): Promise<{ processedTo: number }> {
  const started = Date.now();
  let i = cursor;
  let n = 0;
  while (i < total && n < MAX_ITEMS_PER_CHUNK && (Date.now() - started) < TIME_BUDGET_MS) {
    let result: ItemResult;
    try {
      result = await processOne(i);
    } catch (e: any) {
      result = { ok: false, error: e?.message || "Unexpected error" };
    }
    await recordItem(jobId, i, result);
    i++; n++;
  }
  return { processedTo: i };
}

export const QBO_BATCH_SIZE = 30;
// QBO's Batch endpoint processes the 30 items in one call largely
// sequentially server-side (~0.5s/record observed — 30 items ≈ 15s per
// call), so a single batch call saves network round-trips but not QBO's own
// processing time. Running several batch calls concurrently is what
// actually multiplies throughput.
//
// This is the SAFE FLOOR, not a fixed setting — see runBatchedChunkLoop's
// adaptive ramp below. Was a flat 6. Confirmed live 2026-09-06 (Foodready.ai
// QBO Sandbox, 500-record load test): 6 concurrent batch calls (up to 180
// records in flight per round) reliably tripped the sandbox's rate limiter
// after the first round or two, and recovery took multiple minutes — a
// 500-row import lost ~300 good rows to "Exhausted retries" this way (see
// qbo-client.ts's MAX_ATTEMPTS comment for the retry-side half of this fix).
// QBO's documented production throttle is ~500 requests/min per realm, which
// 6-wide easily stays under — Intuit's sandbox environments enforce a much
// stricter, and apparently much slower to recover, limit than production.
// A flat 3-wide would have quietly halved throughput for every real
// customer on production too, just to stay safe on the one environment that
// actually trips — hence the ramp instead of a permanently lower ceiling.
export const QBO_BATCH_CONCURRENCY = 3;
// Matches qbo-rate-limiter.ts's MAX_CONCURRENT — that limiter is now the
// authoritative, cross-job enforcement point (a realm-wide semaphore), so
// there's no benefit to a job requesting more parallelism than the realm can
// actually grant: it would just sit waiting on acquireBatchSlot instead of
// running, wasting round time for nothing.
export const QBO_BATCH_CONCURRENCY_CEILING = 8;

/**
 * Same contract as runChunkLoop, but processes items in groups of up to
 * `batchSize` via processGroup(indices) → one ItemResult per index, in
 * order — meant for a processGroup that submits the whole group as ONE QBO
 * Batch API call instead of one request per item. Durability: every result
 * from a completed round is recorded via recordItem before starting the next
 * round, so a crash mid-round loses at most that round's DB writes, never
 * QBO write results that already came back — the "unit of loss" is now up to
 * concurrency*batchSize items instead of batchSize, which is the tradeoff
 * for the throughput gain; reap.ts's stale-job handling is unaffected
 * either way. A thrown processGroup (vs. a normal per-item failure inside
 * it) fails every index in that one group — same "reserved for genuinely
 * unexpected bugs" contract as runChunkLoop's per-item catch.
 *
 * Concurrency is adaptive: starts at QBO_BATCH_CONCURRENCY_CEILING (not the
 * floor) since qbo-rate-limiter.ts is now the actual, authoritative
 * cross-job enforcement point — ramping up slowly from a low floor was only
 * ever a proxy for real admission control, and once real admission control
 * exists, starting low just wastes rounds getting back to where it's safe
 * to be from the start (confirmed live 2026-09-06: this alone cost several
 * minutes of a 10k-row job's wall-clock time for no safety benefit). The
 * instant a round shows a genuine "Exhausted retries" failure (this
 * function's own retry budget giving up, not a normal per-record validation
 * error — a sign the rate limiter itself is failing open, e.g. a DB hiccup),
 * concurrency drops to the floor for the rest of this call as a fallback
 * safety net, then climbs back by one per clean round. Each new chunk call
 * (a fresh serverless invocation) starts back at the ceiling rather than
 * remembering a post-throttle dip, which is fine — the rate limiter, not
 * this ramp, is what actually prevents oversubscription now.
 */
export async function runBatchedChunkLoop(
  jobId: string,
  cursor: number,
  total: number,
  processGroup: (indices: number[]) => Promise<ItemResult[]>,
  batchSize: number = QBO_BATCH_SIZE,
  startConcurrency: number = QBO_BATCH_CONCURRENCY_CEILING,
): Promise<{ processedTo: number }> {
  const started = Date.now();
  let i = cursor;
  let n = 0;
  let concurrency = startConcurrency;
  while (i < total && n < MAX_ITEMS_PER_CHUNK && (Date.now() - started) < TIME_BUDGET_MS) {
    // Carve out up to `concurrency` groups of `batchSize` for this round.
    const groups: number[][] = [];
    let gi = i, gn = n;
    for (let c = 0; c < concurrency && gi < total && gn < MAX_ITEMS_PER_CHUNK; c++) {
      const groupSize = Math.min(batchSize, total - gi, MAX_ITEMS_PER_CHUNK - gn);
      groups.push(Array.from({ length: groupSize }, (_, k) => gi + k));
      gi += groupSize; gn += groupSize;
    }

    const settled = await Promise.allSettled(groups.map((indices) => processGroup(indices)));
    let throttled = false;
    for (let g = 0; g < groups.length; g++) {
      const indices = groups[g];
      const outcome = settled[g];
      const results: ItemResult[] = outcome.status === "fulfilled" && outcome.value.length === indices.length
        ? outcome.value
        : indices.map(() => ({ ok: false, error: outcome.status === "rejected" ? (outcome.reason?.message || "Unexpected error") : "processGroup returned a different count than requested" }));
      // Confirmed live 2026-09-06: a 429 that's still 429 on the LAST retry
      // attempt returns qboBatch's per-item extractQboError text ("QBO
      // request failed (HTTP 429)"), not the generic "Exhausted retries" —
      // that string only appears when every attempt threw (a network error),
      // not when every attempt got a clean-but-throttled HTTP response. The
      // original /exhausted retries/i check alone missed this entirely, so
      // concurrency kept ramping UP while a job was actively drowning in
      // unresolved 429s (caught running two large jobs against the same
      // sandbox org at once — real, current throttling, not a fluke).
      for (const r of results) if (!r.ok && /exhausted retries|\(http 429\)|too many requests/i.test(String(r.error))) throttled = true;
      for (let k = 0; k < indices.length; k++) {
        await recordItem(jobId, indices[k], results[k]);
      }
    }
    i = gi; n = gn;
    concurrency = throttled
      ? QBO_BATCH_CONCURRENCY
      : Math.min(concurrency + 1, QBO_BATCH_CONCURRENCY_CEILING);
  }
  return { processedTo: i };
}
