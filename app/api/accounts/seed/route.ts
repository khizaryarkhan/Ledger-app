/**
 * POST /api/accounts/seed — populate the org's Chart of Accounts with the
 * standard starter chart (the way QBO/Xero seed a new company). Idempotent:
 * only inserts accounts whose name isn't already present (case-insensitive), so
 * it's safe to run on a synced org too — it just fills the gaps, never
 * duplicates. Company/super admins only.
 */

import { db } from "@/db";
import { accounts } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq } from "drizzle-orm";
import { STANDARD_COA } from "@/lib/accounting/standard-coa";

export async function POST() {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Only admins can set up the chart of accounts", 403);

  const existing = await db.select({ name: accounts.name }).from(accounts).where(eq(accounts.orgId, orgId!));
  const have = new Set(existing.map(a => a.name.trim().toLowerCase()));

  const toInsert = STANDARD_COA
    .filter(a => !have.has(a.name.toLowerCase()))
    .map(a => ({
      orgId: orgId!,
      source: "native",
      name: a.name,
      code: a.code,
      classification: a.classification,
      type: a.type,
      subtype: a.subtype ?? null,
      status: "Active",
    }));

  if (toInsert.length) {
    for (let i = 0; i < toInsert.length; i += 100) {
      await db.insert(accounts).values(toInsert.slice(i, i + 100));
    }
  }

  return ok({ added: toInsert.length, skipped: STANDARD_COA.length - toInsert.length });
}
