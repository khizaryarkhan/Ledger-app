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

// Hard ceiling per QBO request. A hung connection with no timeout never
// resolves OR rejects, so it slips past every try/catch and pins the batch job
// at "running" until the platform kills the function. AbortSignal.timeout makes
// it reject instead, so the job can fail cleanly and surface a real error.
const QBO_TIMEOUT_MS = 45_000;

export interface QboResult<T = any> {
  ok: boolean;
  data?: T;
  error?: string;
  status?: number;
  intuitTid?: string | null;   // QBO's intuit_tid response header — quote in support tickets
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
        signal: AbortSignal.timeout(QBO_TIMEOUT_MS),
      });

      if (res.status === 429 || res.status >= 500) {
        await sleep(500 * (attempt + 1));
        continue;
      }

      const intuitTid = res.headers.get("intuit_tid");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: extractQboError(json, res.status), status: res.status, intuitTid };
      }
      return { ok: true, data: json, status: res.status, intuitTid };
    } catch (e: any) {
      if (attempt === 2) return { ok: false, error: e?.message || "Network error" };
      await sleep(500 * (attempt + 1));
    }
  }
  return { ok: false, error: "Exhausted retries" };
}

/**
 * `entity` must be QBO's exact PascalCase resource name as it appears in the
 * Batch envelope AND in query-language FROM clauses — e.g. "Invoice",
 * "PurchaseOrder", "CreditMemo", "JournalEntry", "TimeActivity". NOT the
 * lowercase REST path segment (BatchEntity.qboEntity, e.g.
 * "purchaseorder") — that's a different, unrelated casing used only in
 * qboPost's URL. Confirmed live 2026-09-05 (Foodready.ai QBO Sandbox, full
 * entity load-test pass): this field used to just be BatchEntity.qboEntity
 * naively title-cased (`charAt(0).toUpperCase()`), which only ever
 * happened to work for single-word entities (Invoice, Bill, Deposit, ...) —
 * the day multi-word entities (PurchaseOrder, CreditMemo, SalesReceipt,
 * RefundReceipt, BillPayment, VendorCredit, JournalEntry, TimeActivity)
 * started using this path too, QBO rejected every one of them with
 * "Property Name:{0} specified is unsupported or invalid" (it received a
 * JSON body keyed "Purchaseorder", "Creditmemo", etc — not a name it
 * recognizes). Use BatchEntity.qboReadName (already correct — it's the
 * same name query-language FROM clauses use) when building a BatchItem,
 * never qboEntity.
 */
export type BatchItem = { bId: string; entity: string; operation?: "create" | "update" | "delete"; payload: any };
export type BatchItemResult = { bId: string; ok: boolean; data?: any; error?: string };

/**
 * QBO's native Batch endpoint — up to 30 operations in ONE HTTP request,
 * instead of qboPost's one-request-per-record. This is the missing piece
 * that made bulk imports far slower here than in QBO-native bulk tools
 * (SaasAnt/Transaction Pro): every row was paying its own full network
 * round-trip to Intuit (~1-1.5s each) when QBO explicitly supports bundling
 * up to 30 of them into one. See CLAUDE.md's Data Studio section for the
 * 2026-09-03 investigation this came out of.
 *
 * Each item gets its own `bId` (caller-assigned, just needs to be unique
 * within the request) so results can be matched back to the row that
 * produced them — QBO's BatchItemResponse order is not guaranteed to match
 * the request order.
 */
export async function qboBatch(
  token: OrgQboToken,
  items: BatchItem[],
): Promise<BatchItemResult[]> {
  if (items.length === 0) return [];
  if (items.length > 30) throw new Error(`qboBatch: ${items.length} items exceeds QBO's 30-per-request limit`);

  const body = {
    BatchItemRequest: items.map((it) => ({
      bId: it.bId,
      operation: it.operation === "update" ? "update" : it.operation === "delete" ? "delete" : "create",
      [it.entity]: it.payload,
    })),
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${QBO_API}/${token.realmId}/batch?${MINOR}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(QBO_TIMEOUT_MS),
      });

      if (res.status === 429 || res.status >= 500) {
        await sleep(500 * (attempt + 1));
        continue;
      }

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The whole request was rejected (bad auth, malformed envelope, ...) —
        // every item in it failed for the same reason.
        const err = extractQboError(json, res.status);
        return items.map((it) => ({ bId: it.bId, ok: false, error: err }));
      }

      const responses: any[] = json.BatchItemResponse || [];
      const byId = new Map(responses.map((r) => [r.bId, r]));
      return items.map((it) => {
        const r = byId.get(it.bId);
        if (!r) return { bId: it.bId, ok: false, error: "No response for this item in QBO's batch reply" };
        if (r.Fault) return { bId: it.bId, ok: false, error: extractQboError(r, res.status) };
        const key = Object.keys(r).find((k) => k !== "bId" && k !== "time");
        return { bId: it.bId, ok: true, data: key ? r[key] : undefined };
      });
    } catch (e: any) {
      if (attempt === 2) {
        const err = e?.message || "Network error";
        return items.map((it) => ({ bId: it.bId, ok: false, error: err }));
      }
      await sleep(500 * (attempt + 1));
    }
  }
  return items.map((it) => ({ bId: it.bId, ok: false, error: "Exhausted retries" }));
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
        signal: AbortSignal.timeout(QBO_TIMEOUT_MS),
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
