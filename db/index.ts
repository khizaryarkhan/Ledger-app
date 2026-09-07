import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

neonConfig.fetchConnectionCache = true;

// neon-http sends every query as its own fetch() call — a single transient
// network blip (DNS hiccup, connection reset, brief Neon-side unavailability)
// surfaces as `TypeError: fetch failed` with no retry, failing the whole
// request outright. High-traffic orgs (heavy QBO webhook volume) hit this
// often enough to see real, recurring sync failures ("Error connecting to
// database: fetch failed" in sync history, sometimes on the majority of a
// day's webhook events). Retry a bounded number of times with backoff, but
// ONLY when fetch() itself throws (the connection never got a response) —
// an actual HTTP response, including a Postgres error status, is returned
// as-is and is NOT retried here, since that's a real query error, not a
// transient connectivity failure.
const FETCH_RETRY_DELAYS_MS = [200, 600, 1500];

async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(input, init);
    } catch (err) {
      if (attempt >= FETCH_RETRY_DELAYS_MS.length) throw err;
      console.warn(`neon fetch failed (attempt ${attempt + 1}/${FETCH_RETRY_DELAYS_MS.length + 1}), retrying:`, (err as any)?.message || err);
      await new Promise((r) => setTimeout(r, FETCH_RETRY_DELAYS_MS[attempt]));
    }
  }
}

neonConfig.fetchFunction = fetchWithRetry;

// Lazy singleton — DATABASE_URL only needs to exist at runtime, not build time.
// Throwing at module level breaks Next.js build-time page-data collection on Vercel.
let _db: NeonHttpDatabase<typeof schema> | null = null;

function getDb(): NeonHttpDatabase<typeof schema> {
  if (!_db) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set. Add it to your .env file or Vercel environment variables.");
    }
    const sql = neon(process.env.DATABASE_URL);
    _db = drizzle(sql, { schema });
  }
  return _db;
}

export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_, prop: string) {
    return (getDb() as any)[prop];
  },
});

export { schema };
