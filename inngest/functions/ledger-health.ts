/**
 * Ledger Health — the foundation's self-defence.
 *
 * The whole accounting-foundation effort was prompted by books that were
 * silently wrong and nobody knew. This cron makes that impossible to sustain:
 * every night it runs the same reconciliation the /admin/reconcile page runs
 * (lib/accounting/reconcile.ts) across every org, and records a billing audit
 * event for any org whose ledger has drifted — so a failure shows up in the
 * admin Audit Log the next morning instead of waiting for someone to look.
 *
 * Single invocation (current scale is a handful of orgs). If org count grows
 * enough to strain one neon-http budget, fan out per org the way chase.ts
 * does — the per-org function (reconcileOrg) already exists.
 */

import { inngest } from "@/lib/inngest";
import { reconcileAll } from "@/lib/accounting/reconcile";
import { logBillingEvent } from "@/lib/billing";

export const ledgerHealthCheck = inngest.createFunction(
  { id: "ledger-health-check", triggers: [{ cron: "0 6 * * *" }] },
  async ({ step }) => {
    const results = await step.run("reconcile-all", () => reconcileAll());

    const failing = results.filter(o => o.failures > 0);

    // One audit event per drifting org, listing exactly which invariants broke
    // and their detail — enough to act on without re-running anything.
    await step.run("record-failures", async () => {
      for (const o of failing) {
        await logBillingEvent({
          organizationId: o.orgId,
          action: "ledger_reconciliation_failed",
          metadata: {
            failures: o.failures,
            checks: o.checks.filter(c => c.status === "fail").map(c => ({ key: c.key, label: c.label, detail: c.detail })),
          },
        }).catch(() => {});
        // Also to the function logs, so it's visible in Inngest's run history.
        console.error(`[ledger-health] ${o.orgName} (${o.orgId}) — ${o.failures} failure(s): ` +
          o.checks.filter(c => c.status === "fail").map(c => `${c.key}: ${c.detail}`).join(" | "));
      }
    });

    return {
      orgsChecked: results.length,
      orgsFailing: failing.length,
      totalFailures: results.reduce((s, o) => s + o.failures, 0),
    };
  },
);
