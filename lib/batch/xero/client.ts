/**
 * Xero API client for Data Studio (read side first).
 * Mirrors the shape of the QBO client but for Xero's api.xro/2.0 endpoints.
 */

import type { OrgXeroToken } from "@/lib/xero-token";

const XERO_API = "https://api.xero.com/api.xro/2.0";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch all records of a Xero entity (plural endpoint name, e.g. "Invoices"),
 * paginating 100 at a time. `where` is a Xero filter expression.
 */
export async function xeroQueryAll(
  token: OrgXeroToken,
  entity: string,
  where?: string,
): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  while (true) {
    const params = new URLSearchParams();
    if (where) params.set("where", where);
    params.set("page", String(page));
    params.set("pageSize", "100");
    const res = await fetch(`${XERO_API}/${entity}?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Xero-Tenant-Id": token.tenantId,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Xero ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = await res.json();
    const records: any[] = json[entity] || [];
    all.push(...records);
    if (records.length < 100) break;
    page += 1;
    await sleep(250);
  }
  return all;
}

export interface XeroResult { ok: boolean; data?: any; error?: string; status?: number; }

/**
 * Create or update a Xero record. POST to the plural endpoint with the element
 * wrapped in its collection. Presence of the record's id in the payload makes
 * it an update (Xero matches by id — there is no SyncToken).
 */
export async function xeroPost(token: OrgXeroToken, entity: string, payload: any): Promise<XeroResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${XERO_API}/${entity}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          "Xero-Tenant-Id": token.tenantId,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ [entity]: [payload] }),
      });
      if (res.status === 429 || res.status >= 500) { await sleep(600 * (attempt + 1)); continue; }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: extractXeroError(json, res.status), status: res.status };
      return { ok: true, data: json, status: res.status };
    } catch (e: any) {
      if (attempt === 2) return { ok: false, error: e?.message || "Network error" };
      await sleep(600 * (attempt + 1));
    }
  }
  return { ok: false, error: "Exhausted retries" };
}

/** HTTP DELETE a Xero record (Items, Accounts). */
export async function xeroHttpDelete(token: OrgXeroToken, entity: string, id: string): Promise<XeroResult> {
  try {
    const res = await fetch(`${XERO_API}/${entity}/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token.accessToken}`, "Xero-Tenant-Id": token.tenantId, Accept: "application/json" },
    });
    if (res.ok) return { ok: true };
    const json = await res.json().catch(() => ({}));
    return { ok: false, error: extractXeroError(json, res.status), status: res.status };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Network error" };
  }
}

function extractXeroError(json: any, status: number): string {
  // Xero validation errors: Elements[].ValidationErrors[].Message
  const el = json?.Elements?.[0]?.ValidationErrors?.[0]?.Message;
  if (el) return el;
  if (json?.Message) return json.Message;
  return `Xero request failed (HTTP ${status})`;
}

/** Parse a Xero JSON date — either "/Date(1610000000000+0000)/" or ISO — to YYYY-MM-DD. */
export function xeroDate(v: any): string | undefined {
  if (!v) return undefined;
  const s = String(v);
  const m = s.match(/\/Date\((\d+)/);
  if (m) return new Date(Number(m[1])).toISOString().slice(0, 10);
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : undefined;
}
