// NOT part of the app — injected into the browser console/page context via
// javascript_tool against the Foodready.ai QBO Sandbox org to load-test every
// Data Studio entity. Kept here only so the harness itself is reviewable /
// reproducible; never imported by the Next.js app.

const TODAY = "2026-09-05";
const pad = (n, w = 5) => String(n).padStart(w, "0");

// Each spec: columns for a fresh CREATE row (i = 1-based index), an `edit`
// function turning a downloaded row into a modify row (same Id/SyncToken,
// one changed field), and `linked` for receivepayment/billpayment which need
// a real invoice/bill number injected per-row from an earlier phase.
const SPECS = {
  invoice: {
    group: "customer", full: true,
    row: (i) => ({ "Invoice No": `CLDI${pad(i)}`, "Customer": "Customer A", "Invoice Date": TODAY, "Product/Service": "Claude Test Item", "Product/Service Quantity": "1", "Product/Service Rate": "10", "Memo": "Claude load test" }),
    edit: (r) => ({ ...r, "Memo": "Claude load test EDITED" }),
  },
  estimate: {
    group: "customer", full: true,
    row: (i) => ({ "Estimate No": `CLDE${pad(i)}`, "Customer": "Customer A", "Estimate Date": TODAY, "Product/Service": "Claude Test Item", "Product/Service Quantity": "1", "Product/Service Rate": "10", "Memo": "Claude load test" }),
    edit: (r) => ({ ...r, "Memo": "Claude load test EDITED" }),
  },
  creditmemo: {
    group: "customer", full: true,
    row: (i) => ({ "Credit Memo No": `CLDC${pad(i)}`, "Customer": "Customer A", "Credit Memo Date": TODAY, "Product/Service": "Claude Test Item", "Product/Service Quantity": "1", "Product/Service Rate": "10", "Memo": "Claude load test" }),
    edit: (r) => ({ ...r, "Memo": "Claude load test EDITED" }),
  },
  salesreceipt: {
    group: "customer", full: true,
    row: (i) => ({ "Sales Receipt No": `CLDS${pad(i)}`, "Customer": "Customer A", "Sales Receipt Date": TODAY, "Deposit To": "Claude Test Bank", "Product/Service": "Claude Test Item", "Product/Service Quantity": "1", "Product/Service Rate": "10", "Memo": "Claude load test" }),
    edit: (r) => ({ ...r, "Memo": "Claude load test EDITED" }),
  },
  refundreceipt: {
    group: "customer", full: true,
    row: (i) => ({ "Refund Receipt No": `CLDR${pad(i)}`, "Customer": "Customer A", "Refund Receipt date": TODAY, "Refunded From": "Claude Test Bank", "Product/Service": "Claude Test Item", "Product/Service Quantity": "1", "Product/Service Rate": "10", "Memo": "Claude load test" }),
    edit: (r) => ({ ...r, "Memo": "Claude load test EDITED" }),
  },
  receivepayment: {
    group: "customer", full: true, needsInvoices: true,
    row: (i, invNo) => ({ "Ref No": `CLDP${pad(i)}`, "Payment Date": TODAY, "Customer": "Customer A", "Deposit To Account Name": "Payments to deposit", "Invoice No": invNo, "Amount": "10", "Memo": "Claude load test" }),
    edit: (r) => ({ ...r, "Memo": "Claude load test EDITED" }),
  },
  bill: {
    group: "vendor", full: true,
    row: (i) => ({ "Bill No": `CLDB${pad(i)}`, "Vendor": "Claude Test Vendor", "Bill Date": TODAY, "Expense Account ": "Advertising & marketing", "Expense Line Amount": "10", "Memo": "Claude load test" }),
    edit: (r) => ({ ...r, "Memo": "Claude load test EDITED" }),
  },
  expense: {
    group: "vendor", full: true,
    row: (i) => ({ "Ref No": `CLDX${pad(i)}`, "Account": "Cash", "Payee": "Claude Test Vendor", "Payment Date": TODAY, "Expense Account ": "Advertising & marketing", "Expense Line Amount": "10", "Memo": "Claude load test" }),
    edit: (r) => ({ ...r, "Memo": "Claude load test EDITED" }),
  },
  check: {
    group: "vendor", full: true,
    row: (i) => ({ "Check no": `CLDK${pad(i)}`, "Bank Account ": "Cash", "Payee": "Claude Test Vendor", "Payment Date": TODAY, "Expense Account ": "Advertising & marketing", "Expense Line Amount": "10", "Memo": "Claude load test" }),
    edit: (r) => ({ ...r, "Memo": "Claude load test EDITED" }),
  },
  purchaseorder: {
    group: "vendor", full: true,
    row: (i) => ({ "PO No": `CLDO${pad(i)}`, "Vendor": "Claude Test Vendor", "Purchase Order Date": TODAY, "Expense Account ": "Advertising & marketing", "Expense Line Amount": "10", "Memo": "Claude load test" }),
    edit: (r) => ({ ...r, "Memo": "Claude load test EDITED" }),
  },
  vendorcredit: {
    group: "vendor", full: true,
    row: (i) => ({ "Ref No": `CLDV${pad(i)}`, "Vendor": "Claude Test Vendor", "Payment Date": TODAY, "Expense Account ": "Advertising & marketing", "Expense Line Amount": "10", "Memo": "Claude load test" }),
    edit: (r) => ({ ...r, "Memo": "Claude load test EDITED" }),
  },
  billpayment: {
    group: "vendor", full: true, needsBills: true,
    row: (i, billNo) => ({ "Ref No": `CLDY${pad(i)}`, "Vendor": "Claude Test Vendor", "Payment Date": TODAY, "Bank or CC Account": "Cash", "Bill No": billNo, " Amount": "10", "Memo": "Claude load test" }),
    edit: (r) => ({ ...r, "Memo": "Claude load test EDITED" }),
  },
  creditcardcredit: {
    group: "vendor", full: true,
    row: (i) => ({ "Ref No": `CLDD${pad(i)}`, "Account": "Claude Test Credit Card", "Payee": "Claude Test Vendor", "Payment Date": TODAY, "Expense Account ": "Advertising & marketing", "Expense Line Amount": "10", "Memo": "Claude load test" }),
    edit: (r) => ({ ...r, "Memo": "Claude load test EDITED" }),
  },
  journalentry: {
    group: "other", full: true, rowsPerDoc: 2,
    rows: (i) => [
      { "Journal No": `CLDJ${pad(i)}`, "Journal Date": TODAY, "Account": "Accounts receivable (A/R)", "Amount": "10", "Name": "Customer A", "Memo": "Claude load test" },
      { "Journal No": `CLDJ${pad(i)}`, "Journal Date": TODAY, "Account": "Cash", "Amount": "-10", "Memo": "Claude load test" },
    ],
    edit: (rs) => rs.map((r) => ({ ...r, "Memo": "Claude load test EDITED" })),
  },
  deposit: {
    group: "other", full: true,
    row: (i) => ({ "Deposit No": `CLDP${pad(i)}`, "Date": TODAY, "Deposit To Account": "Cash", "Line Account": "Sales", "Line Amount": "10", "Memo": "Claude load test" }),
    edit: (r) => ({ ...r, "Memo": "Claude load test EDITED" }),
  },
  transfer: {
    group: "other", full: true, noDocKey: true,
    row: (i) => ({ "Transfer Funds From": "Cash", "Transfer Funds To": "Claude Test Bank", "Transfer Amount": "10", "Date": TODAY, "Memo": `Claude load test ${i}` }),
    edit: (r) => ({ ...r, "Memo": r["Memo"] + " EDITED" }),
  },
  timeactivity: {
    group: "other", full: false, noDocKey: true,
    row: (i) => ({ "Name": "Claude TestEmployee", "Date": TODAY, "Hours": "1", "Customer": "Customer A", "Service": "Claude Test Item", "Description": `Claude load test ${i}` }),
    edit: (r) => ({ ...r, "Description": r["Description"] + " EDITED" }),
  },
  customer: {
    group: "list", full: false,
    row: (i) => ({ "Display Name As": `Claude Test Customer ${pad(i)}` }),
    edit: (r) => ({ ...r, "Notes": "Claude load test EDITED" }),
  },
  vendor: {
    group: "list", full: false,
    row: (i) => ({ "Display Name As": `Claude Test Vendor ${pad(i)}` }),
    edit: (r) => ({ ...r, "Notes": "Claude load test EDITED" }),
  },
  item: {
    group: "list", full: false,
    row: (i) => ({ "Name": `Claude Test Item ${pad(i)}`, "Type": "Service", "Income Account ": "Sales" }),
    edit: (r) => ({ ...r, "Sales Description": "Claude load test EDITED" }),
  },
  account: {
    group: "list", full: false,
    row: (i) => ({ "Name": `Claude Test Account ${pad(i)}`, "Account Type": "Expense", "Account Subtype": "AdvertisingPromotional" }),
    edit: (r) => ({ ...r, "Description": "Claude load test EDITED" }),
  },
  class: {
    group: "list", full: false,
    row: (i) => ({ "Name": `Claude Test Class ${pad(i)}` }),
    edit: (r) => ({ ...r }), // Name is the only field; nothing else to safely edit without renaming
  },
  department: {
    group: "list", full: false,
    row: (i) => ({ "Name": `Claude Test Location ${pad(i)}` }),
    edit: (r) => ({ ...r }),
  },
  employee: {
    group: "list", full: false,
    row: (i) => ({ "Display Name As": `Claude Test Employee ${pad(i)}`, "First Name": "Claude", "Last Name": `Employee${pad(i)}` }),
    edit: (r) => ({ ...r, "Email": "claude-test@example.com" }),
  },
};

const ORDER = [
  "invoice", "bill", // create first, keep alive for payments
  "estimate", "creditmemo", "salesreceipt", "refundreceipt",
  "expense", "check", "purchaseorder", "vendorcredit", "creditcardcredit",
  "journalentry", "deposit", "transfer", "timeactivity",
  "customer", "vendor", "item", "account", "class", "department", "employee",
  "receivepayment", "billpayment", // depend on invoice/bill
  // invoice/bill delete happens LAST, after receivepayment/billpayment are done with them
];

async function commit(entity, operation, rows, fileName) {
  const mapping = {};
  Object.keys(rows[0]).forEach((k) => { mapping[k] = k; });
  const res = await fetch("/api/batch/upload/commit", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entity, operation, fileName, mapping, overrides: {}, rawRows: rows }),
  });
  const data = await res.json().catch(() => null);
  return { http: res.status, data };
}

async function deleteRecords(entity, targets) {
  const res = await fetch("/api/batch/delete/commit", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entity, targets }),
  });
  const data = await res.json().catch(() => null);
  return { http: res.status, data };
}

/** Nudge a chunked job via run-chunk-now until done, or return its last outcome. */
async function driveJob(jobId, maxIters = 60) {
  for (let n = 0; n < maxIters; n++) {
    const res = await fetch(`/api/batch/jobs/${jobId}/run-chunk-now`, { method: "POST" });
    const outcome = await res.json().catch(() => null);
    if (!outcome || !outcome.data) return { error: "run-chunk-now failed", http: res.status };
    const o = outcome.data;
    if (o.done || o.status === "done") return o;
    if (o.busy) { await new Promise((r) => setTimeout(r, 500)); continue; }
    if (o.error && !o.accepted) return o; // genuine failure
  }
  return { error: "gave up after max iterations" };
}

async function getJob(jobId) {
  return fetch(`/api/batch/jobs/${jobId}?debugErrors=1`).then((r) => r.json());
}

async function downloadCsv(entity) {
  const t0 = Date.now();
  const res = await fetch("/api/batch/download", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entity, format: "csv" }),
  });
  const text = await res.text();
  const ms = Date.now() - t0;
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return { ms, headers: [], rows: [] };
  const parseLine = (line) => {
    const out = []; let cur = ""; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') inQ = false; else cur += c; }
      else { if (c === '"') inQ = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; }
    }
    out.push(cur);
    return out;
  };
  const headers = parseLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map((l) => {
    const cells = parseLine(l);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cells[i] ?? ""; });
    return obj;
  });
  return { ms, headers, rows };
}

window.__loadTest = { status: "running", startedAt: Date.now(), entities: {}, order: ORDER };

async function runEntity(entityId, n, ctx) {
  const spec = SPECS[entityId];
  const rep = { entity: entityId, n, phases: {} };
  window.__loadTest.entities[entityId] = rep;

  try {
    // ---- CREATE ----
    let rows;
    if (spec.rowsPerDoc === 2) {
      rows = [];
      for (let i = 1; i <= n; i++) rows.push(...spec.rows(i));
    } else if (spec.needsInvoices) {
      rows = [];
      for (let i = 1; i <= n; i++) rows.push(spec.row(i, ctx.invoiceNos[(i - 1) % ctx.invoiceNos.length]));
    } else if (spec.needsBills) {
      rows = [];
      for (let i = 1; i <= n; i++) rows.push(spec.row(i, ctx.billNos[(i - 1) % ctx.billNos.length]));
    } else {
      rows = [];
      for (let i = 1; i <= n; i++) rows.push(spec.row(i));
    }

    const t0 = Date.now();
    const { data: createResp } = await commit(entityId, "upload", rows, `claude-load-${entityId}.csv`);
    if (!createResp || !createResp.jobId) { rep.phases.create = { error: "commit failed", createResp }; return rep; }
    let job;
    if (createResp.background) job = await driveJob(createResp.jobId);
    else job = await getJob(createResp.jobId);
    const createMs = Date.now() - t0;
    const full = await getJob(createResp.jobId);
    rep.phases.create = {
      ms: createMs, jobId: createResp.jobId, background: createResp.background,
      successCount: full.successCount, errorCount: full.errorCount, totalRows: full.totalRows,
      sampleErrors: (full.results || []).filter((r) => !r.ok).slice(0, 3),
    };
    const createdIds = (full.results || []).filter((r) => r.ok).map((r) => r.qboId).filter(Boolean);
    rep.createdCount = createdIds.length;

    // ---- DOWNLOAD ----
    const dl = await downloadCsv(entityId);
    rep.phases.download = { ms: dl.ms, rowCount: dl.rows.length };

    // Only work with OUR rows (match by Id against createdIds) for modify/delete,
    // so a shared sandbox with pre-existing records isn't touched.
    const idSet = new Set(createdIds.map(String));
    const ourRows = dl.rows.filter((r) => idSet.has(String(r["Id"])));

    // ---- MODIFY ----
    if (ourRows.length > 0 && spec.edit) {
      let modRows;
      if (spec.rowsPerDoc === 2) {
        // group by Journal No, edit each group together
        const byDoc = new Map();
        for (const r of ourRows) {
          const k = r["Journal No"];
          if (!byDoc.has(k)) byDoc.set(k, []);
          byDoc.get(k).push(r);
        }
        modRows = [];
        for (const group of byDoc.values()) modRows.push(...spec.edit(group));
      } else {
        modRows = ourRows.map((r) => spec.edit(r));
      }
      const t1 = Date.now();
      const { data: modResp } = await commit(entityId, "modify", modRows, `claude-load-${entityId}-edit.csv`);
      if (modResp && modResp.jobId) {
        let mjob = modResp.background ? await driveJob(modResp.jobId) : await getJob(modResp.jobId);
        const modMs = Date.now() - t1;
        const mfull = await getJob(modResp.jobId);
        rep.phases.modify = {
          ms: modMs, jobId: modResp.jobId, background: modResp.background,
          successCount: mfull.successCount, errorCount: mfull.errorCount, totalRows: mfull.totalRows,
          sampleErrors: (mfull.results || []).filter((r) => !r.ok).slice(0, 3),
        };
      } else {
        rep.phases.modify = { error: "commit failed", modResp };
      }
    }

    // Stash invoice/bill numbers + ids for receivepayment/billpayment dependency,
    // and for the final invoice/bill delete pass done at the very end.
    if (entityId === "invoice") { ctx.invoiceNos = rows.map((r) => r["Invoice No"]); ctx.invoiceIds = createdIds; }
    if (entityId === "bill") { ctx.billNos = rows.map((r) => r["Bill No"]); ctx.billIds = createdIds; }

    // ---- DELETE ---- (skip for invoice/bill here — done at the very end, see ctx.deferDelete)
    if (spec.full !== false && !ctx.deferDelete?.has(entityId)) {
      const dl2 = await downloadCsv(entityId);
      const ourRows2 = dl2.rows.filter((r) => idSet.has(String(r["Id"])));
      // Dedupe by Id — an entity whose toRows emits one row per LINE (e.g.
      // journalentry) has the same document Id repeated across its rows;
      // deleting the same Id twice fails the second time (already gone).
      const seenIds = new Set();
      const targets = [];
      for (const r of ourRows2) {
        if (seenIds.has(r["Id"])) continue;
        seenIds.add(r["Id"]);
        targets.push({ id: r["Id"], syncToken: r["SyncToken"] });
      }
      if (targets.length) {
        const t2 = Date.now();
        const { data: delResp } = await deleteRecords(entityId, targets);
        if (delResp && delResp.jobId) {
          const djob = delResp.chunked ? await driveJob(delResp.jobId) : await getJob(delResp.jobId);
          const delMs = Date.now() - t2;
          const dfull = await getJob(delResp.jobId);
          rep.phases.delete = {
            ms: delMs, jobId: delResp.jobId,
            successCount: dfull.successCount, errorCount: dfull.errorCount, totalRows: dfull.totalRows,
          };
        } else {
          rep.phases.delete = { error: "commit failed", delResp };
        }
      }
    } else if (spec.full !== false) {
      rep.phases.delete = { deferred: true };
    }

    rep.ok = true;
  } catch (e) {
    rep.ok = false;
    rep.error = String(e && e.stack || e);
  }
  return rep;
}

window.__runLoadTest = async function (n) {
  const ctx = { deferDelete: new Set(["invoice", "bill"]) };
  for (const entityId of ORDER) {
    await runEntity(entityId, n, ctx);
    window.__loadTest.lastCompleted = entityId;
  }
  // Now clean up invoice/bill (deferred delete)
  for (const entityId of ["invoice", "bill"]) {
    const rep = window.__loadTest.entities[entityId];
    const ids = entityId === "invoice" ? ctx.invoiceIds : ctx.billIds;
    if (!ids || !ids.length) continue;
    const dl = await downloadCsv(entityId);
    const idSet = new Set(ids.map(String));
    const seenIds = new Set();
    const targets = [];
    for (const r of dl.rows) {
      if (!idSet.has(String(r["Id"])) || seenIds.has(r["Id"])) continue;
      seenIds.add(r["Id"]);
      targets.push({ id: r["Id"], syncToken: r["SyncToken"] });
    }
    if (targets.length) {
      const t2 = Date.now();
      const { data: delResp } = await deleteRecords(entityId, targets);
      if (delResp && delResp.jobId) {
        await (delResp.chunked ? driveJob(delResp.jobId) : getJob(delResp.jobId));
        const delMs = Date.now() - t2;
        const dfull = await getJob(delResp.jobId);
        rep.phases.delete = { ms: delMs, jobId: delResp.jobId, successCount: dfull.successCount, errorCount: dfull.errorCount, totalRows: dfull.totalRows };
      }
    }
  }
  window.__loadTest.status = "done";
  window.__loadTest.finishedAt = Date.now();
};
