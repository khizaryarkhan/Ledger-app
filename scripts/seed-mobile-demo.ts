/**
 * Creates (or reuses) a dedicated demo organisation + admin user for Apple/
 * Google app-review — one open PO (Receiving), one active BOM with an input
 * line (Production), and one open SO (Shipping), so the mobile app's three
 * screens have real data to show a reviewer instead of empty states.
 *
 * Idempotent: safe to re-run. Does NOT touch any real customer's org — it
 * only ever creates/updates the row keyed by DEMO_SLUG below.
 *
 *   DATABASE_URL="<production-or-branch-url>" npx tsx scripts/seed-mobile-demo.ts
 *
 * Prints the demo login (email + a freshly generated password) at the end —
 * put those in App Store Connect's / Play Console's reviewer-notes field
 * (see mobile/STORE_LISTING.md). Pass DEMO_PASSWORD=... to set a specific
 * password instead of generating one (e.g. to reset it on a re-run).
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });

import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import {
  organisations, users, userOrganisations, apItems, boms, bomLines,
  tradeDocuments, tradeDocumentLines,
} from "@/db/schema";
import { ensureAccount } from "@/lib/admin/accounts";
import { ensureSystemAccounts, systemAccountId, INV_SUBTYPE } from "@/lib/accounting/system-accounts";

const DEMO_SLUG = "app-review-demo";
const DEMO_ORG_NAME = "Prime Accountax — App Review Demo";
const DEMO_EMAIL = "app-review-demo@primeaccountax.com";
const DEMO_ADMIN_NAME = "App Review";

const today = () => new Date().toISOString().slice(0, 10);

async function ensureOrg(): Promise<{ id: string; created: boolean }> {
  const [existing] = await db.select({ id: organisations.id }).from(organisations).where(eq(organisations.slug, DEMO_SLUG)).limit(1);
  if (existing) return { id: existing.id, created: false };

  const accountId = await ensureAccount({ name: DEMO_ORG_NAME, email: DEMO_EMAIL });
  const [org] = await db.insert(organisations).values({ name: DEMO_ORG_NAME, slug: DEMO_SLUG, accountId }).returning({ id: organisations.id });
  return { id: org.id, created: true };
}

async function ensureAdminUser(orgId: string): Promise<{ email: string; password: string | null }> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, DEMO_EMAIL)).limit(1);
  const password = process.env.DEMO_PASSWORD || (existing ? null : randomBytes(9).toString("base64url"));

  if (existing) {
    if (process.env.DEMO_PASSWORD) {
      const passwordHash = await bcrypt.hash(process.env.DEMO_PASSWORD, 12);
      await db.update(users).set({ passwordHash, status: "Active" }).where(eq(users.id, existing.id));
    }
    await db.insert(userOrganisations).values({ userId: existing.id, orgId, role: "company_admin" }).onConflictDoNothing();
    return { email: DEMO_EMAIL, password: process.env.DEMO_PASSWORD || null };
  }

  const passwordHash = await bcrypt.hash(password!, 12);
  const [created] = await db.insert(users).values({
    orgId, name: DEMO_ADMIN_NAME, email: DEMO_EMAIL, passwordHash, role: "company_admin", status: "Active",
  }).returning({ id: users.id });
  await db.insert(userOrganisations).values({ userId: created.id, orgId, role: "company_admin" }).onConflictDoNothing();
  return { email: DEMO_EMAIL, password };
}

async function ensureItem(orgId: string, name: string, productType: "RawMaterial" | "FinishedProduct", baseUom: string) {
  const [existing] = await db.select({ id: apItems.id }).from(apItems)
    .where(and(eq(apItems.orgId, orgId), eq(apItems.name, name))).limit(1);
  if (existing) return existing.id;

  await ensureSystemAccounts(orgId);
  const assetAccountId = await systemAccountId(orgId, INV_SUBTYPE.asset);
  const cogsAccountId = await systemAccountId(orgId, INV_SUBTYPE.cogs);
  const [row] = await db.insert(apItems).values({
    orgId, source: "native", name, productType, baseUom, itemType: "Inventory",
    assetAccountId, cogsAccountId, lotTracked: true, status: "Active",
  } as any).returning({ id: apItems.id });
  return row.id;
}

async function ensureOpenPurchaseOrder(orgId: string, rawMaterialId: string) {
  const [existing] = await db.select({ id: tradeDocuments.id }).from(tradeDocuments)
    .where(and(eq(tradeDocuments.orgId, orgId), eq(tradeDocuments.kind, "PurchaseOrder"), eq(tradeDocuments.docNumber, "DEMO-PO-1"))).limit(1);
  if (existing) return;

  const [po] = await db.insert(tradeDocuments).values({
    orgId, kind: "PurchaseOrder", docNumber: "DEMO-PO-1", partyType: "Vendor",
    partyLabel: "Demo Supplier Co.", issueDate: today(), status: "Open", currency: "USD",
  }).returning({ id: tradeDocuments.id });
  await db.insert(tradeDocumentLines).values({
    orgId, documentId: po.id, lineNo: 1, itemId: rawMaterialId,
    qty: "100", rate: "5.00", unitsPerOrderUnit: "1", orderedBaseQty: "100", receivedQty: "0",
  });
}

async function ensureBom(orgId: string, finishedGoodId: string, rawMaterialId: string) {
  const [existing] = await db.select({ id: boms.id }).from(boms)
    .where(and(eq(boms.orgId, orgId), eq(boms.name, "Demo Recipe"))).limit(1);
  if (existing) return;

  const [bom] = await db.insert(boms).values({
    orgId, name: "Demo Recipe", outputItemId: finishedGoodId, status: "Active", batchType: "Output", batchSize: "10",
  }).returning({ id: boms.id });
  await db.insert(bomLines).values([
    { orgId, bomId: bom.id, role: "output", itemId: finishedGoodId, qty: "10", uom: "unit", sortOrder: 0 },
    { orgId, bomId: bom.id, role: "input", itemId: rawMaterialId, qty: "5", uom: "unit", sortOrder: 0 },
  ]);
}

async function ensureOpenSalesOrder(orgId: string, finishedGoodId: string) {
  const [existing] = await db.select({ id: tradeDocuments.id }).from(tradeDocuments)
    .where(and(eq(tradeDocuments.orgId, orgId), eq(tradeDocuments.kind, "SalesOrder"), eq(tradeDocuments.docNumber, "DEMO-SO-1"))).limit(1);
  if (existing) return;

  const [so] = await db.insert(tradeDocuments).values({
    orgId, kind: "SalesOrder", docNumber: "DEMO-SO-1", partyType: "Customer",
    partyLabel: "Demo Customer Inc.", issueDate: today(), status: "Open", currency: "USD",
  }).returning({ id: tradeDocuments.id });
  await db.insert(tradeDocumentLines).values({
    orgId, documentId: so.id, lineNo: 1, itemId: finishedGoodId,
    qty: "20", rate: "25.00", unitsPerOrderUnit: "1", orderedBaseQty: "20", receivedQty: "0",
  });
}

async function main() {
  const { id: orgId, created } = await ensureOrg();
  const { email, password } = await ensureAdminUser(orgId);
  const rawMaterialId = await ensureItem(orgId, "Demo Raw Material", "RawMaterial", "unit");
  const finishedGoodId = await ensureItem(orgId, "Demo Finished Good", "FinishedProduct", "unit");
  await ensureOpenPurchaseOrder(orgId, rawMaterialId);
  await ensureBom(orgId, finishedGoodId, rawMaterialId);
  await ensureOpenSalesOrder(orgId, finishedGoodId);

  console.log(`✓ Demo org ${created ? "created" : "already existed"}: ${DEMO_ORG_NAME} (${orgId})`);
  console.log(`✓ Open PO "DEMO-PO-1", BOM "Demo Recipe", open SO "DEMO-SO-1" ensured.`);
  console.log(`\nReviewer login:\n  Email:    ${email}`);
  console.log(`  Password: ${password ?? "(unchanged — set DEMO_PASSWORD=... to reset it)"}`);
}

main().catch((e) => { console.error("Seed failed:", e); process.exit(1); });
