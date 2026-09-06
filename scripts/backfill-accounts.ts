/**
 * Phase 1 backfill — give every existing company a crm_accounts row and link it.
 * Idempotent: safe to run repeatedly. RUN ON A NEON BRANCH FIRST, then production.
 *
 *   DATABASE_URL="<neon-branch-url>" npm run db:backfill-accounts
 *
 * (You can also run it with one click from the admin Accounts page.)
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });

import { backfillAllAccounts } from "@/lib/admin/accounts";

async function main() {
  const { orgs, leads, opps } = await backfillAllAccounts();
  console.log(`✓ Backfill complete — accounts linked: ${orgs} orgs, ${leads} leads, ${opps} opportunities.`);
}

main().catch((e) => { console.error("Backfill failed:", e); process.exit(1); });
