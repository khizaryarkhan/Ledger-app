/**
 * Per-org module assignment — which product areas an organisation has
 * access to. Manufacturing (BOM, production, job work, receiving, shipping,
 * lot traceability) is the first non-core module: assigned by a platform
 * admin, not self-service, since it's a vertical the org has bought into
 * rather than a preference they toggle. See CLAUDE.md "Modules & per-org
 * feature gating" for the full pattern.
 *
 * Client-safe (no `db`/server imports) — used by nav, the reports hub, and
 * the admin modules card. Server-side enforcement (`requireModule`) lives in
 * lib/modules-server.ts so it never gets pulled into a client bundle.
 */

export const MODULE_KEYS = ["receivables", "payables", "studio", "accounting", "manufacturing"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULES: Record<ModuleKey, { label: string; core: boolean; description: string }> = {
  receivables:   { label: "Receivables",           core: true,  description: "Collections board, invoices, customer escalations" },
  payables:      { label: "Payables",               core: true,  description: "Bills, purchase orders, supplier payments" },
  studio:        { label: "Data Studio",            core: true,  description: "Bulk QBO/Xero import, export, update, delete" },
  accounting:    { label: "Native Accounting",       core: true,  description: "General ledger, journal, native financial statements" },
  manufacturing: { label: "Manufacturing & Production", core: false, description: "Bill of materials, production builds, job work, receiving, shipping, lot traceability" },
};

export function isModuleKey(v: unknown): v is ModuleKey {
  return typeof v === "string" && (MODULE_KEYS as readonly string[]).includes(v);
}

export function hasModule(enabledModules: unknown, key: ModuleKey): boolean {
  return Array.isArray(enabledModules) && enabledModules.includes(key);
}
