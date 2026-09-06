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

export interface SlotResult {
  ok: boolean;
  /** How long to wait before trying again (only meaningful when ok === false). */
  retryAfterMs: number;
}

/** Acquire one Batch-endpoint slot for this realm. Always release() it after, success or failure. */
export async function acquireBatchSlot(realmId: string): Promise<SlotResult> {
  const paced = await rateLimit(`qbo-batch:${realmId}`, MAX_PER_MINUTE, 60).catch(() => ({ ok: true, retryAfter: 0 }));
  if (!paced.ok) return { ok: false, retryAfterMs: paced.retryAfter * 1000 };

  try {
    const res: any = await db.execute(sql`
      INSERT INTO qbo_rate_limits (realm_id, in_flight, updated_at)
      VALUES (${realmId}, 1, now())
      ON CONFLICT (realm_id) DO UPDATE SET
        in_flight = CASE WHEN qbo_rate_limits.updated_at < now() - make_interval(secs => ${STALE_MS / 1000})
                         THEN 1 ELSE qbo_rate_limits.in_flight + 1 END,
        updated_at = now()
      WHERE qbo_rate_limits.updated_at < now() - make_interval(secs => ${STALE_MS / 1000})
         OR qbo_rate_limits.in_flight < ${MAX_CONCURRENT}
      RETURNING in_flight
    `);
    const rows = Array.isArray(res) ? res : res?.rows ?? [];
    return rows[0] ? { ok: true, retryAfterMs: 0 } : { ok: false, retryAfterMs: 1500 };
  } catch (e: any) {
    console.warn("acquireBatchSlot fail-open:", e?.message);
    return { ok: true, retryAfterMs: 0 };
  }
}

export async function releaseBatchSlot(realmId: string): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE qbo_rate_limits SET in_flight = GREATEST(in_flight - 1, 0), updated_at = now()
      WHERE realm_id = ${realmId}
    `);
  } catch (e: any) {
    console.warn("releaseBatchSlot failed:", e?.message);
  }
}
