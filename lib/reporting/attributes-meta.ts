/**
 * Client-safe catalogue of the source attributes + operators the rule builder
 * offers. Keep in sync with the ATTRIBUTES registry in engine.ts (that registry
 * is the runtime source of truth; this is the friendly UI surface). Adding an
 * attribute = one entry here + one in ATTRIBUTES — no engine change.
 */
import type { LeafOperator } from "./types";

export type AttrType = "string" | "number" | "date" | "bool";

export interface AttributeMeta { key: string; label: string; group: string; type: AttrType; }

export const ATTRIBUTE_META: AttributeMeta[] = [
  // Chart of Accounts
  { key: "accountName",   label: "Account name",       group: "Account",     type: "string" },
  { key: "accountNumber", label: "Account number",     group: "Account",     type: "string" },
  { key: "accountType",   label: "Account type",       group: "Account",     type: "string" },
  { key: "accountSubType",label: "Account subtype",    group: "Account",     type: "string" },
  { key: "accountId",     label: "Account (QBO Id)",   group: "Account",     type: "string" },
  // Tracking
  { key: "className",     label: "Class",              group: "Tracking",    type: "string" },
  { key: "locationName",  label: "Location / Dept",    group: "Tracking",    type: "string" },
  // Parties
  { key: "customerName",       label: "Customer",           group: "Parties", type: "string" },
  { key: "customerParentName", label: "Customer parent",    group: "Parties", type: "string" },
  { key: "vendorName",         label: "Vendor",             group: "Parties", type: "string" },
  // Item
  { key: "itemName",      label: "Item / Product / Service", group: "Item",   type: "string" },
  // Transaction
  { key: "txnType",       label: "Transaction type",   group: "Transaction", type: "string" },
  { key: "docNumber",     label: "Document number",    group: "Transaction", type: "string" },
  { key: "memo",          label: "Memo / Description", group: "Transaction", type: "string" },
  { key: "postingType",   label: "Debit / Credit",     group: "Transaction", type: "string" },
  { key: "currency",      label: "Currency",           group: "Transaction", type: "string" },
  { key: "billable",      label: "Billable",           group: "Transaction", type: "bool" },
  { key: "amount",        label: "Amount",             group: "Transaction", type: "number" },
  { key: "txnDate",       label: "Transaction date",   group: "Transaction", type: "date" },
];

export const OPERATORS_BY_TYPE: Record<AttrType, { op: LeafOperator; label: string }[]> = {
  string: [
    { op: "eq", label: "equals" }, { op: "neq", label: "not equals" },
    { op: "contains", label: "contains" }, { op: "startsWith", label: "starts with" }, { op: "endsWith", label: "ends with" },
    { op: "in", label: "in list" }, { op: "notIn", label: "not in list" },
    { op: "blank", label: "is blank" }, { op: "notBlank", label: "is not blank" },
  ],
  number: [
    { op: "eq", label: "equals" }, { op: "neq", label: "not equals" },
    { op: "gt", label: ">" }, { op: "gte", label: "≥" }, { op: "lt", label: "<" }, { op: "lte", label: "≤" },
    { op: "between", label: "between" }, { op: "blank", label: "is blank" }, { op: "notBlank", label: "is not blank" },
  ],
  date: [
    { op: "dateBetween", label: "between dates" }, { op: "blank", label: "is blank" }, { op: "notBlank", label: "is not blank" },
  ],
  bool: [
    { op: "eq", label: "equals" }, { op: "blank", label: "is blank" }, { op: "notBlank", label: "is not blank" },
  ],
};

export const attrMeta = (key: string) => ATTRIBUTE_META.find((a) => a.key === key);

/** Human-readable one-line summary of a condition tree (for rule lists). */
export function describeConditions(cond: any): string {
  if (!cond) return "(any)";
  if (cond.op && Array.isArray(cond.conditions)) {
    const parts = cond.conditions.map(describeConditions).filter(Boolean);
    if (parts.length === 0) return "(any)";
    if (cond.op === "NOT") return `NOT (${parts.join(" AND ")})`;
    return parts.join(` ${cond.op} `);
  }
  const label = attrMeta(cond.attribute)?.label ?? cond.attribute;
  const opLabel = ([] as { op: LeafOperator; label: string }[])
    .concat(...Object.values(OPERATORS_BY_TYPE)).find((o) => o.op === cond.operator)?.label ?? cond.operator;
  if (cond.operator === "blank" || cond.operator === "notBlank") return `${label} ${opLabel}`;
  if (cond.operator === "in" || cond.operator === "notIn") return `${label} ${opLabel} [${(cond.values ?? []).join(", ")}]`;
  if (cond.operator === "between" || cond.operator === "dateBetween") return `${label} ${opLabel} ${cond.from}…${cond.to}`;
  return `${label} ${opLabel} ${cond.value}`;
}
