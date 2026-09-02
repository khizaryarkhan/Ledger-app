/**
 * Accounting foundation reconciliation — the check that turns "our schema
 * follows QBO's model" from a claim into something that fails loudly.
 *
 * Four assertions, per org:
 *   1. Every journal entry balances to the cent (debits == credits).
 *   2. A/R control account balance == Σ open native invoice balances.
 *   3. A/P control account balance == Σ open native bill balances.
 *   4. invoices.paid (the derived cache) == Σ settlement links applied to
 *      that invoice's GL entry — i.e. the cache agrees with the graph that
 *      owns it.
 *
 * Only NATIVE documents are asserted. A provider-mirrored org's ledger lives
 * in QBO/Xero, so its GL is legitimately empty here and comparing the two
 * would report false breaks.
 *
 * Usage:
 *   npx tsx scripts/reconcile-foundation.ts              # every org
 *   npx tsx scripts/reconcile-foundation.ts <orgId>      # one org
 *   DATABASE_URL="<neon-branch-url>" npx tsx scripts/reconcile-foundation.ts
 *
 * Exit code is 1 if any assertion fails, so it can gate CI.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n: number) => r2(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TOL = 0.01; // one cent

type Failure = { org: string; check: string; detail: string };

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = neon(url);
  const onlyOrg = process.argv[2] ?? null;

  const orgs = (await sql(
    onlyOrg
      ? `select id, name from organisations where id = $1`
      : `select id, name from organisations order by name`,
    onlyOrg ? [onlyOrg] : [],
  )) as { id: string; name: string }[];

  if (orgs.length === 0) { console.log("No organisations matched."); return; }

  const failures: Failure[] = [];

  for (const org of orgs) {
    console.log(`\n── ${org.name} (${org.id})`);

    // ── 1. every entry balances ───────────────────────────────────────────
    const unbalanced = (await sql(
      `select e.id, e.doc_number, e.entry_date,
              coalesce(sum(l.debit),0)  as dr,
              coalesce(sum(l.credit),0) as cr
         from journal_entries e
         left join journal_lines l on l.entry_id = e.id
        where e.org_id = $1
        group by e.id, e.doc_number, e.entry_date
       having abs(coalesce(sum(l.debit),0) - coalesce(sum(l.credit),0)) > 0.005`,
      [org.id],
    )) as { id: string; doc_number: string | null; entry_date: string; dr: string; cr: string }[];

    if (unbalanced.length) {
      for (const u of unbalanced) {
        failures.push({ org: org.name, check: "entry balances", detail: `${u.doc_number ?? u.id} (${u.entry_date}): Dr ${money(+u.dr)} vs Cr ${money(+u.cr)}` });
      }
      console.log(`  ✗ entry balances — ${unbalanced.length} unbalanced entr${unbalanced.length === 1 ? "y" : "ies"}`);
    } else {
      console.log(`  ✓ entry balances`);
    }

    // ── 2 & 3. control accounts vs subledgers ─────────────────────────────
    // Posted-only: a reversed entry's lines stay on record but net to zero
    // against their reversal, so summing all Posted lines is correct.
    const controlBalance = async (subtype: string) => {
      const rows = (await sql(
        `select coalesce(sum(l.debit),0) - coalesce(sum(l.credit),0) as bal
           from journal_lines l
           join journal_entries e on e.id = l.entry_id
           join accounts a on a.id = l.account_id
          where l.org_id = $1 and lower(a.subtype) = lower($2) and e.status = 'Posted'`,
        [org.id, subtype],
      )) as { bal: string }[];
      return r2(+(rows[0]?.bal ?? 0));
    };

    const arControl = await controlBalance("AccountsReceivable");
    const [arSub] = (await sql(
      `select coalesce(sum(greatest(coalesce(i.total,0) - coalesce(i.paid,0), 0)),0) as open
         from invoices i
        where i.org_id = $1 and i.journal_entry_id is not null
          and coalesce(i.txn_type,'Invoice') <> 'CreditMemo'`,
      [org.id],
    )) as { open: string }[];
    const arOpen = r2(+arSub.open);
    if (Math.abs(arControl - arOpen) > TOL) {
      failures.push({ org: org.name, check: "A/R control", detail: `GL ${money(arControl)} vs open invoices ${money(arOpen)} (diff ${money(arControl - arOpen)})` });
      console.log(`  ✗ A/R control — GL ${money(arControl)} vs subledger ${money(arOpen)}`);
    } else {
      console.log(`  ✓ A/R control — ${money(arControl)}`);
    }

    // A one-line A/R diff isn't actionable, and the two ways it drifts have
    // completely different causes and fixes — so name them separately.
    //   • posted-but-unbridged: an Invoice entry hit the A/R control account
    //     but no `invoices` row points at it, so it is invisible to
    //     collections and to AR aging (bridgeNativeInvoice used to skip
    //     silently when the invoice had no picked customer).
    //   • off-ledger: an `invoices` row with no GL entry at all — receivable
    //     the books have never seen.
    const unbridged = (await sql(
      `select e.doc_number, e.entry_date, coalesce(sum(l.debit) - sum(l.credit),0) as amt
         from journal_lines l
         join journal_entries e on e.id = l.entry_id
         join accounts a on a.id = l.account_id
        where l.org_id = $1 and lower(a.subtype) = 'accountsreceivable'
          and e.status = 'Posted' and e.source_type = 'Invoice'
          and not exists (select 1 from invoices i where i.journal_entry_id = e.id)
        group by e.id, e.doc_number, e.entry_date`,
      [org.id],
    )) as { doc_number: string | null; entry_date: string; amt: string }[];
    if (unbridged.length) {
      const tot = r2(unbridged.reduce((s, u) => s + +u.amt, 0));
      failures.push({ org: org.name, check: "A/R posted-but-unbridged", detail: `${unbridged.length} invoice entr${unbridged.length === 1 ? "y" : "ies"} totalling ${money(tot)} are in the GL with no receivable row (${unbridged.slice(0, 5).map(u => u.doc_number ?? u.entry_date).join(", ")})` });
      console.log(`  ✗ A/R posted-but-unbridged — ${unbridged.length} entr${unbridged.length === 1 ? "y" : "ies"}, ${money(tot)} invisible to collections`);
    } else {
      console.log(`  ✓ A/R posted-but-unbridged — none`);
    }

    // NOTE: `invoices.source` cannot be trusted to mean "native" — it defaults
    // to 'native' and the provider syncs don't always overwrite it, so
    // QBO/Xero-synced rows are frequently labelled 'native' too (6,776 of
    // them on one org, every one carrying a qbo_id). The reliable
    // discriminators are journal_entry_id (ours) and the provider id columns
    // (theirs), so key off those instead.
    const offLedger = (await sql(
      `select count(*) as n, coalesce(sum(coalesce(total,0) - coalesce(paid,0)),0) as open
         from invoices
        where org_id = $1 and journal_entry_id is null
          and qbo_id is null and xero_id is null and sage_intacct_id is null
          and coalesce(txn_type,'Invoice') <> 'CreditMemo'`,
      [org.id],
    )) as { n: string; open: string }[];
    if (+offLedger[0].n > 0) {
      failures.push({ org: org.name, check: "A/R off-ledger", detail: `${offLedger[0].n} native invoice(s) with ${money(+offLedger[0].open)} open have no GL entry` });
      console.log(`  ✗ A/R off-ledger — ${offLedger[0].n} native invoice(s), ${money(+offLedger[0].open)} never posted`);
    } else {
      console.log(`  ✓ A/R off-ledger — none`);
    }

    // ap_bills.entry_id arrives with migration 0076; tolerate its absence so
    // this harness is runnable on a database that hasn't migrated yet.
    const [{ has_entry_id }] = (await sql(
      `select exists (select 1 from information_schema.columns
                       where table_schema='public' and table_name='ap_bills' and column_name='entry_id') as has_entry_id`,
    )) as { has_entry_id: boolean }[];

    if (!has_entry_id) {
      console.log(`  – A/P control — skipped (ap_bills.entry_id not migrated yet)`);
    } else {
      const apControl = await controlBalance("AccountsPayable");
      const [apSub] = (await sql(
        `select coalesce(sum(greatest(coalesce(b.total,0) - coalesce(b.amount_paid,0), 0)),0) as open
           from ap_bills b
          where b.org_id = $1 and b.entry_id is not null`,
        [org.id],
      )) as { open: string }[];
      const apOpen = r2(+apSub.open);
      // A/P is a credit-balance account, so flip the sign to compare with the
      // outstanding subledger total.
      if (Math.abs(-apControl - apOpen) > TOL) {
        failures.push({ org: org.name, check: "A/P control", detail: `GL ${money(-apControl)} vs open bills ${money(apOpen)} (diff ${money(-apControl - apOpen)})` });
        console.log(`  ✗ A/P control — GL ${money(-apControl)} vs subledger ${money(apOpen)}`);
      } else {
        console.log(`  ✓ A/P control — ${money(-apControl)}`);
      }

      const offLedgerBills = (await sql(
        `select count(*) as n, coalesce(sum(coalesce(total,0) - coalesce(amount_paid,0)),0) as open
           from ap_bills
          where org_id = $1 and entry_id is null
            and qbo_id is null and xero_id is null and sage_intacct_id is null`,
        [org.id],
      )) as { n: string; open: string }[];
      if (+offLedgerBills[0].n > 0) {
        failures.push({ org: org.name, check: "A/P off-ledger", detail: `${offLedgerBills[0].n} native bill(s) with ${money(+offLedgerBills[0].open)} open have no GL entry (created before the one-bill-path fix)` });
        console.log(`  ✗ A/P off-ledger — ${offLedgerBills[0].n} native bill(s), ${money(+offLedgerBills[0].open)} never posted`);
      } else {
        console.log(`  ✓ A/P off-ledger — none`);
      }
    }

    // ── 4. derived paid cache vs the settlement graph ─────────────────────
    const drift = (await sql(
      `select i.invoice_number, i.total, i.paid,
              coalesce(( select sum(tl.amount) from transaction_links tl
                          where tl.org_id = i.org_id
                            and tl.to_id = i.journal_entry_id
                            and tl.relation in ('payment','credit') ), 0) as applied
         from invoices i
        where i.org_id = $1 and i.journal_entry_id is not null`,
      [org.id],
    )) as { invoice_number: string | null; total: string; paid: string; applied: string }[];

    const drifted = drift.filter(d => {
      // paid is capped at total by syncNativeInvoicePaid, so compare against
      // the same cap rather than flagging a legitimate over-application.
      const expected = Math.min(r2(+d.applied), r2(+d.total));
      return Math.abs(expected - r2(+d.paid)) > TOL;
    });
    if (drifted.length) {
      for (const d of drifted.slice(0, 10)) {
        failures.push({ org: org.name, check: "paid cache", detail: `${d.invoice_number ?? "(no number)"}: cache ${money(+d.paid)} vs links ${money(Math.min(+d.applied, +d.total))}` });
      }
      console.log(`  ✗ paid cache — ${drifted.length} invoice(s) disagree with the links graph`);
    } else {
      console.log(`  ✓ paid cache — ${drift.length} native invoice(s) agree with the links graph`);
    }
  }

  console.log("\n" + "─".repeat(60));
  if (failures.length === 0) {
    console.log("All assertions passed.");
    return;
  }
  console.log(`${failures.length} assertion failure(s):\n`);
  for (const f of failures) console.log(`  [${f.org}] ${f.check}: ${f.detail}`);
  process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });
