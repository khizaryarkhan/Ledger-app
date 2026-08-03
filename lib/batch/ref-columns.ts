/**
 * Maps template columns to the QBO list they reference, so the import UI can
 * offer a dropdown of real QuickBooks values (Customer, Supplier, Item, Account,
 * Tax Code, Class, Location, Payment Method, Terms) instead of free text.
 *
 * A value typed in one of these columns must already exist in QuickBooks — the
 * dropdown lets the user pick the correct one rather than have the row fail.
 */

import type { RefKind } from "./ref-resolver";
import type { BatchEntity } from "./types";

export function refKindForColumn(column: string): RefKind | null {
  const c = column.trim().toLowerCase();

  if ([
    "customer", "expense customer", "line item customer", "parent customer",
    "received from", "billable customer:product/service",
  ].includes(c)) return "Customer";

  if (c === "vendor" || c === "payee") return "Vendor";

  if (["product/service", "service", "line item"].includes(c)) return "Item";

  if ([
    "account", "bank account", "expense account", "income account", "line account",
    "deposit to", "deposit to account", "deposit to account name", "refunded from",
    "transfer funds from", "transfer funds to", "adjustment account", "discount account",
    "accounts payable account name", "bank or cc account", "credit card account",
    "cash back goes to", "parent account", "inventory asset account",
  ].includes(c)) return "Account";

  if ([
    "class", "product/service class", "expense class", "line item class",
    "line class", "parent class",
  ].includes(c)) return "Class";

  if (c === "location" || c === "parent location") return "Department";

  if (c === "sales tax code" || c === "tax code") return "TaxCode";

  if (["payment method", "preferred payment method", "line payment method"].includes(c)) return "PaymentMethod";

  if (c === "terms") return "Term";

  return null;
}

export interface RefColumn { column: string; kind: RefKind; }

/** All reference columns for an entity, in template order. */
export function entityRefColumns(entity: BatchEntity): RefColumn[] {
  const out: RefColumn[] = [];
  const seen = new Set<string>();
  for (const col of entity.columns) {
    const c = col.trim();
    if (seen.has(c)) continue;
    seen.add(c);
    const kind = refKindForColumn(c);
    if (kind) out.push({ column: c, kind });
  }
  return out;
}

/** Distinct RefKinds an entity references (for preloading). */
export function entityRefKinds(entity: BatchEntity): RefKind[] {
  return [...new Set(entityRefColumns(entity).map((r) => r.kind))];
}
