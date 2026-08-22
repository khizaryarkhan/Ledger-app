/**
 * Units of measure + conversions for the inventory register.
 *
 * Each UoM belongs to a DIMENSION (mass, volume, count, length) and carries a
 * factor to that dimension's canonical base. Conversions within a dimension are
 * automatic (kg→lb, l→ml). ACROSS dimensions there is no universal factor
 * (e.g. litres → pounds depends on density), so the caller must supply one —
 * captured per supplier-SKU.
 */

export type Dimension = "mass" | "volume" | "count" | "length";

export type Uom = { code: string; name: string; dimension: Dimension; toBase: number };

// Canonical bases: mass=gram, volume=millilitre, count=each, length=millimetre.
export const UOMS: Uom[] = [
  // Mass
  { code: "mg", name: "Milligram", dimension: "mass", toBase: 0.001 },
  { code: "g", name: "Gram", dimension: "mass", toBase: 1 },
  { code: "kg", name: "Kilogram", dimension: "mass", toBase: 1000 },
  { code: "oz", name: "Ounce", dimension: "mass", toBase: 28.349523125 },
  { code: "lb", name: "Pound", dimension: "mass", toBase: 453.59237 },
  { code: "mt", name: "Metric ton", dimension: "mass", toBase: 1_000_000 },
  // Volume
  { code: "ml", name: "Millilitre", dimension: "volume", toBase: 1 },
  { code: "lt", name: "Litre", dimension: "volume", toBase: 1000 },
  { code: "tsp", name: "Teaspoon", dimension: "volume", toBase: 4.92892 },
  { code: "tbsp", name: "Tablespoon", dimension: "volume", toBase: 14.7868 },
  { code: "floz", name: "Fluid ounce", dimension: "volume", toBase: 29.5735 },
  { code: "cup", name: "Cup", dimension: "volume", toBase: 236.588 },
  { code: "pt", name: "Pint", dimension: "volume", toBase: 473.176 },
  { code: "qt", name: "Quart", dimension: "volume", toBase: 946.353 },
  { code: "gal", name: "Gallon", dimension: "volume", toBase: 3785.41 },
  // Count
  { code: "each", name: "Each", dimension: "count", toBase: 1 },
  { code: "pair", name: "Pair", dimension: "count", toBase: 2 },
  { code: "dozen", name: "Dozen", dimension: "count", toBase: 12 },
  { code: "gross", name: "Gross (144)", dimension: "count", toBase: 144 },
  // Length
  { code: "mm", name: "Millimetre", dimension: "length", toBase: 1 },
  { code: "cm", name: "Centimetre", dimension: "length", toBase: 10 },
  { code: "m", name: "Metre", dimension: "length", toBase: 1000 },
  { code: "in", name: "Inch", dimension: "length", toBase: 25.4 },
  { code: "ft", name: "Foot", dimension: "length", toBase: 304.8 },
];

const BY_CODE = new Map(UOMS.map(u => [u.code.toLowerCase(), u]));
export const uom = (code?: string | null): Uom | undefined => (code ? BY_CODE.get(code.trim().toLowerCase()) : undefined);
export const dimensionOf = (code?: string | null): Dimension | null => uom(code)?.dimension ?? null;

/** Packaging container types for SKU definitions. */
export const PACK_TYPES = [
  "each", "bottle", "can", "jar", "box", "carton", "case", "pack", "bag", "pouch",
  "sachet", "tray", "tub", "tube", "drum", "keg", "bucket", "roll", "bundle", "pallet",
];

/** True when two UoMs are in different dimensions (no standard factor exists). */
export function needsConversionFactor(fromCode?: string | null, toCode?: string | null): boolean {
  const a = uom(fromCode), b = uom(toCode);
  if (!a || !b) return true;            // unknown → ask for a factor to be safe
  return a.dimension !== b.dimension;
}

export type ConvertResult = { ok: true; qty: number } | { ok: false; needsFactor: true };

/**
 * Convert qty from one UoM to another. Same dimension → automatic. Different
 * dimension → uses `factor` (how many `to` per one `from`); returns needsFactor
 * when a cross-dimension conversion is requested without one.
 */
export function convert(qty: number, fromCode: string, toCode: string, factor?: number | null): ConvertResult {
  const a = uom(fromCode), b = uom(toCode);
  if (a && b && a.dimension === b.dimension) return { ok: true, qty: (qty * a.toBase) / b.toBase };
  if (factor != null && factor > 0) return { ok: true, qty: qty * factor };
  return { ok: false, needsFactor: true };
}

const trimNum = (n: number) => {
  const r = Math.round(n * 1e6) / 1e6;
  return Number.isInteger(r) ? String(r) : String(r);
};

/**
 * Human pack configuration for a finished-product SKU, expressed in the item's
 * base UoM. e.g. base ml, 750 per bottle, 6 bottles per case →
 * "4500 ml/case [750 ml x 6 bottle]".
 */
export function packConfig(opts: {
  baseUom: string; innerSize?: number | null; innerType?: string | null;
  unitsAddl?: number | null; addlType?: string | null;
  unitsOuter?: number | null; outerType?: string | null;
}): string {
  const { baseUom, innerSize, innerType } = opts;
  if (!innerSize || !innerType) return "";
  const parts: string[] = [`${trimNum(innerSize)} ${baseUom} x ${innerType}`];
  let total = innerSize; let container = innerType;
  if (opts.unitsAddl && opts.addlType) { total *= opts.unitsAddl; parts.push(`${opts.unitsAddl} ${opts.addlType}`); container = opts.addlType; }
  if (opts.unitsOuter && opts.outerType) { total *= opts.unitsOuter; parts.push(`${opts.unitsOuter} ${opts.outerType}`); container = opts.outerType; }
  return `${trimNum(total)} ${baseUom}/${container} [${parts.join(" x ")}]`;
}
