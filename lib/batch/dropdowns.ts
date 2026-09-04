/**
 * Excel dropdown (data-validation) planning, shared by the TEMPLATE download
 * and the DATA export.
 *
 * This used to live only in app/api/batch/template — which meant a blank
 * template carried dropdowns but an EXPORT of real records did not. That's
 * backwards: the export is the file people actually edit (reclassifying
 * transactions, fixing accounts in bulk), so it's the file that most needs
 * valid picks. Both routes now build their validations from here.
 *
 * Two sources feed a dropdown:
 *   • reference columns (Customer, Vendor, Item, Account, Class, Location,
 *     Tax Code, Payment Method, Terms) — the org's real QuickBooks values, so
 *     they need a connected token;
 *   • fixed-choice enum columns (Yes/No, statuses, Item/Account Type, Currency)
 *     — static, so they render whether or not QBO is reachable.
 */

import type { RefKind, RefResolver } from "./ref-resolver";
import { entityRefColumns, refKindForColumn } from "./ref-columns";
import { entityEnumColumns } from "./enum-columns";
import type { BatchEntity } from "./types";

/**
 * Columns whose value may legitimately name more than one kind of list, so the
 * dropdown offers the union.
 *
 * A deposit's "Received From" is the case that prompted this: QuickBooks lets
 * it be a customer, a vendor or an employee, and offering only customers
 * would make a legitimate vendor refund look invalid.
 */
const UNION_COLUMNS: Record<string, RefKind[]> = {
  "received from": ["Customer", "Vendor", "Employee"],
};

/**
 * Same idea as UNION_COLUMNS, but scoped to one entity's column — a bare
 * "Name" means a different reference per entity (see ref-columns.ts's
 * ENTITY_NAME_OVERRIDES), and timeactivity's specifically can be either an
 * Employee or a Vendor (buildTimeActivity tries Employee first, falls back
 * to Vendor), so its dropdown needs the full union, not just the single
 * primary kind the override-picker route uses.
 */
const ENTITY_UNION_COLUMNS: Record<string, Record<string, RefKind[]>> = {
  timeactivity: { name: ["Employee", "Vendor"] },
};

export type DropdownSource = { key: string; label: string; values: string[] };
export type DropdownPlan = Map<string, DropdownSource>;

/** Column-name → the RefKinds whose values should populate its dropdown. */
export function dropdownKindsForColumn(column: string, entityId?: string): RefKind[] {
  const c = column.trim().toLowerCase();
  const entityUnion = entityId ? ENTITY_UNION_COLUMNS[entityId]?.[c] : undefined;
  if (entityUnion) return entityUnion;
  const union = UNION_COLUMNS[c];
  if (union) return union;
  const single = refKindForColumn(column, entityId);
  return single ? [single] : [];
}

/** Every RefKind an entity needs resolved to render its dropdowns. */
export function entityDropdownKinds(entity: BatchEntity): RefKind[] {
  const kinds = new Set<RefKind>();
  for (const col of entity.columns) for (const k of dropdownKindsForColumn(col, entity.id)) kinds.add(k);
  // reverseRefs are what the row mappers need to turn ids back into names.
  for (const k of entity.reverseRefs || []) kinds.add(k as RefKind);
  return [...kinds];
}

/**
 * Which columns get a dropdown, and the values behind each.
 *
 * `resolver` may be null (no QBO connection) — enum dropdowns still render, so
 * a file is never handed over with bare headers when it has fixed-choice
 * columns.
 */
export async function buildDropdownPlan(
  columns: string[],
  entity: BatchEntity,
  resolver: RefResolver | null,
): Promise<DropdownPlan> {
  const plan: DropdownPlan = new Map();
  const present = new Set(columns.map((c) => c.trim()));

  if (resolver) {
    const cache = new Map<RefKind, string[]>();
    const namesFor = async (kind: RefKind): Promise<string[]> => {
      if (!cache.has(kind)) cache.set(kind, await resolver.listNames(kind));
      return cache.get(kind)!;
    };

    for (const rc of entityRefColumns(entity)) {
      if (!present.has(rc.column)) continue;
      const kinds = dropdownKindsForColumn(rc.column, entity.id);
      const values: string[] = [];
      for (const k of kinds) values.push(...(await namesFor(k)));
      // Union columns can legitimately repeat a name across lists (a customer
      // and a vendor with the same trading name); Excel shows duplicates, so
      // de-dup and sort for a list that reads sensibly.
      const unique = [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
      if (unique.length) {
        plan.set(rc.column, { key: `ref:${kinds.join("+")}`, label: kinds.join(" / "), values: unique });
      }
    }
  }

  for (const ec of entityEnumColumns(columns)) {
    if (plan.has(ec.column)) continue; // a reference column already owns it
    plan.set(ec.column, { key: `enum:${ec.values.join("|")}`, label: "value", values: ec.values });
  }

  return plan;
}

function colLetter(n: number): string {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/**
 * Write the hidden "Lists" sheet and attach a validation to each planned
 * column. `lastRow` bounds the validated span — for an export that's the data
 * it actually contains plus headroom for added rows, rather than a blanket
 * 5000 that bloats the file.
 */
export function applyDropdowns(
  wb: any,
  ws: any,
  columns: string[],
  plan: DropdownPlan,
  lastRow: number,
): void {
  if (plan.size === 0) return;

  const listWs = wb.addWorksheet("Lists");
  listWs.state = "hidden";

  // One Lists column per DISTINCT value set — every Yes/No column shares one.
  const rangeByKey = new Map<string, string>();
  let listColIdx = 0;
  for (const src of plan.values()) {
    if (rangeByKey.has(src.key)) continue;
    listColIdx++;
    const letter = colLetter(listColIdx);
    listWs.getCell(`${letter}1`).value = src.label;
    src.values.forEach((v, r) => { listWs.getCell(`${letter}${r + 2}`).value = v; });
    rangeByKey.set(src.key, `Lists!$${letter}$2:$${letter}$${src.values.length + 1}`);
  }

  for (const [column, src] of plan) {
    const range = rangeByKey.get(src.key);
    if (!range) continue;
    const idx = columns.findIndex((c) => c.trim() === column.trim());
    if (idx < 0) continue;
    const letter = colLetter(idx + 1);
    const isRef = src.key.startsWith("ref:");
    ws.dataValidations.add(`${letter}2:${letter}${Math.max(lastRow, 2)}`, {
      type: "list",
      allowBlank: true,
      formulae: [range],
      showErrorMessage: true,
      // A warning, not a hard stop: QuickBooks lists change, and a stale export
      // shouldn't lock someone out of typing a name that now exists.
      errorStyle: "warning",
      errorTitle: isRef ? `Pick a ${src.label} from the list` : "Pick an allowed value",
      error: isRef
        ? `This must match a ${src.label} that exists in QuickBooks. Choose one from the dropdown, or leave blank.`
        : `Choose one of the allowed values from the dropdown, or leave blank.`,
      showInputMessage: true,
      promptTitle: isRef ? src.label : column,
      prompt: isRef ? `Choose an existing QuickBooks ${src.label}.` : `Choose an allowed value.`,
    });
  }
}
