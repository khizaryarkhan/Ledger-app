/**
 * GET  /api/admin/organisations/backfill-multicurrency        → dry-run preview
 * POST /api/admin/organisations/backfill-multicurrency        → apply
 *
 * Historical bug (fixed in the app code separately): several native
 * customer/supplier creation forms hardcoded a currency literal ("USD",
 * "EUR") instead of reading the org's home currency, so orgs that never
 * turned multi-currency on can already have customers/suppliers tagged in a
 * different currency than their own books. That's not corrupt data to
 * overwrite — once a real transaction may exist against a party, its
 * currency is meant to be permanent — so the correct fix is to flip the
 * org's own `multicurrencyEnabled` flag to match the reality already on
 * file, not to rewrite the parties' currency back to the home currency.
 *
 * This is a one-time platform-wide backfill: for every org where
 * multicurrencyEnabled is false, check whether it has any customer or
 * supplier whose currency differs from the org's home currency. If so,
 * flip multicurrencyEnabled to true for that org (home currency itself is
 * never touched, and no party row is modified).
 */

import { db } from "@/db";
import { organisations, customers, apSuppliers } from "@/db/schema";
import { ok, bad } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/billing";
import { eq, and, ne, isNotNull } from "drizzle-orm";

async function findAffectedOrgs() {
  const orgs = await db.select({ id: organisations.id, name: organisations.name, currency: organisations.currency, multicurrencyEnabled: organisations.multicurrencyEnabled })
    .from(organisations)
    .where(eq(organisations.multicurrencyEnabled, false));

  const affected: { id: string; name: string; homeCurrency: string; mismatchedCustomers: number; mismatchedSuppliers: number }[] = [];

  for (const org of orgs) {
    const home = org.currency ?? "EUR";
    const [custRows, supRows] = await Promise.all([
      db.select({ id: customers.id }).from(customers).where(and(eq(customers.orgId, org.id), isNotNull(customers.currency), ne(customers.currency, home))),
      db.select({ id: apSuppliers.id }).from(apSuppliers).where(and(eq(apSuppliers.orgId, org.id), isNotNull(apSuppliers.currency), ne(apSuppliers.currency, home))),
    ]);
    if (custRows.length > 0 || supRows.length > 0) {
      affected.push({ id: org.id, name: org.name, homeCurrency: home, mismatchedCustomers: custRows.length, mismatchedSuppliers: supRows.length });
    }
  }
  return affected;
}

export async function GET() {
  const { error } = await requireSuperAdmin();
  if (error) return error;
  const affected = await findAffectedOrgs();
  return ok({ dryRun: true, orgCount: affected.length, orgs: affected });
}

export async function POST(req: Request) {
  const { error } = await requireSuperAdmin();
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== true) return bad("Pass { confirm: true } to apply — GET this endpoint first to preview.");

  const affected = await findAffectedOrgs();
  for (const org of affected) {
    await db.update(organisations).set({ multicurrencyEnabled: true, updatedAt: new Date() }).where(eq(organisations.id, org.id));
  }
  return ok({ applied: true, orgCount: affected.length, orgs: affected });
}
