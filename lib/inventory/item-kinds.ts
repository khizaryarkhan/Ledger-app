/**
 * Item kinds — the single source of truth for an item's accounting behaviour.
 *
 * `apItems.productType` holds the kind. Each kind declares whether it is
 * inventory-tracked (capitalised to a balance-sheet asset and relieved to COGS
 * via FIFO lots), whether it can be sold and/or bought, and whether it can be
 * produced from / consumed by a Bill of Materials.
 *
 *   FinishedProduct (FP) — made in-house, sold. Tracked, sellable, producible.
 *   StockItem       (SI) — bought and resold as-is (trading goods). Tracked, buy+sell,
 *                          and can be consumed into production.
 *   RawMaterial     (RM) — bought, consumed in production. Tracked, buyable.
 *   WorkInProgress  (WIP)— intermediate produced/consumed. Tracked.
 *   NonInventory    (NI) — bought/sold but not stock-tracked (expensed on buy).
 *   Service              — services sold/bought; income/expense direct, no stock.
 */

export type ItemKind = "FinishedProduct" | "StockItem" | "RawMaterial" | "WorkInProgress" | "NonInventory" | "Service";

export type KindMeta = {
  kind: ItemKind;
  code: string;            // short badge, e.g. FP / SI / RM
  label: string;
  blurb: string;
  tracked: boolean;        // perpetual inventory (asset + COGS via lots)
  sellable: boolean;
  buyable: boolean;
  producible: boolean;     // can be the OUTPUT of a BOM
  consumable: boolean;     // can be an INPUT to a BOM / production
  lotTrackedDefault: boolean;
};

export const ITEM_KINDS: Record<ItemKind, KindMeta> = {
  FinishedProduct: { kind: "FinishedProduct", code: "FP", label: "Finished Product", blurb: "Made in-house and sold. Tracked as inventory; produced from a BOM.", tracked: true,  sellable: true,  buyable: true,  producible: true,  consumable: true,  lotTrackedDefault: true },
  StockItem:       { kind: "StockItem",       code: "SI", label: "Stock Item",       blurb: "Bought and resold as-is (trading goods). Tracked; received by lot.",      tracked: true,  sellable: true,  buyable: true,  producible: false, consumable: true,  lotTrackedDefault: true },
  RawMaterial:     { kind: "RawMaterial",     code: "RM", label: "Raw Material",     blurb: "Bought and consumed in production. Tracked; received by lot.",           tracked: true,  sellable: false, buyable: true,  producible: false, consumable: true,  lotTrackedDefault: true },
  WorkInProgress:  { kind: "WorkInProgress",  code: "WIP",label: "Work in Progress", blurb: "Intermediate produced then consumed further. Tracked.",                  tracked: true,  sellable: false, buyable: false, producible: true,  consumable: true,  lotTrackedDefault: true },
  NonInventory:    { kind: "NonInventory",    code: "NI", label: "Non-Inventory",    blurb: "Bought/sold but not stock-tracked (e.g. utilities). Expensed on buy.",   tracked: false, sellable: true,  buyable: true,  producible: false, consumable: false, lotTrackedDefault: false },
  Service:         { kind: "Service",         code: "SV", label: "Service",          blurb: "Services & subscriptions. Income/expense direct, no inventory.",         tracked: false, sellable: true,  buyable: true,  producible: false, consumable: false, lotTrackedDefault: false },
};

export const ITEM_KIND_LIST: KindMeta[] = [
  ITEM_KINDS.FinishedProduct, ITEM_KINDS.StockItem, ITEM_KINDS.RawMaterial,
  ITEM_KINDS.WorkInProgress, ITEM_KINDS.NonInventory, ITEM_KINDS.Service,
];

/** Normalise any stored/legacy productType to a known kind. Legacy default = FinishedProduct. */
export function kindOf(productType?: string | null): KindMeta {
  const k = (productType ?? "").trim();
  if (k in ITEM_KINDS) return ITEM_KINDS[k as ItemKind];
  return ITEM_KINDS.FinishedProduct;
}

export const isTracked = (productType?: string | null) => kindOf(productType).tracked;

/** Legacy QBO itemType derived from the kind (kept in sync for report/sync compatibility). */
export function qboItemType(productType?: string | null): "Service" | "Non-Inventory" | "Inventory" {
  const m = kindOf(productType);
  if (m.kind === "Service") return "Service";
  if (m.kind === "NonInventory") return "Non-Inventory";
  return "Inventory";
}
