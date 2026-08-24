/**
 * Shared numeric rounding helpers for the inventory/manufacturing engines.
 * These return NUMBERS rounded to a fixed number of decimals (banker's-agnostic
 * half-up via Math.round). For string-formatted output use `.toFixed()` at the
 * call site — valuation.ts keeps its own `toFixed` variants deliberately.
 */
export const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
export const round4 = (n: number) => Math.round((Number(n) || 0) * 1e4) / 1e4;
export const round6 = (n: number) => Math.round((Number(n) || 0) * 1e6) / 1e6;
