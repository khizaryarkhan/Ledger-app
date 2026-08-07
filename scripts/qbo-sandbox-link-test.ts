/**
 * QBO SANDBOX — Estimate→Invoice native-link test (Progress Invoicing ON vs OFF).
 *
 * Isolates whether QuickBooks' public Accounting API persists an Estimate↔Invoice
 * LinkedTxn depending on the company's Progress Invoicing setting. Runs entirely
 * against an Intuit *sandbox* company — never touches production books.
 *
 * ─── How to run ────────────────────────────────────────────────────────────
 * 1. Get a SANDBOX access token + realm id from Intuit's OAuth 2.0 Playground:
 *      https://developer.intuit.com/app/developer/playground
 *      • Scope:  com.intuit.quickbooks.accounting
 *      • Environment: Sandbox
 *      • "Get authorization code" → "Get tokens" → copy Access Token + Realm ID
 * 2. Run it (Git Bash / PowerShell):
 *      QBO_SANDBOX_TOKEN="<access token>" QBO_SANDBOX_REALM="<realm id>" \
 *        npx tsx scripts/qbo-sandbox-link-test.ts
 * 3. In the sandbox company UI (https://sandbox.qbo.intuit.com) toggle
 *      Account and settings → Sales → Progress Invoicing, then run again.
 *    The script prints UsingProgressInvoicing for each run, so run it once with
 *    it OFF and once with it ON and compare `linkPersisted`.
 *
 * Token is passed via env only — nothing is written to disk or committed.
 */

const BASE = "https://sandbox-quickbooks.api.intuit.com/v3/company";
const MINOR = "minorversion=73";

const TOKEN = process.env.QBO_SANDBOX_TOKEN;
const REALM = process.env.QBO_SANDBOX_REALM;

if (!TOKEN || !REALM) {
  console.error("Missing QBO_SANDBOX_TOKEN and/or QBO_SANDBOX_REALM env vars. See header for how to get them.");
  process.exit(1);
}

const auth = { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" };

async function qGet(path: string): Promise<{ status: number; tid: string | null; body: any }> {
  const res = await fetch(`${BASE}/${REALM}/${path}?${MINOR}`, { headers: auth });
  return { status: res.status, tid: res.headers.get("intuit_tid"), body: await res.json().catch(() => null) };
}
async function qQuery(sql: string): Promise<any> {
  const res = await fetch(`${BASE}/${REALM}/query?query=${encodeURIComponent(sql)}&${MINOR}`, { headers: auth });
  return (await res.json().catch(() => ({})))?.QueryResponse ?? {};
}
async function qPost(path: string, body: any, operation?: string): Promise<{ ok: boolean; status: number; tid: string | null; body: any }> {
  const qs = operation ? `?operation=${operation}&${MINOR}` : `?${MINOR}`;
  const res = await fetch(`${BASE}/${REALM}/${path}${qs}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, tid: res.headers.get("intuit_tid"), body: json };
}
const hasEstimateLink = (inv: any) =>
  (inv?.LinkedTxn || []).some((x: any) => x.TxnType === "Estimate") ||
  (inv?.Line || []).some((l: any) => (l.LinkedTxn || []).some((x: any) => x.TxnType === "Estimate"));

// Try to set the company's Progress Invoicing preference via the API. Returns
// the actual persisted value (read back), or null if the pref isn't writable.
async function setProgressInvoicing(desired: boolean): Promise<boolean | null> {
  const cur = await qGet("preferences");
  const prefsObj = cur.body?.Preferences;
  if (!prefsObj) return null;
  prefsObj.SalesFormsPrefs = prefsObj.SalesFormsPrefs || {};
  prefsObj.SalesFormsPrefs.UsingProgressInvoicing = desired;
  const res = await qPost("preferences", prefsObj, "update");
  if (!res.ok) return null;
  const after = await qGet("preferences");
  return after.body?.Preferences?.SalesFormsPrefs?.UsingProgressInvoicing ?? null;
}

async function main() {
  console.log(`\n=== QBO SANDBOX link test — realm ${REALM} ===\n`);

  // 0. Progress Invoicing setting for this run.
  const prefs = await qGet("preferences");
  const usingProgress = prefs.body?.Preferences?.SalesFormsPrefs?.UsingProgressInvoicing ?? "unknown";
  console.log(`UsingProgressInvoicing (current): ${usingProgress}   (prefs tid ${prefs.tid})`);

  // 1. Get or create an Accepted estimate.
  let est = (await qQuery("select * from Estimate maxresults 20")).Estimate?.find((e: any) => e.TxnStatus === "Accepted")
    || (await qQuery("select * from Estimate maxresults 1")).Estimate?.[0];
  if (!est) {
    const customer = (await qQuery("select * from Customer maxresults 1")).Customer?.[0];
    const item = (await qQuery("select * from Item where Type = 'Service' maxresults 1")).Item?.[0];
    if (!customer || !item) { console.error("Sandbox has no customer/item to build an estimate from."); process.exit(1); }
    const created = await qPost("estimate", {
      CustomerRef: { value: customer.Id },
      TxnStatus: "Accepted",
      Line: [{ DetailType: "SalesItemLineDetail", Amount: 1000, SalesItemLineDetail: { ItemRef: { value: item.Id }, Qty: 1, UnitPrice: 1000 } }],
    });
    est = created.body?.Estimate;
    console.log(`Created estimate ${est?.Id} (tid ${created.tid})`);
  }
  if (!est) { console.error("Could not obtain an estimate."); process.exit(1); }
  const estId = String(est.Id);
  const estLine = (est.Line || []).find((l: any) => l.DetailType === "SalesItemLineDetail");
  const estLineId = String(estLine.Id);
  const up = Number(estLine.SalesItemLineDetail?.UnitPrice) || Number(estLine.Amount) || 1000;
  console.log(`Using estimate ${estId} (DocNumber ${est.DocNumber}, TxnStatus ${est.TxnStatus}), line ${estLineId}, unitPrice ${up}\n`);

  const billed = Math.round(up * 0.5 * 100) / 100; // bill 50%

  // One battery = TEST A (create WITH link) + TEST B (minimal sparse link),
  // each on its own throwaway invoice which is deleted afterwards.
  async function runBattery(label: string): Promise<{ a: boolean; b: boolean }> {
    console.log(`\n----- BATTERY: ${label} -----`);
    const created: string[] = [];

    // TEST A — create invoice WITH the estimate link (txn + line level).
    const createPayload = {
      CustomerRef: est.CustomerRef,
      ...(est.CurrencyRef ? { CurrencyRef: est.CurrencyRef } : {}),
      LinkedTxn: [{ TxnId: estId, TxnType: "Estimate" }],
      Line: [{
        DetailType: "SalesItemLineDetail",
        Amount: billed,
        LinkedTxn: [{ TxnId: estId, TxnType: "Estimate", TxnLineId: estLineId }],
        SalesItemLineDetail: {
          ItemRef: estLine.SalesItemLineDetail?.ItemRef,
          Qty: billed / up,
          UnitPrice: up,
          ...(estLine.SalesItemLineDetail?.TaxCodeRef ? { TaxCodeRef: estLine.SalesItemLineDetail.TaxCodeRef } : {}),
        },
      }],
    };
    const createRes = await qPost("invoice", createPayload);
    const invA = createRes.body?.Invoice;
    if (invA?.Id) created.push(invA.Id);
    const readA = invA?.Id ? await qGet(`invoice/${invA.Id}`) : { body: null, tid: null };
    const aLinked = hasEstimateLink(readA.body?.Invoice);
    console.log("TEST A — create WITH link:");
    console.log(`  create ok=${createRes.ok} tid=${createRes.tid}  createResponseLinked=${hasEstimateLink(invA)}`);
    console.log(`  readback linkPersisted=${aLinked}  LinkedTxn=${JSON.stringify(readA.body?.Invoice?.LinkedTxn ?? [])}  (tid ${readA.tid})`);

    // TEST B — minimal sparse update (only the estimate link) on a fresh invoice.
    const plain = await qPost("invoice", {
      CustomerRef: est.CustomerRef,
      ...(est.CurrencyRef ? { CurrencyRef: est.CurrencyRef } : {}),
      Line: [{ DetailType: "SalesItemLineDetail", Amount: billed, SalesItemLineDetail: { ItemRef: estLine.SalesItemLineDetail?.ItemRef, Qty: billed / up, UnitPrice: up } }],
    });
    const invB = plain.body?.Invoice;
    if (invB?.Id) created.push(invB.Id);
    let sparseRes: any = null, readB: any = { body: null, tid: null };
    if (invB?.Id) {
      sparseRes = await qPost("invoice", { Id: invB.Id, SyncToken: invB.SyncToken, sparse: true, LinkedTxn: [{ TxnId: estId, TxnType: "Estimate" }] }, "update");
      readB = await qGet(`invoice/${invB.Id}`);
    }
    const bLinked = hasEstimateLink(readB.body?.Invoice);
    console.log("TEST B — minimal sparse update (only LinkedTxn):");
    console.log(`  create ok=${plain.ok} tid=${plain.tid}  sparse-update ok=${sparseRes?.ok} tid=${sparseRes?.tid}`);
    console.log(`  readback linkPersisted=${bLinked}  LinkedTxn=${JSON.stringify(readB.body?.Invoice?.LinkedTxn ?? [])}  (tid ${readB.tid})`);

    for (const id of created) {
      const cur = await qGet(`invoice/${id}`);
      const st = cur.body?.Invoice?.SyncToken;
      if (st != null) await qPost("invoice", { Id: id, SyncToken: st }, "delete").catch(() => {});
    }
    console.log(`(cleanup: deleted ${created.length} test invoice[s])`);
    return { a: aLinked, b: bLinked };
  }

  // Drive both states automatically via the Preferences API (fall back to the
  // current state + manual toggle if the pref isn't writable via API).
  const results: Record<string, { a: boolean; b: boolean }> = {};
  const original = usingProgress === true;

  const off = await setProgressInvoicing(false);
  if (off === false) results["Progress OFF"] = await runBattery("Progress Invoicing OFF");
  else console.log(`\n[!] Could not set Progress Invoicing OFF via API (got ${off}). Toggle it in the sandbox UI and re-run.`);

  const on = await setProgressInvoicing(true);
  if (on === true) results["Progress ON"] = await runBattery("Progress Invoicing ON");
  else console.log(`\n[!] Could not set Progress Invoicing ON via API (got ${on}). Toggle it in the sandbox UI and re-run.`);

  // Restore original setting.
  await setProgressInvoicing(original);

  if (Object.keys(results).length === 0) {
    console.log(`\nPreference not writable via API — running once at current state (${usingProgress}):`);
    results[`current=${usingProgress}`] = await runBattery(`current state (${usingProgress})`);
  }

  console.log(`\n=== SUMMARY ===`);
  for (const [label, r] of Object.entries(results)) {
    console.log(`  ${label.padEnd(14)}  create-with-link=${r.a}   sparse-link=${r.b}`);
  }
  console.log(`\nIf OFF persists and ON discards → blocker is the Progress-Invoicing pathway.`);
  console.log(`If both discard → public API does not persist estimate→invoice links at all.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
