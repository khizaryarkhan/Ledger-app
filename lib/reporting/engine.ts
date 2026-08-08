/**
 * Advanced Reporting Module — the classification engine.
 *
 * Pure functions (no DB, no I/O) so they're fully unit-testable and can run
 * over thousands of lines cheaply. Given a SourceLine plus the org's rules and
 * overrides, it decides each dimension's value with an explicit, auditable
 * precedence order — and surfaces conflicts instead of guessing.
 *
 * Precedence (highest wins):
 *   1. manual override (always)
 *   2. rule priority (higher number wins)
 *   3. specificity (more leaf conditions = more specific)
 *   4. effectiveFrom (later-dated wins)
 * Two matching rules tied on (priority, specificity) that assign DIFFERENT
 * values = a CONFLICT — returned flagged, never silently resolved.
 */

import type {
  SourceLine, Condition, LeafCondition, GroupCondition, EngineRule,
  EngineOverride, DimensionAssignment, LineClassification,
} from "./types";
import { isGroup } from "./types";

// ── Attribute registry — the ONLY place to add a new source attribute ─────────
type AttrType = "string" | "number" | "date" | "bool";
interface AttrDef { type: AttrType; get: (l: SourceLine) => unknown; }

export const ATTRIBUTES: Record<string, AttrDef> = {
  txnType:          { type: "string", get: (l) => l.txnType },
  docNumber:        { type: "string", get: (l) => l.docNumber },
  txnDate:          { type: "date",   get: (l) => l.txnDate },
  amount:           { type: "number", get: (l) => l.amount },
  homeAmount:       { type: "number", get: (l) => l.homeAmount },
  postingType:      { type: "string", get: (l) => l.postingType },
  currency:         { type: "string", get: (l) => l.currency },
  accountId:        { type: "string", get: (l) => l.accountId },
  accountName:      { type: "string", get: (l) => l.accountName },
  accountNumber:    { type: "string", get: (l) => l.accountNumber },
  accountType:      { type: "string", get: (l) => l.accountType },
  accountSubType:   { type: "string", get: (l) => l.accountSubType },
  parentAccountId:  { type: "string", get: (l) => l.parentAccountId },
  classId:          { type: "string", get: (l) => l.classId },
  className:        { type: "string", get: (l) => l.className },
  locationId:       { type: "string", get: (l) => l.locationId },
  locationName:     { type: "string", get: (l) => l.locationName },
  customerId:       { type: "string", get: (l) => l.customerId },
  customerName:     { type: "string", get: (l) => l.customerName },
  customerParentId: { type: "string", get: (l) => l.customerParentId },
  customerParentName: { type: "string", get: (l) => l.customerParentName },
  vendorId:         { type: "string", get: (l) => l.vendorId },
  vendorName:       { type: "string", get: (l) => l.vendorName },
  itemId:           { type: "string", get: (l) => l.itemId },
  itemName:         { type: "string", get: (l) => l.itemName },
  memo:             { type: "string", get: (l) => l.memo },
  billable:         { type: "bool",   get: (l) => l.billable },
  taxCodeId:        { type: "string", get: (l) => l.taxCodeId },
};

const norm = (v: unknown) => (v == null ? "" : String(v).trim().toLowerCase());
const isBlank = (v: unknown) => v == null || String(v).trim() === "";
const toNum = (v: unknown) => { const n = typeof v === "number" ? v : parseFloat(String(v)); return isNaN(n) ? null : n; };

// ── Evaluate a single leaf condition against a line ───────────────────────────
function evalLeaf(leaf: LeafCondition, line: SourceLine): boolean {
  const def = ATTRIBUTES[leaf.attribute];
  if (!def) return false;                     // unknown attribute never matches
  const actual = def.get(line);

  switch (leaf.operator) {
    case "blank":    return isBlank(actual);
    case "notBlank": return !isBlank(actual);
    case "eq":       return def.type === "number" ? toNum(actual) === toNum(leaf.value) : norm(actual) === norm(leaf.value);
    case "neq":      return def.type === "number" ? toNum(actual) !== toNum(leaf.value) : norm(actual) !== norm(leaf.value);
    case "contains":   return norm(actual).includes(norm(leaf.value));
    case "startsWith": return norm(actual).startsWith(norm(leaf.value));
    case "endsWith":   return norm(actual).endsWith(norm(leaf.value));
    case "in":       return (leaf.values ?? []).some((v) => (def.type === "number" ? toNum(actual) === toNum(v) : norm(actual) === norm(v)));
    case "notIn":    return !isBlank(actual) && !(leaf.values ?? []).some((v) => (def.type === "number" ? toNum(actual) === toNum(v) : norm(actual) === norm(v)));
    case "gt":  { const a = toNum(actual), b = toNum(leaf.value); return a != null && b != null && a > b; }
    case "gte": { const a = toNum(actual), b = toNum(leaf.value); return a != null && b != null && a >= b; }
    case "lt":  { const a = toNum(actual), b = toNum(leaf.value); return a != null && b != null && a < b; }
    case "lte": { const a = toNum(actual), b = toNum(leaf.value); return a != null && b != null && a <= b; }
    case "between": { const a = toNum(actual), f = toNum(leaf.from), t = toNum(leaf.to); return a != null && f != null && t != null && a >= f && a <= t; }
    case "dateBetween": { const a = norm(actual); return !isBlank(a) && (leaf.from == null || a >= norm(leaf.from)) && (leaf.to == null || a <= norm(leaf.to)); }
    default: return false;
  }
}

/** Evaluate a full condition tree. An empty AND matches everything (a catch-all rule). */
export function evaluate(cond: Condition, line: SourceLine): boolean {
  if (!isGroup(cond)) return evalLeaf(cond, line);
  const g = cond as GroupCondition;
  const kids = g.conditions ?? [];
  if (g.op === "AND") return kids.every((c) => evaluate(c, line));
  if (g.op === "OR")  return kids.length > 0 && kids.some((c) => evaluate(c, line));
  if (g.op === "NOT") return !kids.every((c) => evaluate(c, line));   // NOT (AND of children)
  return false;
}

/** Number of leaf conditions in a tree — the specificity tie-breaker. */
export function specificity(cond: Condition): number {
  if (!isGroup(cond)) return 1;
  return (cond as GroupCondition).conditions.reduce((s, c) => s + specificity(c), 0);
}

/** Is a rule in effect for a given transaction date (inclusive)? */
export function ruleInEffect(rule: EngineRule, txnDate: string): boolean {
  if (!rule.active) return false;
  if (rule.effectiveFrom && txnDate < rule.effectiveFrom) return false;
  if (rule.effectiveTo && txnDate > rule.effectiveTo) return false;
  return true;
}

/**
 * Classify one line for ONE dimension. `rules` must already be the rules for
 * that dimension (any order); effective-dating + matching happen here.
 */
export function classifyDimension(dimensionId: string, line: SourceLine, rules: EngineRule[]): DimensionAssignment {
  const matching = rules.filter((r) => ruleInEffect(r, line.txnDate) && evaluate(r.conditions, line));
  if (matching.length === 0) return { dimensionId, valueId: null, source: "unallocated" };

  const rank = (r: EngineRule) => ({ p: r.priority, s: specificity(r.conditions), d: r.effectiveFrom ?? "" });
  matching.sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra.p !== rb.p) return rb.p - ra.p;           // priority desc
    if (ra.s !== rb.s) return rb.s - ra.s;           // specificity desc
    if (ra.d !== rb.d) return ra.d < rb.d ? 1 : -1;  // effectiveFrom desc
    return a.id < b.id ? 1 : -1;                     // stable
  });

  const top = matching[0];
  const topP = top.priority, topS = specificity(top.conditions);
  const tied = matching.filter((r) => r.priority === topP && specificity(r.conditions) === topS);
  const distinct = new Set(tied.map((r) => r.targetValueId));
  const conflict = distinct.size > 1;

  return {
    dimensionId,
    valueId: top.targetValueId,
    source: "rule",
    ruleId: top.id,
    conflict: conflict || undefined,
    competingRuleIds: conflict ? tied.map((r) => r.id) : undefined,
  };
}

/**
 * Classify one line across ALL dimensions. Override wins outright; otherwise the
 * precedence-ranked rule for that dimension; otherwise Unallocated (never guess).
 *
 * @param rulesByDim   dimensionId → that dimension's rules
 * @param overrideByDim dimensionId → override for THIS line (already keyed by
 *                      txnType/txnId/lineId upstream), if any
 */
export function classifyLine(
  line: SourceLine,
  dimensionIds: string[],
  rulesByDim: Record<string, EngineRule[]>,
  overrideByDim: Record<string, EngineOverride> = {},
): LineClassification {
  const out: LineClassification = {};
  for (const dimId of dimensionIds) {
    const ovr = overrideByDim[dimId];
    if (ovr) {
      out[dimId] = { dimensionId: dimId, valueId: ovr.valueId, source: "override", originalValueId: ovr.originalValueId ?? null };
    } else {
      out[dimId] = classifyDimension(dimId, line, rulesByDim[dimId] ?? []);
    }
  }
  return out;
}
