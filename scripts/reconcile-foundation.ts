/**
 * CLI front door for the accounting-foundation reconciliation. All the logic
 * lives in lib/accounting/reconcile.ts, shared with the platform-admin health
 * check at GET /api/admin/reconcile — one implementation, so the two can't
 * drift apart and report different answers.
 *
 * Usage:
 *   npx tsx scripts/reconcile-foundation.ts              # every org
 *   npx tsx scripts/reconcile-foundation.ts <orgId>      # one org
 *   DATABASE_URL="<url>" npx tsx scripts/reconcile-foundation.ts
 *
 * NOTE: .env.local may point at a different database than production — check
 * which one you're hitting before treating the output as fact. The admin
 * health-check page (/admin/reconcile) always runs against production.
 *
 * Exit code is 1 if any assertion fails, so this can gate CI.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  // Imported after env is loaded — @/db reads DATABASE_URL at module load.
  const { reconcileAll } = await import("../lib/accounting/reconcile");

  const host = process.env.DATABASE_URL.replace(/\/\/[^@]*@/, "//***@").split("/")[2];
  console.log(`database: ${host}\n`);

  const orgs = await reconcileAll(process.argv[2] ?? null);
  if (orgs.length === 0) { console.log("No organisations matched."); return; }

  const mark = { pass: "✓", fail: "✗", skipped: "–" } as const;
  let failures = 0;

  for (const o of orgs) {
    console.log(`── ${o.orgName} (${o.orgId})${o.usesNativeLedger ? "" : "  [no native ledger]"}`);
    for (const c of o.checks) {
      console.log(`  ${mark[c.status]} ${c.label} — ${c.detail}`);
    }
    failures += o.failures;
    console.log("");
  }

  console.log("─".repeat(60));
  if (failures === 0) { console.log("All assertions passed."); return; }
  console.log(`${failures} assertion failure(s) across ${orgs.filter(o => o.failures > 0).length} org(s).`);
  process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });
