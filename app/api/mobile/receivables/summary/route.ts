/**
 * GET /api/mobile/receivables/summary
 *   → the rep's book at a glance: total AR, overdue, aging buckets, and the
 *     counts that drive the Receivables home screen.
 *
 * Scoped server-side (lib/receivables/rep-scope) so a rep only ever receives
 * their own figures.
 */

import { db } from "@/db";
import { invoices, organisations } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { and, eq } from "drizzle-orm";
import { DEFAULT_STAGES, ensureLockedStages, resolveStageLabel, type Stage } from "@/lib/stages";
import {
  resolveRepScope, invoiceScopeFilter, openBalance, isOpenInvoice, isCreditMemo,
  daysOverdue, agingBuckets,
} from "@/lib/receivables/rep-scope";

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function GET() {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  const scope = await resolveRepScope(orgId!, (session!.user as any)?.id ?? null);
  const scopeFilter = await invoiceScopeFilter(orgId!, scope);

  const [rows, [org]] = await Promise.all([
    db.select().from(invoices)
      .where(scopeFilter ? and(eq(invoices.orgId, orgId!), scopeFilter) : eq(invoices.orgId, orgId!)),
    db.select({ stages: organisations.stages }).from(organisations)
      .where(eq(organisations.id, orgId!)).limit(1),
  ]);

  // The org's own stage list, renames included — the app must offer the same
  // labels the board does, not a hard-coded copy that drifts.
  const stages: Stage[] = ensureLockedStages((org?.stages as Stage[] | null) ?? DEFAULT_STAGES);

  const open = rows.filter(isOpenInvoice);
  // Unapplied credit memos net down AR. The raw row stores a CreditMemo's
  // balance as a positive figure, so take -abs() regardless of stored sign.
  const credits = rows.filter(i => isCreditMemo(i) && i.paymentStatus !== "Paid");
  const creditTotal = credits.reduce((s, i) => s + Math.abs(openBalance(i)), 0);

  const overdue = open.filter(i => daysOverdue(i.dueDate) > 0);
  const buckets = agingBuckets(rows);

  return ok({
    rep: scope.rep,                 // null = unrestricted (admin view)
    scoped: !!scope.visibleRepIds,
    totals: {
      totalAR: r2(open.reduce((s, i) => s + openBalance(i), 0) - creditTotal),
      overdueAR: r2(overdue.reduce((s, i) => s + openBalance(i), 0)),
      overdueCount: overdue.length,
      openCount: open.length,
      unappliedCredits: r2(creditTotal),
    },
    aging: {
      current: r2(buckets.current), d30: r2(buckets.d30), d60: r2(buckets.d60),
      d90: r2(buckets.d90), d90plus: r2(buckets.d90plus), total: r2(buckets.total),
    },
    // Counts by stage, using the org's display labels.
    stages: countBy(open, i => resolveStageLabel(i.collectionStage || "New", stages)),
    // The pickable stage list for the detail screen's stage editor.
    stageOptions: stages.map(s => ({ key: s.key, label: s.label, isClosed: s.isClosed })),
  });
}

function countBy<T>(items: T[], key: (t: T) => string): { label: string; count: number }[] {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}
