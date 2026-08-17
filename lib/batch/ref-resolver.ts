/**
 * Resolves list references between spreadsheet names and QBO Ref IDs, both ways:
 *  - name → { value, name }   (upload: turn "Class 1" into a ClassRef)
 *  - id   → name              (download/sample: turn a ClassRef id into "Class 1")
 *
 * Each list type is queried from QBO once per job and cached (forward + reverse),
 * so a large file does not issue a lookup per row.
 */

import type { OrgQboToken } from "@/lib/qbo-token";
import { qboQueryAll } from "./qbo-client";

export type RefKind =
  | "Customer"
  | "Vendor"
  | "Item"
  | "Account"
  | "Class"
  | "Department"
  | "PaymentMethod"
  | "Term"
  | "TaxCode"
  | "Employee";

const READ_NAME: Record<RefKind, string> = {
  Customer: "Customer",
  Vendor: "Vendor",
  Item: "Item",
  Account: "Account",
  Class: "Class",
  Department: "Department",
  PaymentMethod: "PaymentMethod",
  Term: "Term",
  TaxCode: "TaxCode",
  Employee: "Employee",
};

// QBO field that holds the display name for each list type.
const NAME_FIELD: Record<RefKind, string> = {
  Customer: "DisplayName",
  Vendor: "DisplayName",
  Item: "Name",
  Account: "Name",
  Class: "Name",
  Department: "Name",
  PaymentMethod: "Name",
  Term: "Name",
  TaxCode: "Name",
  Employee: "DisplayName",
};

/**
 * The connected QuickBooks company's configuration, read once per job so the
 * engine adapts to whatever region/setup the org uses (US automated sales tax
 * vs. Ireland/UK/Pakistan VAT/GST, home currency, multicurrency).
 */
export interface CompanyProfile {
  country: string;          // ISO-ish country, uppercased ("US", "IE", "PK", "GB")
  isUS: boolean;            // US automated-sales-tax model vs. everyone else
  homeCurrency: string;     // "USD", "EUR", "PKR"
  multicurrency: boolean;
  taxEnabled: boolean;      // company charges sales tax / VAT / GST at all
  customTxnNumbers: boolean; // QBO honours a supplied DocNumber only when this is on
  classPerLine: boolean;    // Class tracked per line (vs per whole transaction)
}

export class RefResolver {
  private token: OrgQboToken;
  private forward = new Map<RefKind, Map<string, { value: string; name: string }>>();
  private reverse = new Map<RefKind, Map<string, string>>();
  private profile: CompanyProfile | null = null;

  constructor(token: OrgQboToken) {
    this.token = token;
  }

  /** Read (and cache) the connected company's country / currency / tax setup. */
  async company(): Promise<CompanyProfile> {
    if (this.profile) return this.profile;
    let country = "US", homeCurrency = "USD", multicurrency = false, taxEnabled = false, customTxnNumbers = false, classPerLine = false;
    try {
      const ci = (await qboQueryAll(this.token, "CompanyInfo"))[0];
      country = ci?.Country || ci?.LegalAddr?.Country || ci?.CompanyAddr?.Country || "US";
    } catch { /* default US */ }
    try {
      const prefs = (await qboQueryAll(this.token, "Preferences"))[0];
      homeCurrency = prefs?.CurrencyPrefs?.HomeCurrency?.value || homeCurrency;
      multicurrency = !!prefs?.CurrencyPrefs?.MultiCurrencyEnabled;
      taxEnabled = !!prefs?.TaxPrefs?.UsingSalesTax;
      customTxnNumbers = !!prefs?.SalesFormsPrefs?.CustomTxnNumbers;
      classPerLine = !!prefs?.AccountingInfoPrefs?.ClassTrackingPerTxnLine;
    } catch { /* leave defaults */ }
    const c = String(country).toUpperCase();
    const isUS = c === "US" || c === "USA" || c === "UNITED STATES";
    this.profile = { country: c, isUS, homeCurrency, multicurrency, taxEnabled, customTxnNumbers, classPerLine };
    return this.profile;
  }

  /** Pre-load one or more list types up front (parallel). */
  async preload(kinds: RefKind[]): Promise<void> {
    const unique = [...new Set(kinds)];
    await Promise.all(unique.map((k) => this.ensure(k)));
  }

  private async ensure(kind: RefKind): Promise<Map<string, { value: string; name: string }>> {
    const existing = this.forward.get(kind);
    if (existing) return existing;

    const fwd = new Map<string, { value: string; name: string }>();
    const rev = new Map<string, string>();
    try {
      const records = await qboQueryAll(this.token, READ_NAME[kind]);
      const nameField = NAME_FIELD[kind];
      for (const r of records) {
        const name: string = r[nameField] || r.Name || "";
        if (name) fwd.set(name.trim().toLowerCase(), { value: r.Id, name });
        if (r.FullyQualifiedName) {
          fwd.set(r.FullyQualifiedName.trim().toLowerCase(), { value: r.Id, name: r.FullyQualifiedName });
        }
        if (r.Id) rev.set(String(r.Id), r.FullyQualifiedName || name || String(r.Id));
      }
    } catch {
      // Leave caches empty; misses degrade gracefully.
    }
    this.forward.set(kind, fwd);
    this.reverse.set(kind, rev);
    return fwd;
  }

  /** name → Ref { value, name }. Blank → null; a miss throws (flag the row). */
  async resolve(kind: RefKind, rawName: string | null | undefined): Promise<{ value: string; name: string } | null> {
    if (rawName == null || String(rawName).trim() === "") return null;
    const map = await this.ensure(kind);
    const hit = map.get(String(rawName).trim().toLowerCase());
    if (!hit) throw new Error(`${kind} "${rawName}" not found in QuickBooks`);
    return hit;
  }

  /** Non-throwing name → Ref. */
  async tryResolve(kind: RefKind, rawName: string | null | undefined): Promise<{ value: string; name: string } | null> {
    try { return await this.resolve(kind, rawName); } catch { return null; }
  }

  /** All distinct display names for a list type, sorted (for dropdowns). */
  async listNames(kind: RefKind): Promise<string[]> {
    const fwd = await this.ensure(kind);
    const names = new Set<string>();
    for (const v of fwd.values()) names.add(v.name);
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  /** All { id, name } for a list type, deduped by id, sorted (for pickers that
   *  need the id — e.g. filtering by CustomerRef or setting a ClassRef). */
  async listRefs(kind: RefKind): Promise<{ id: string; name: string }[]> {
    const fwd = await this.ensure(kind);
    const byId = new Map<string, string>();
    for (const v of fwd.values()) if (!byId.has(v.value)) byId.set(v.value, v.name);
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** id → display name (for download/sample). Falls back to the id if unknown. */
  async nameFor(kind: RefKind, id: string | null | undefined): Promise<string | undefined> {
    if (id == null || String(id).trim() === "") return undefined;
    await this.ensure(kind);
    return this.reverse.get(kind)?.get(String(id)) ?? undefined;
  }

  // ── Transaction resolution for payment application (Invoice / Bill) ──────────
  // Payments link to invoices/bills by the transaction's INTERNAL Id, but the
  // spreadsheet carries the document NUMBER. These resolve number↔Id on demand
  // (there are too many invoices/bills to preload), scoped to the customer/vendor
  // and preferring an open (Balance > 0) document, and cache the result.
  private txnIdByDoc = new Map<string, string | null>();
  private txnDocById = new Map<string, string | null>();

  /** Upload: an Invoice's internal Id from its number, scoped to a customer. */
  async resolveInvoiceId(docNumber: string, customerId?: string): Promise<string | null> {
    return this.resolveTxnId("Invoice", docNumber, customerId ? `CustomerRef = '${esc(customerId)}'` : undefined, customerId);
  }
  /** Upload: a Bill's internal Id from its number, scoped to a vendor. */
  async resolveBillId(docNumber: string, vendorId?: string): Promise<string | null> {
    return this.resolveTxnId("Bill", docNumber, vendorId ? `VendorRef = '${esc(vendorId)}'` : undefined, vendorId);
  }
  private async resolveTxnId(entity: "Invoice" | "Bill", docNumber: string, extraWhere: string | undefined, scopeId?: string): Promise<string | null> {
    const key = `${entity}:${String(docNumber).trim().toLowerCase()}|${scopeId ?? ""}`;
    if (this.txnIdByDoc.has(key)) return this.txnIdByDoc.get(key)!;
    let where = `DocNumber = '${esc(docNumber)}'`;
    if (extraWhere) where += ` AND ${extraWhere}`;
    const recs = await qboQueryAll(this.token, entity, where).catch(() => []);
    // Prefer an open document (a payment applies to something with a balance).
    const pick = recs.find((r: any) => Number(r.Balance) > 0.005) ?? recs[0];
    const id = pick ? String(pick.Id) : null;
    this.txnIdByDoc.set(key, id);
    return id;
  }

  /** Download: an Invoice's number from its internal Id. */
  async invoiceNumberFor(id: string | null | undefined): Promise<string | undefined> {
    return this.txnDocNumber("Invoice", id);
  }
  /** Download: a Bill's number from its internal Id. */
  async billNumberFor(id: string | null | undefined): Promise<string | undefined> {
    return this.txnDocNumber("Bill", id);
  }
  private async txnDocNumber(entity: "Invoice" | "Bill", id: string | null | undefined): Promise<string | undefined> {
    if (id == null || String(id).trim() === "") return undefined;
    const key = `${entity}:${id}`;
    if (this.txnDocById.has(key)) return this.txnDocById.get(key) ?? undefined;
    const recs = await qboQueryAll(this.token, entity, `Id = '${esc(String(id))}'`).catch(() => []);
    const doc = recs[0]?.DocNumber ?? null;
    this.txnDocById.set(key, doc);
    return doc ?? undefined;
  }
}

const esc = (s: string) => String(s).replace(/'/g, "\\'");

/**
 * Resolve a QBO reference object to its display name, preferring the name QBO
 * already returned on the ref and falling back to a reverse lookup by id.
 */
export async function refDisplayName(
  ref: any,
  kind: RefKind,
  refs: RefResolver
): Promise<string | undefined> {
  if (!ref) return undefined;
  if (ref.name) return ref.name;
  return refs.nameFor(kind, ref.value);
}
