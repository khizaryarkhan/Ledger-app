/**
 * PATCH  /api/accounting/[entity]/[id] — edit a NATIVE record (synced records
 *        are read-only; their source of truth is QBO/Xero).
 *        Any record (native or synced) can have its status toggled
 *        Active/Inactive — deactivating only affects our app.
 */

import { db } from "@/db";
import { apAccounts, apItems, apTaxRates, apDimensions } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

// QBO's account type taxonomy — PATCH must not accept arbitrary type strings,
// or classification (and every report grouped by it) silently corrupts.
const ACCOUNT_TYPES = [
  "Bank", "Accounts Receivable", "Other Current Asset", "Fixed Asset", "Other Asset",
  "Accounts Payable", "Credit Card", "Other Current Liability", "Long Term Liability",
  "Equity", "Income", "Other Income",
  "Cost of Goods Sold", "Expense", "Other Expense",
] as const;

const status = z.enum(["Active", "Inactive"]).optional();
// Per-entity patch schemas with strict() — no cross-entity field leakage
// into .set() (a `rate` on an account, `dimensionType` on an item, etc.).
const PATCH_SCHEMAS: Record<string, z.ZodTypeAny> = {
  "accounts": z.object({
    name:    z.string().min(1).max(255).optional(),
    type:    z.enum(ACCOUNT_TYPES).optional(),
    subtype: z.string().max(64).nullable().optional(),
    code:    z.string().max(64).nullable().optional(),
    status,
  }).strict(),
  "items": z.object({
    name:             z.string().min(1).max(255).optional(),
    itemType:         z.enum(["Service", "Non-Inventory", "Inventory"]).optional(),
    code:             z.string().max(64).nullable().optional(),
    description:      z.string().max(4000).nullable().optional(),
    unitPrice:        z.number().nullable().optional(),
    unitCost:         z.number().nullable().optional(),
    incomeAccountId:  z.string().max(64).nullable().optional(),
    expenseAccountId: z.string().max(64).nullable().optional(),
    taxRateId:        z.string().max(64).nullable().optional(),
    status,
  }).strict(),
  "tax-rates": z.object({
    name:    z.string().min(1).max(255).optional(),
    rate:    z.number().min(0).max(100).optional(),
    taxType: z.string().max(64).nullable().optional(),
    status,
  }).strict(),
  "dimensions": z.object({
    name:          z.string().min(1).max(255).optional(),
    dimensionType: z.enum(["Class", "Department", "Location", "CostCentre", "CustomField", "Custom"]).optional(),
    code:          z.string().max(64).nullable().optional(),
    status,
  }).strict(),
};

function tableFor(entity: string) {
  if (entity === "accounts")   return apAccounts;
  if (entity === "items")      return apItems;
  if (entity === "tax-rates")  return apTaxRates;
  if (entity === "dimensions") return apDimensions;
  return null;
}

export async function PATCH(req: Request, { params }: { params: { entity: string; id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const table = tableFor(params.entity) as any;
  if (!table) return bad("Unknown entity", 404);

  const [row] = await db.select().from(table)
    .where(and(eq(table.id, params.id), eq(table.orgId, orgId!))).limit(1);
  if (!row) return bad("Not found", 404);

  const schema = PATCH_SCHEMAS[params.entity];
  let d: Record<string, any>;
  try { d = schema.parse(await req.json()); }
  catch (e: any) { return bad(e?.issues?.[0]?.message ?? "Invalid request"); }

  // System accounts (Retained Earnings, A/R, A/P, Undeposited Funds, …) are
  // protected the way QuickBooks protects them — they can't be deactivated or
  // re-typed, because the books and the year-end close depend on them. A name
  // or number tweak is still allowed.
  if (params.entity === "accounts" && (row as any).isSystem) {
    if (d.status === "Inactive") return bad("This is a system account and can't be deactivated.", 403);
    if (d.type !== undefined || d.subtype !== undefined) return bad("A system account's type can't be changed.", 403);
  }

  // Keep classification in step with the account type (drives report placement).
  if (params.entity === "accounts" && d.type !== undefined) {
    const { classificationForType } = await import("@/lib/accounting/account-types");
    (d as any).classification = classificationForType(d.type);
  }

  // Synced records: only the status toggle is allowed locally.
  const isNative = row.source === "native";
  const keys = Object.keys(d).filter(k => (d as any)[k] !== undefined);
  if (!isNative && keys.some(k => k !== "status")) {
    return bad(`This record is synced from ${String(row.source).toUpperCase()} — edit it there, or only change its status here.`, 403);
  }

  const updated: any[] = await db.update(table)
    .set({ ...d, updatedAt: new Date() })
    .where(and(eq(table.id, params.id), eq(table.orgId, orgId!)))
    .returning() as any;
  return ok(updated[0]);
}
