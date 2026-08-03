/**
 * Resolves human-readable names in an uploaded spreadsheet (Customer, Item,
 * Account, Class, Vendor, Payment Method, Term, Location) to the QBO Ref IDs
 * the create/update API requires.
 *
 * Each list type is queried from QBO once per job and cached, so a 500-row
 * upload does not issue 500 lookups.
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
  Employee: "DisplayName",
};

export class RefResolver {
  private token: OrgQboToken;
  private cache = new Map<RefKind, Map<string, { value: string; name: string }>>();

  constructor(token: OrgQboToken) {
    this.token = token;
  }

  /** Pre-load one or more list types up front (parallel). */
  async preload(kinds: RefKind[]): Promise<void> {
    const unique = [...new Set(kinds)];
    await Promise.all(unique.map((k) => this.ensure(k)));
  }

  private async ensure(kind: RefKind): Promise<Map<string, { value: string; name: string }>> {
    const existing = this.cache.get(kind);
    if (existing) return existing;

    const map = new Map<string, { value: string; name: string }>();
    try {
      const records = await qboQueryAll(this.token, READ_NAME[kind]);
      const nameField = NAME_FIELD[kind];
      for (const r of records) {
        const name: string = r[nameField] || r.Name || "";
        if (name) map.set(name.trim().toLowerCase(), { value: r.Id, name });
        // Items/Customers can be referenced by fully-qualified sub-name too.
        if (r.FullyQualifiedName) {
          map.set(r.FullyQualifiedName.trim().toLowerCase(), { value: r.Id, name: r.FullyQualifiedName });
        }
      }
    } catch {
      // Leave the cache empty; resolve() will report misses as errors.
    }
    this.cache.set(kind, map);
    return map;
  }

  /**
   * Resolve a name to a QBO Ref { value, name }.
   * Returns null if the name is blank; throws a descriptive error on a miss
   * so the row can be flagged in the preview.
   */
  async resolve(kind: RefKind, rawName: string | null | undefined): Promise<{ value: string; name: string } | null> {
    if (rawName == null || String(rawName).trim() === "") return null;
    const map = await this.ensure(kind);
    const hit = map.get(String(rawName).trim().toLowerCase());
    if (!hit) {
      throw new Error(`${kind} "${rawName}" not found in QuickBooks`);
    }
    return hit;
  }

  /** Non-throwing variant — returns null on a miss. */
  async tryResolve(kind: RefKind, rawName: string | null | undefined): Promise<{ value: string; name: string } | null> {
    try {
      return await this.resolve(kind, rawName);
    } catch {
      return null;
    }
  }
}
