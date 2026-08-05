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

/** Parse a Xero JSON date — either "/Date(1610000000000+0000)/" or ISO — to YYYY-MM-DD. */
export function xeroDate(v: any): string | undefined {
  if (!v) return undefined;
  const s = String(v);
  const m = s.match(/\/Date\((\d+)/);
  if (m) return new Date(Number(m[1])).toISOString().slice(0, 10);
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : undefined;
}
