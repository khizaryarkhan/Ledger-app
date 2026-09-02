/**
 * Accounting foundation reconciliation — the check that turns "our schema
 * follows QBO's model" into something that fails loudly instead of being
 * asserted in prose.
 *
 * Per org it answers five questions:
 *   1. Does every journal entry balance to the cent?
 *   2. Does the A/R control account agree with the open-invoice subledger?
 *   3. Does the A/P control account agree with the open-bill subledger?
 *   4. Is any document posted to a control account but missing from its
 *      subledger (the bridge silently dropped it)?
 *   5. Is any subledger document missing from the ledger entirely
 *      (off-ledger receivable/payable the books have never seen)?
 *   6. Does invoices.paid — a derived cache — agree with the settlement links
 *      graph that owns it?
 *
 * Only NATIVE documents are asserted. A provider-mirrored org's ledger lives
 * in QBO/Xero, so its GL is legitimately empty and comparing the two would
 * report false breaks.
 *
 * IMPORTANT — `invoices.source` / `ap_bills.source` are NOT usable to tell
 * native from mirrored: both default to 'native' and the provider syncs do
 * not reliably overwrite them, so synced rows are frequently labelled native
 * (thousands of them, each carrying a qbo_id). The trustworthy discriminators
 * are `journal_entry_id`/`entry_id` (ours) and the provider id columns
 * (theirs). Keying off `source` turns this report into noise.
 *
 * One implementation, two front doors: scripts/reconcile-foundation.ts (CLI)
 * and GET /api/admin/reconcile (platform-admin health check).
 */

import { db } from "@/db";
import { sql } from "drizzle-orm";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const TOL = 0.01; // one cent

export type CheckStatus = "pass" | "fail" | "skipped";

export type Check = {
  key: string;
  label: string;
  status: CheckStatus;
  /** One-line, human-readable outcome — safe to render directly. */
  detail: string;
};

export type OrgReconciliation = {
  orgId: string;
  orgName: string;
  usesNativeLedger: boolean;
  checks: Check[];
  failures: number;
};

/** drizzle's execute() returns driver-shaped results; normalise to rows. */
async function rows<T = any>(query: any): Promise<T[]> {
  const res: any = await db.execute(query);
  return (res?.rows ?? res ?? []) as T[];
}

const fmt = (n: number) => r2(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Net movement (debits − credits) on the org's accounts of a given subtype. */
async function controlBalance(orgId: string, subtype: string): Promise<number> {
  const r = await rows<{ bal: string }>(sql`
    select coalesce(sum(l.debit),0) - coalesce(sum(l.credit),0) as bal
      from journal_lines l
      join journal_entries e on e.id = l.entry_id
      join accounts a on a.id = l.account_id
     where l.org_id = ${orgId}
       and lower(a.subtype) = lower(${subtype})
       and e.status = 'Posted'`);
  return r2(Number(r[0]?.bal ?? 0));
}

export async function reconcileOrg(orgId: string, orgName: string): Promise<OrgReconciliation> {
  const checks: Check[] = [];

  const entryCount = await rows<{ n: number }>(sql`
    select count(*)::int as n from journal_entries where org_id = ${orgId}`);
  const usesNativeLedger = Number(entryCount[0]?.n ?? 0) > 0;

  // ── 1. every entry balances ───────────────────────────────────────────────
  const unbalanced = await rows<{ doc_number: string | null; entry_date: string; dr: string; cr: string }>(sql`
    select e.doc_number, e.entry_date,
           coalesce(sum(l.debit),0) as dr, coalesce(sum(l.credit),0) as cr
      from journal_entries e
      left join journal_lines l on l.entry_id = e.id
     where e.org_id = ${orgId}
     group by e.id, e.doc_number, e.entry_date
    having abs(coalesce(sum(l.debit),0) - coalesce(sum(l.credit),0)) > 0.005`);
  checks.push({
    key: "entries_balance",
    label: "Every journal entry balances",
    status: unbalanced.length ? "fail" : "pass",
    detail: unbalanced.length
      ? `${unbalanced.length} unbalanced: ${unbalanced.slice(0, 5).map(u => `${u.doc_number ?? u.entry_date} (Dr ${fmt(+u.dr)} vs Cr ${fmt(+u.cr)})`).join("; ")}`
      : `${Number(entryCount[0]?.n ?? 0)} entries checked`,
  });

  // ── 2. A/R control vs subledger ───────────────────────────────────────────
  const arControl = await controlBalance(orgId, "AccountsReceivable");
  const arSub = await rows<{ open: string }>(sql`
    select coalesce(sum(greatest(coalesce(i.total,0) - coalesce(i.paid,0), 0)),0) as open
      from invoices i
     where i.org_id = ${orgId} and i.journal_entry_id is not null
       and coalesce(i.txn_type,'Invoice') <> 'CreditMemo'`);
  const arOpen = r2(Number(arSub[0]?.open ?? 0));
  checks.push({
    key: "ar_control",
    label: "A/R control account agrees with open invoices",
    status: Math.abs(arControl - arOpen) > TOL ? "fail" : "pass",
    detail: Math.abs(arControl - arOpen) > TOL
      ? `GL ${fmt(arControl)} vs subledger ${fmt(arOpen)} — out by ${fmt(arControl - arOpen)}`
      : `${fmt(arControl)}`,
  });

  // ── 4a. posted to A/R but absent from the subledger ───────────────────────
  const unbridged = await rows<{ doc_number: string | null; entry_date: string; amt: string }>(sql`
    select e.doc_number, e.entry_date, coalesce(sum(l.debit) - sum(l.credit),0) as amt
      from journal_lines l
      join journal_entries e on e.id = l.entry_id
      join accounts a on a.id = l.account_id
     where l.org_id = ${orgId} and lower(a.subtype) = 'accountsreceivable'
       and e.status = 'Posted' and e.source_type = 'Invoice'
       and not exists (select 1 from invoices i where i.journal_entry_id = e.id)
     group by e.id, e.doc_number, e.entry_date`);
  const unbridgedTotal = r2(unbridged.reduce((s, u) => s + Number(u.amt), 0));
  checks.push({
    key: "ar_posted_unbridged",
    label: "No receivable posted to the GL but missing from collections",
    status: unbridged.length ? "fail" : "pass",
    detail: unbridged.length
      ? `${unbridged.length} entr${unbridged.length === 1 ? "y" : "ies"} totalling ${fmt(unbridgedTotal)} invisible to collections and AR aging (${unbridged.slice(0, 5).map(u => u.doc_number ?? u.entry_date).join(", ")})`
      : "none",
  });

  // ── 5a. subledger receivable never posted ─────────────────────────────────
  const arOffLedger = await rows<{ n: number; open: string }>(sql`
    select count(*)::int as n, coalesce(sum(coalesce(total,0) - coalesce(paid,0)),0) as open
      from invoices
     where org_id = ${orgId} and journal_entry_id is null
       and qbo_id is null and xero_id is null and sage_intacct_id is null
       and coalesce(txn_type,'Invoice') <> 'CreditMemo'`);
  const arOffN = Number(arOffLedger[0]?.n ?? 0);
  checks.push({
    key: "ar_off_ledger",
    label: "No receivable exists outside the ledger",
    status: arOffN > 0 ? "fail" : "pass",
    detail: arOffN > 0
      ? `${arOffN} invoice(s) with ${fmt(Number(arOffLedger[0].open))} open have no journal entry`
      : "none",
  });

  // ── 3 & 5b. A/P side (needs migration 0076's ap_bills.entry_id) ──────────
  const hasEntryId = await rows<{ ok: boolean }>(sql`
    select exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='ap_bills' and column_name='entry_id') as ok`);
  if (!hasEntryId[0]?.ok) {
    checks.push({ key: "ap_control", label: "A/P control account agrees with open bills", status: "skipped", detail: "ap_bills.entry_id not migrated on this database yet" });
    checks.push({ key: "ap_off_ledger", label: "No payable exists outside the ledger", status: "skipped", detail: "ap_bills.entry_id not migrated on this database yet" });
  } else {
    // A/P is a credit-balance account — flip the sign to compare against the
    // outstanding subledger total.
    const apControl = -(await controlBalance(orgId, "AccountsPayable"));
    const apSub = await rows<{ open: string }>(sql`
      select coalesce(sum(greatest(coalesce(b.total,0) - coalesce(b.amount_paid,0), 0)),0) as open
        from ap_bills b
       where b.org_id = ${orgId} and b.entry_id is not null`);
    const apOpen = r2(Number(apSub[0]?.open ?? 0));
    checks.push({
      key: "ap_control",
      label: "A/P control account agrees with open bills",
      status: Math.abs(apControl - apOpen) > TOL ? "fail" : "pass",
      detail: Math.abs(apControl - apOpen) > TOL
        ? `GL ${fmt(apControl)} vs subledger ${fmt(apOpen)} — out by ${fmt(apControl - apOpen)}`
        : `${fmt(apControl)}`,
    });

    const apOffLedger = await rows<{ n: number; open: string }>(sql`
      select count(*)::int as n, coalesce(sum(coalesce(total,0) - coalesce(amount_paid,0)),0) as open
        from ap_bills
       where org_id = ${orgId} and entry_id is null
         and qbo_id is null and xero_id is null and sage_intacct_id is null`);
    const apOffN = Number(apOffLedger[0]?.n ?? 0);
    checks.push({
      key: "ap_off_ledger",
      label: "No payable exists outside the ledger",
      status: apOffN > 0 ? "fail" : "pass",
      detail: apOffN > 0
        ? `${apOffN} bill(s) with ${fmt(Number(apOffLedger[0].open))} open have no journal entry (entered before the one-bill-path fix)`
        : "none",
    });
  }

  // ── 6. derived paid cache vs the settlement graph ─────────────────────────
  const drift = await rows<{ invoice_number: string | null; total: string; paid: string; applied: string }>(sql`
    select i.invoice_number, i.total, i.paid,
           coalesce(( select sum(tl.amount) from transaction_links tl
                       where tl.org_id = i.org_id
                         and tl.to_id = i.journal_entry_id
                         and tl.relation in ('payment','credit') ), 0) as applied
      from invoices i
     where i.org_id = ${orgId} and i.journal_entry_id is not null`);
  const drifted = drift.filter(d => {
    // paid is capped at total by syncNativeInvoicePaid, so compare against the
    // same cap rather than flagging a legitimate over-application.
    const expected = Math.min(r2(Number(d.applied)), r2(Number(d.total)));
    return Math.abs(expected - r2(Number(d.paid))) > TOL;
  });
  checks.push({
    key: "paid_cache",
    label: "invoices.paid agrees with the settlement links graph",
    status: drifted.length ? "fail" : "pass",
    detail: drifted.length
      ? `${drifted.length} disagree: ${drifted.slice(0, 5).map(d => `${d.invoice_number ?? "(no number)"} cache ${fmt(+d.paid)} vs links ${fmt(Math.min(+d.applied, +d.total))}`).join("; ")}`
      : `${drift.length} native invoice(s) agree`,
  });

  return {
    orgId, orgName, usesNativeLedger, checks,
    failures: checks.filter(c => c.status === "fail").length,
  };
}

/** Reconcile every org (or one, when `orgId` is given). */
export async function reconcileAll(orgId?: string | null): Promise<OrgReconciliation[]> {
  const orgs = await rows<{ id: string; name: string }>(
    orgId
      ? sql`select id, name from organisations where id = ${orgId}`
      : sql`select id, name from organisations order by name`,
  );
  const out: OrgReconciliation[] = [];
  for (const o of orgs) out.push(await reconcileOrg(o.id, o.name));
  return out;
}
