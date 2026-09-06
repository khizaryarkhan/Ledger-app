/**
 * Cross-job QBO Batch-endpoint throttle, shared by every Data Studio job
 * against the same realm — not just within one job.
 *
 * Confirmed live 2026-09-06 (Foodready.ai, a real production QBO connection
 * used for testing, not a sandbox): Intuit's own documented production
 * limits (help.developer.intuit.com/s/article/API-call-limits-and-throttling)
 * are 10 concurrent requests/second per realm+app, and — far stricter than
 * the general 500 requests/minute figure — only 40 Batch-endpoint requests
 * per MINUTE, per realm. lib/batch/lease.ts's adaptive concurrency ramp
 * manages concurrency WITHIN one job, but has no idea a second job is
 * hitting the same realm at the same time. Two jobs each independently
 * ramping toward their own ceiling blew past both real limits the moment
 * they overlapped — a 500-row job that ran cleanly alone died to sustained
 * 429s the instant a second job started concurrently.
 *
 * This enforces both limits at the REALM level, across every job:
 *  - 40/min pacing reuses the existing generic, fail-open, Postgres-backed
 *    fixed-window limiter (lib/rate-limit.ts) rather than duplicating it —
 *    budgeted to 35 for headroom.
 *  - 10-concurrent-per-second is a releasable in-flight semaphore
 *    (qbo_rate_limits table) that the generic limiter can't express, since
 *    it only ever increments within a window and never decrements.
 *
 * Fails open on any DB error, matching rate-limit.ts's own philosophy: this
 * must only ever ADD protection, never block a real import because of an
 * infra hiccup.
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { rateLimit } from "@/lib/rate-limit";

// Real ceiling is 10; this leaves headroom for jitter, other concurrent app
// traffic against the same realm (a background sync, say), and the fact
// that "concurrent" is measured by Intuit in a 1-second window, not the
// coarser per-round granularity we can actually observe here. Pushed from 6
// after the user asked for a 10k-row import to complete in well under an
// hour — even at the hard ceiling (10 concurrent, 40/min) the theoretical
// floor for 10,000 records is ~8.4 minutes (334 batch calls / 40 per min),
// so there's no room to be very conservative AND fast; this is the
// deliberate trade of some margin for speed the user asked for.
const MAX_CONCURRENT = 8;
// Real ceiling is 40/min; 38 leaves minimal but real headroom.
const MAX_PER_MINUTE = 38;
// A row nobody has touched in 3 minutes almost certainly belongs to a
// process that crashed without releasing — treat it as free rather than
// let one dead invocation permanently wedge a whole realm's throughput.
const STALE_MS = 180_000;

// Confirmed live 2026-09-06: every QBO fetch in qbo-client.ts has an
// AbortSignal.timeout, but these two DB calls originally had none. A single
// hung db.execute() (not thrown — genuinely never settling) hangs the
// `await` forever, which hangs the enclosing qboBatch call, which hangs the
// whole round's Promise.allSettled with it — no error to catch, no
// fail-open to trigger, just a job frozen at its exact cursor indefinitely.
// A 10k-row job sat at 1050/10000 for 20+ minutes this way. A hard timeout
// here turns an infinite hang into a bounded, recoverable failure, matching
// every other network-facing call in this codebase.
const DB_TIMEOUT_MS = 5_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

export interface SlotResult {
  ok: boolean;
  /** How long to wait before trying again (only meaningful when ok === false). */
  retryAfterMs: number;
}

/**
 * The 10-concurrent-per-second cap is account-wide across EVERY QBO endpoint
 * (Intuit's docs don't carve out an exception per endpoint type) — so the
 * concurrency semaphore has to be shared by qboQueryAll too, not just
 * qboBatch. Confirmed live 2026-09-06: with several jobs still running
 * concurrently in the background, RefResolver's Customer-list fetch (via
 * qboQueryAll, previously ungated) kept failing under the combined load even
 * after fixing its own retry/fail-loud behavior — the list-fetch itself was
 * contending for the same real ceiling as every job's batch creates, just
 * invisibly. Only the concurrency slot applies here, not the 38/min pacing
 * budget — that number is specifically the Batch endpoint's own limit; the
 * query endpoint shares Intuit's general (and much more generous) 500/min.
 */
async function acquireConcurrencySlot(realmId: string): Promise<SlotResult> {
  try {
    const res: any = await withTimeout(db.execute(sql`
      INSERT INTO qbo_rate_limits (realm_id, in_flight, updated_at)
      VALUES (${realmId}, 1, now())
      ON CONFLICT (realm_id) DO UPDATE SET
        in_flight = CASE WHEN qbo_rate_limits.updated_at < now() - make_interval(secs => ${STALE_MS / 1000})
                         THEN 1 ELSE qbo_rate_limits.in_flight + 1 END,
        updated_at = now()
      WHERE qbo_rate_limits.updated_at < now() - make_interval(secs => ${STALE_MS / 1000})
         OR qbo_rate_limits.in_flight < ${MAX_CONCURRENT}
      RETURNING in_flight
    `), DB_TIMEOUT_MS, "acquireConcurrencySlot");
    const rows = Array.isArray(res) ? res : res?.rows ?? [];
    return rows[0] ? { ok: true, retryAfterMs: 0 } : { ok: false, retryAfterMs: 1500 };
  } catch (e: any) {
    console.warn("acquireConcurrencySlot fail-open:", e?.message);
    return { ok: true, retryAfterMs: 0 };
  }
}

async function releaseConcurrencySlot(realmId: string): Promise<void> {
  try {
    await withTimeout(db.execute(sql`
      UPDATE qbo_rate_limits SET in_flight = GREATEST(in_flight - 1, 0), updated_at = now()
      WHERE realm_id = ${realmId}
    `), DB_TIMEOUT_MS, "releaseConcurrencySlot");
  } catch (e: any) {
    console.warn("releaseConcurrencySlot failed:", e?.message);
  }
}

/** Acquire one Batch-endpoint slot for this realm (pacing + concurrency). Always release() it after, success or failure. */
export async function acquireBatchSlot(realmId: string): Promise<SlotResult> {
  const paced = await withTimeout(rateLimit(`qbo-batch:${realmId}`, MAX_PER_MINUTE, 60), DB_TIMEOUT_MS, "rateLimit")
    .catch(() => ({ ok: true, retryAfter: 0 }));
  if (!paced.ok) return { ok: false, retryAfterMs: paced.retryAfter * 1000 };
  return acquireConcurrencySlot(realmId);
}

export const releaseBatchSlot = releaseConcurrencySlot;

/** Acquire one concurrency slot for a non-Batch QBO call (query, single-record post). No 38/min pacing — that budget is Batch-specific. */
export const acquireQuerySlot = acquireConcurrencySlot;
export const releaseQuerySlot = releaseConcurrencySlot;
