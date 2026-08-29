/**
 * Native accounting masters — Chart of Accounts, Items, Tax Rates.
 *
 * GET  /api/accounting/accounts|items|tax-rates   → list (synced + native)
 * POST /api/accounting/accounts|items|tax-rates   → create a NATIVE record
 *
 * Synced records (source qbo/xero/sage) are read-only here — their source of
 * truth is the connected accounting system and the next sync would overwrite
 * local edits. Native records (source 'native') are fully editable.
 */

import { db } from "@/db";
import { apAccounts, apItems, apTaxRates, apDimensions } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, asc } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "crypto";

// QBO's account type taxonomy (AccountType → common AccountSubTypes).
const ACCOUNT_TYPES = [
  "Bank", "Accounts Receivable", "Other Current Asset", "Fixed Asset", "Other Asset",
  "Accounts Payable", "Credit Card", "Other Current Liability", "Long Term Liability",
  "Equity",
  "Income", "Other Income",
  "Cost of Goods Sold", "Expense", "Other Expense",
] as const;

const AccountSchema = z.object({
  name:    z.string().min(1).max(255),
  type:    z.enum(ACCOUNT_TYPES),
  subtype: z.string().max(64).optional(),
  code:    z.string().max(64).optional(),
  // Informational only — which currency this account (typically a Bank
  // account) is denominated in. Never affects posting: journal_lines stay
  // home-currency always. Used only to default the transaction-currency
  // field when this account is picked (see new-document-form.tsx).
  currency: z.string().length(3).optional().nullable(),
});

const ItemSchema = z.object({
  name:              z.string().min(1).max(255),
  itemType:          z.enum(["Service", "Non-Inventory", "Inventory"]).default("Service"),
  code:              z.string().max(64).optional(),
  description:       z.string().max(4000).optional(),
  unitPrice:         z.number().nullable().optional(),
  unitCost:          z.number().nullable().optional(),
  incomeAccountId:   z.string().max(64).nullable().optional(),
  expenseAccountId:  z.string().max(64).nullable().optional(),
  taxRateId:         z.string().max(64).nullable().optional(),
});

const TaxRateSchema = z.object({
  name:    z.string().min(1).max(255),
  rate:    z.number().min(0).max(100),
  taxType: z.string().max(64).optional(),
});

const DimensionSchema = z.object({
  name:          z.string().min(1).max(255),
  dimensionType: z.enum(["Class", "Department", "Location", "CostCentre", "CustomField", "Custom"]),
  code:          z.string().max(64).optional(),
});

function tableFor(entity: string) {
  if (entity === "accounts")   return apAccounts;
  if (entity === "items")      return apItems;
  if (entity === "tax-rates")  return apTaxRates;
  if (entity === "dimensions") return apDimensions;
  return null;
}

export async function GET(_req: Request, { params }: { params: { entity: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const table = tableFor(params.entity);
  if (!table) return bad("Unknown entity", 404);

  // Guarantee the protected system accounts exist (and are flagged) for this
  // org before listing the chart of accounts — QBO-style, they always exist.
  if (params.entity === "accounts") {
    const { ensureSystemAccounts } = await import("@/lib/accounting/system-accounts");
    await ensureSystemAccounts(orgId!).catch((e) => console.error("[ensureSystemAccounts]", e));
  }

  const rows = await db.select().from(table as any)
    .where(eq((table as any).orgId, orgId!))
    .orderBy(asc((table as any).name));
  return ok(rows);
}

export async function POST(req: Request, { params }: { params: { entity: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  try {
    const body = await req.json();

    if (params.entity === "accounts") {
      const d = AccountSchema.parse(body);
      // QBO requires unique account names — enforce the same.
      const [dup] = await db.select({ id: apAccounts.id }).from(apAccounts)
        .where(and(eq(apAccounts.orgId, orgId!), eq(apAccounts.name, d.name))).limit(1);
      if (dup) return bad("An account with this name already exists");
      // Classification is derived from the account type (the taxonomy), so the
      // account lands in the right place on the P&L / Balance Sheet.
      const { classificationForType } = await import("@/lib/accounting/account-types");
      const [created] = await db.insert(apAccounts).values({
        orgId: orgId!, source: "native",
        name: d.name, type: d.type, subtype: d.subtype ?? null, code: d.code ?? null,
        currency: d.currency?.toUpperCase() || null,
        classification: classificationForType(d.type),
        status: "Active",
      }).returning();
      return ok(created);
    }

    if (params.entity === "items") {
      const d = ItemSchema.parse(body);
      const [dup] = await db.select({ id: apItems.id }).from(apItems)
        .where(and(eq(apItems.orgId, orgId!), eq(apItems.name, d.name))).limit(1);
      if (dup) return bad("An item with this name already exists");
      const [created] = await db.insert(apItems).values({
        orgId: orgId!, source: "native",
        name: d.name, itemType: d.itemType, code: d.code ?? null,
        description: d.description ?? null,
        unitPrice: d.unitPrice ?? null, unitCost: d.unitCost ?? null,
        incomeAccountId: d.incomeAccountId ?? null,
        expenseAccountId: d.expenseAccountId ?? null,
        taxRateId: d.taxRateId ?? null,
        status: "Active",
      }).returning();
      return ok(created);
    }

    if (params.entity === "tax-rates") {
      const d = TaxRateSchema.parse(body);
      const [created] = await db.insert(apTaxRates).values({
        orgId: orgId!, source: "native",
        name: d.name, rate: d.rate, taxType: d.taxType ?? null,
        status: "Active",
      }).returning();
      return ok(created);
    }

    if (params.entity === "dimensions") {
      const d = DimensionSchema.parse(body);
      const [created] = await db.insert(apDimensions).values({
        orgId: orgId!, source: "native",
        // externalId is NOT NULL (part of the sync upsert key) — native
        // records get a generated one so they never collide with synced rows.
        externalId: `native-${randomUUID()}`,
        dimensionType: d.dimensionType,
        name: d.name, code: d.code ?? null,
        status: "Active",
      }).returning();
      return ok(created);
    }

    return bad("Unknown entity", 404);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error(e);
    return bad("Failed to create record", 500);
  }
}
