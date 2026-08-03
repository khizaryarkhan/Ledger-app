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

export class RefResolver {
  private token: OrgQboToken;
  private forward = new Map<RefKind, Map<string, { value: string; name: string }>>();
  private reverse = new Map<RefKind, Map<string, string>>();

  constructor(token: OrgQboToken) {
    this.token = token;
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

  /** id → display name (for download/sample). Falls back to the id if unknown. */
  async nameFor(kind: RefKind, id: string | null | undefined): Promise<string | undefined> {
    if (id == null || String(id).trim() === "") return undefined;
    await this.ensure(kind);
    return this.reverse.get(kind)?.get(String(id)) ?? undefined;
  }
}

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
