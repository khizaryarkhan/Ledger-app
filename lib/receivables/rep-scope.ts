/**
 * Rep visibility scope — SERVER SIDE.
 *
 * The web rep portal implements this rule in the browser: it fetches every
 * invoice, customer, project and rep for the org and filters the arrays in
 * React. That means `/api/invoices` hands a rep the whole organisation's
 * receivables and relies on the UI not to show them — so the scope is a
 * presentation detail, not a boundary.
 *
 * Mobile can't work that way (a rep on 3G shouldn't download the whole org),
 * and it shouldn't: the same rule enforced here returns only what the caller
 * is entitled to. The web portal can be moved onto these endpoints later; the
 * rule below is a faithful port of its logic, so behaviour matches.
 *
 * The rule, unchanged from the portal:
 *   - No linked rep record (admin/unlinked) → unrestricted.
 *   - tier "rep"      → own entities only.
 *   - tier "rd"/"ed"  → own + direct reports (reps whose managerId is theirs).
 *     NOTE "ed" is deliberately NOT "see everything" — a true admin has no
 *     repId at all, which is what grants the unrestricted view.
 *
 * An invoice belongs to a rep by WHERE the assignment lives:
 *   - has projectId → that project's repId must be visible
 *   - no projectId  → that customer's repId must be visible
 * which covers customer-level, project-level and mixed org setups in one rule.
 */

import { db } from "@/db";
import { users, reps, invoices, customers, projects } from "@/db/schema";
import { and, eq, inArray, or, isNull, type SQL } from "drizzle-orm";

export type RepScope = {
  /** null = unrestricted (admin / not linked to a rep record). */
  visibleRepIds: Set<string> | null;
  rep: { id: string; name: string; tier: string; managerId: string | null } | null;
};

/** Resolve what this user is allowed to see. */
export async function resolveRepScope(orgId: string, userId: string | null): Promise<RepScope> {
  if (!userId) return { visibleRepIds: null, rep: null };

  const [user] = await db.select({ repId: users.repId }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.repId) return { visibleRepIds: null, rep: null };

  const [rep] = await db.select({ id: reps.id, name: reps.name, tier: reps.tier, managerId: reps.managerId })
    .from(reps).where(and(eq(reps.id, user.repId), eq(reps.orgId, orgId))).limit(1);
  if (!rep) return { visibleRepIds: null, rep: null };

  const ids = new Set<string>([rep.id]);
  if (rep.tier === "rd" || rep.tier === "ed") {
    const reports = await db.select({ id: reps.id }).from(reps)
      .where(and(eq(reps.orgId, orgId), eq(reps.managerId, rep.id)));
    for (const r of reports) ids.add(r.id);
  }
  return { visibleRepIds: ids, rep };
}

/**
 * A WHERE fragment restricting `invoices` to the caller's scope, or null when
 * unrestricted. Resolves the owning customer/project ids for the visible reps
 * and matches on the invoice's own assignment location.
 */
export async function invoiceScopeFilter(orgId: string, scope: RepScope): Promise<SQL | null> {
  if (!scope.visibleRepIds) return null;
  const repIds = [...scope.visibleRepIds];
  if (repIds.length === 0) return eq(invoices.id, "00000000-0000-0000-0000-000000000000"); // matches nothing

  const [custRows, projRows] = await Promise.all([
    db.select({ id: customers.id }).from(customers)
      .where(and(eq(customers.orgId, orgId), inArray(customers.repId, repIds))),
    db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.orgId, orgId), inArray(projects.repId, repIds))),
  ]);
  const custIds = custRows.map(r => r.id);
  const projIds = projRows.map(r => r.id);

  const clauses: SQL[] = [];
  // Project invoice → owned via the project's rep.
  if (projIds.length) clauses.push(inArray(invoices.projectId, projIds) as SQL);
  // Customer invoice (no project) → owned via the customer's rep.
  if (custIds.length) clauses.push(and(isNull(invoices.projectId), inArray(invoices.customerId, custIds)) as SQL);

  if (clauses.length === 0) return eq(invoices.id, "00000000-0000-0000-0000-000000000000");
  return (clauses.length === 1 ? clauses[0] : or(...clauses)) as SQL;
}

/**
 * Is this invoice inside the caller's book?
 *
 * Read scope without write scope is cosmetic: the list endpoints hide
 * out-of-scope invoices, but the action endpoints take an invoice id, so a rep
 * could still act on any invoice in the org by supplying its id. Admins and
 * unlinked users are unrestricted, exactly as with reads.
 */
export async function isInvoiceInScope(orgId: string, userId: string | null, invoiceId: string): Promise<boolean> {
  const scope = await resolveRepScope(orgId, userId);
  if (!scope.visibleRepIds) return true;             // unrestricted
  const filter = await invoiceScopeFilter(orgId, scope);
  if (!filter) return true;
  const [hit] = await db.select({ id: invoices.id }).from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.id, invoiceId), filter)).limit(1);
  return !!hit;
}

// ── Shared AR maths, lifted from the portal so server and client agree ───────

/** Authoritative open balance — the synced ledger balance wins over total−paid. */
export function openBalance(inv: {
  qboBalance?: number | null; xeroBalance?: number | null; total?: number | null; paid?: number | null;
}): number {
  if (inv.qboBalance != null) return Number(inv.qboBalance);
  if (inv.xeroBalance != null) return Math.max(0, Number(inv.xeroBalance));
  return Math.max(0, Number(inv.total || 0) - Number(inv.paid || 0));
}

export function isOpenInvoice(inv: { txnType?: string | null; paymentStatus?: string | null }): boolean {
  return inv.txnType !== "CreditMemo"
    && inv.paymentStatus !== "Paid"
    && inv.paymentStatus !== "Written Off";
}

export function isCreditMemo(inv: { txnType?: string | null; qboId?: string | null }): boolean {
  return inv.txnType === "CreditMemo" || String(inv.qboId || "").startsWith("CM-");
}

export function daysOverdue(dueDate: string | null | undefined): number {
  if (!dueDate) return 0;
  const due = new Date(`${String(dueDate).slice(0, 10)}T00:00:00Z`).getTime();
  if (Number.isNaN(due)) return 0;
  const today = new Date();
  const utcToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.floor((utcToday - due) / 86_400_000);
}

export type AgingBuckets = { current: number; d30: number; d60: number; d90: number; d90plus: number; total: number };

export function agingBuckets(invs: any[]): AgingBuckets {
  const b: AgingBuckets = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0, total: 0 };
  for (const inv of invs) {
    if (!isOpenInvoice(inv)) continue;
    const out = openBalance(inv);
    const d = daysOverdue(inv.dueDate);
    b.total += out;
    if (d <= 0) b.current += out;
    else if (d <= 30) b.d30 += out;
    else if (d <= 60) b.d60 += out;
    else if (d <= 90) b.d90 += out;
    else b.d90plus += out;
  }
  return b;
}
