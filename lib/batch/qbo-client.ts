/**
 * Generic QuickBooks Online client for Batch Functions.
 *
 * Thin wrappers around the QBO v3 REST API used by all four batch operations
 * (Bulk Upload = create, Download = query, Delete, Modify = sparse update).
 *
 * Every call takes an already-resolved { accessToken, realmId } so callers
 * fetch the token once per job and reuse it across a batch.
 */

import type { OrgQboToken } from "@/lib/qbo-token";

const QBO_API = "https://quickbooks.api.intuit.com/v3/company";
const MINOR = "minorversion=73";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface QboResult<T = any> {
  ok: boolean;
  data?: T;
  error?: string;
  status?: number;
}

/**
 * POST a create/update to a QBO entity endpoint.
 * `entity` is the lowercase API path segment, e.g. "invoice", "bill", "customer".
 */
export async function qboPost(
  token: OrgQboToken,
  entity: string,
  body: any,
  opts: { operation?: "create" | "update" | "delete" } = {}
): Promise<QboResult> {
  const qs = opts.operation ? `?operation=${opts.operation}&${MINOR}` : `?${MINOR}`;
  // Up to 3 attempts on 429/5xx with backoff — QBO throttles at ~500 req/min.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${QBO_API}/${token.realmId}/${entity}${qs}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });

      if (res.status === 429 || res.status >= 500) {
        await sleep(500 * (attempt + 1));
        continue;
      }

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: extractQboError(json, res.status), status: res.status };
      }
      return { ok: true, data: json, status: res.status };
    } catch (e: any) {
      if (attempt === 2) return { ok: false, error: e?.message || "Network error" };
      await sleep(500 * (attempt + 1));
    }
  }
  return { ok: false, error: "Exhausted retries" };
}

/**
 * Run a QBO SQL-like query and return the matched records.
 * Handles pagination automatically (500 per page).
 */
export async function qboQueryAll(
  token: OrgQboToken,
  readName: string,
  where = ""
): Promise<any[]> {
  const all: any[] = [];
  let start = 1;
  const size = 500;
  while (true) {
    const whereClause = where ? ` where ${where}` : "";
    const sql = `select * from ${readName}${whereClause} STARTPOSITION ${start} MAXRESULTS ${size}`;
    const res = await fetch(
      `${QBO_API}/${token.realmId}/query?query=${encodeURIComponent(sql)}&${MINOR}`,
      {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          Accept: "application/json",
        },
      }
    );
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(extractQboError(json, res.status));
    }
    const json = await res.json();
    const records = json.QueryResponse?.[readName] || [];
    all.push(...records);
    if (records.length < size) break;
    start += size;
    await sleep(200);
  }
  return all;
}

/**
 * Fetch the most-recently-updated N records of an entity (for sample data in
 * templates). Returns [] on any error so callers can degrade gracefully.
 */
export async function qboQueryTop(
  token: OrgQboToken,
  readName: string,
  limit = 10,
  where = ""
): Promise<any[]> {
  const whereClause = where ? ` where ${where}` : "";
  const sql = `select * from ${readName}${whereClause} ORDER BY MetaData.LastUpdatedTime DESC MAXRESULTS ${limit}`;
  try {
    const res = await fetch(
      `${QBO_API}/${token.realmId}/query?query=${encodeURIComponent(sql)}&${MINOR}`,
      { headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "application/json" } }
    );
    if (!res.ok) return [];
    const json = await res.json();
    return json.QueryResponse?.[readName] || [];
  } catch {
    return [];
  }
}

/**
 * Count matching records without pulling them all (cheap preview).
 */
export async function qboCount(
  token: OrgQboToken,
  readName: string,
  where = ""
): Promise<number> {
  const whereClause = where ? ` where ${where}` : "";
  const sql = `select count(*) from ${readName}${whereClause}`;
  const res = await fetch(
    `${QBO_API}/${token.realmId}/query?query=${encodeURIComponent(sql)}&${MINOR}`,
    { headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "application/json" } }
  );
  if (!res.ok) return 0;
  const json = await res.json();
  return json.QueryResponse?.totalCount ?? 0;
}

/**
 * Delete a transaction (requires Id + SyncToken).
 * Master-list entities (Customer, Vendor, Item, Account) cannot be hard-deleted
 * via the API — they are made inactive instead (handled by the caller).
 */
export async function qboDelete(
  token: OrgQboToken,
  entity: string,
  id: string,
  syncToken: string
): Promise<QboResult> {
  return qboPost(token, entity, { Id: id, SyncToken: syncToken }, { operation: "delete" });
}

/**
 * Pull the current SyncToken for a record (needed for update/delete).
 */
export async function qboReadOne(
  token: OrgQboToken,
  entity: string,
  id: string
): Promise<any | null> {
  const res = await fetch(`${QBO_API}/${token.realmId}/${entity}/${id}?${MINOR}`, {
    headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) return null;
  const json = await res.json();
  // Response is keyed by the capitalized entity name, e.g. { Invoice: {...} }
  const key = Object.keys(json).find((k) => k !== "time");
  return key ? json[key] : null;
}

function extractQboError(json: any, status: number): string {
  const fault = json?.Fault?.Error?.[0];
  if (fault) {
    const detail = fault.Detail ? ` — ${fault.Detail}` : "";
    return `${fault.Message || "QBO error"}${detail}`;
  }
  return `QBO request failed (HTTP ${status})`;
}
