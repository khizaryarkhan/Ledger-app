/**
 * Advanced Reporting Module — core types.
 *
 * The engine is deliberately GENERIC: a QBO transaction line is flattened into a
 * `SourceLine` (a bag of source attributes), and data-driven rules (AND/OR/NOT
 * condition trees over those attributes) assign the line to a value of each
 * reporting dimension. Nothing here is specific to "Profit Center" — dimensions,
 * values, and rules are all configuration.
 */

// ── Source line: one QBO transaction line, flattened to reporting attributes ──
// New attributes are added here + in the ATTRIBUTES registry (lib/reporting/
// engine.ts) — the rest of the engine never changes.
export interface SourceLine {
  // identity / provenance
  txnType: string;              // "Invoice" | "Bill" | "JournalEntry" | "Purchase" | ...
  txnId: string;                // QBO internal transaction Id
  lineId: string;               // QBO line Id (or synthetic index when QBO omits it)
  docNumber?: string;
  txnDate: string;              // YYYY-MM-DD — also drives rule effective-dating

  // money (home-currency amount kept separately for multicurrency)
  amount: number;               // signed reporting amount (see source.ts for sign convention)
  homeAmount?: number;
  postingType?: "Debit" | "Credit";
  currency?: string;

  // chart of accounts
  accountId?: string;
  accountName?: string;
  accountNumber?: string;
  accountType?: string;
  accountSubType?: string;
  parentAccountId?: string;

  // tracking
  classId?: string;
  className?: string;
  locationId?: string;          // QBO "Department"/Location
  locationName?: string;

  // parties (parent ids carry the hierarchy one level; deeper resolution later)
  customerId?: string;
  customerName?: string;
  customerParentId?: string;
  customerParentName?: string;
  vendorId?: string;
  vendorName?: string;

  // item
  itemId?: string;
  itemName?: string;

  // misc
  memo?: string;
  billable?: boolean;
  taxCodeId?: string;

  raw?: unknown;                // original QBO line, for drill-down
}

// ── Conditions (data-driven, stored as jsonb on the rule) ─────────────────────
export type LeafOperator =
  | "eq" | "neq"
  | "contains" | "startsWith" | "endsWith"
  | "in" | "notIn"
  | "gt" | "gte" | "lt" | "lte"
  | "between"           // numeric [from, to] inclusive
  | "dateBetween"       // YYYY-MM-DD [from, to] inclusive
  | "blank" | "notBlank";

export interface LeafCondition {
  attribute: string;                       // key in the ATTRIBUTES registry
  operator: LeafOperator;
  value?: string | number | boolean;       // eq/neq/contains/startsWith/endsWith/gt/gte/lt/lte
  values?: (string | number)[];            // in / notIn
  from?: string | number;                  // between / dateBetween
  to?: string | number;                    // between / dateBetween
}

export interface GroupCondition {
  op: "AND" | "OR" | "NOT";                // NOT negates the AND of its children
  conditions: Condition[];
}

export type Condition = LeafCondition | GroupCondition;

export const isGroup = (c: Condition): c is GroupCondition =>
  (c as GroupCondition).op !== undefined && Array.isArray((c as GroupCondition).conditions);

// ── Rules (engine-facing shape, hydrated from reporting_rules) ────────────────
export interface EngineRule {
  id: string;
  dimensionId: string;
  targetValueId: string | null;
  priority: number;
  conditions: Condition;
  active: boolean;
  effectiveFrom?: string | null;   // YYYY-MM-DD
  effectiveTo?: string | null;
}

// ── Override (engine-facing) ──────────────────────────────────────────────────
export interface EngineOverride {
  dimensionId: string;
  valueId: string | null;
  originalValueId?: string | null;
}

// ── Classification result for one dimension on one line ───────────────────────
export interface DimensionAssignment {
  dimensionId: string;
  valueId: string | null;                  // null = Unallocated
  source: "override" | "rule" | "unallocated";
  ruleId?: string;                         // winning rule (source === "rule")
  conflict?: boolean;                      // ≥2 equally-ranked rules disagree
  competingRuleIds?: string[];             // the tied rules when conflict
  originalValueId?: string | null;         // rule result an override replaced
}

export type LineClassification = Record<string /* dimensionId */, DimensionAssignment>;
