// NOT part of the app — phase 2 of the browser-console load-test harness
// (see load-test-harness.browser.js for phase 1). Covers the entities not
// yet tested at scale, re-verifies the ones that failed due to the qboBatch
// casing bug (now fixed), and verifies the "download failed rows" feature
// by seeding exactly one intentionally-invalid row per entity.
//
// Per user instruction: import freely, no delete phase needed.

const TODAY = "2026-09-05";
const pad = (n, w = 5) => String(n).padStart(w, "0");

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

async function getJob(jobId) {
  return fetch(`/api/batch/jobs/${jobId}?debugErrors=1`).then((r) => r.json());
}

/** Poll (never nudge — these are legacy Inngest-driven jobs) until done. */
async function pollUntilDone(jobId, maxWaitMs = 20 * 60 * 1000) {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    const j = await getJob(jobId);
    if (j.status === "done" || j.status === "failed") return j;
    await new Promise((r) => setTimeout(r, 4000));
  }
  return { status: "timeout" };
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

async function checkFailedRows(jobId) {
  const res = await fetch(`/api/batch/jobs/${jobId}/failed-rows`);
  if (res.status !== 200) return { ok: false, status: res.status, body: await res.text() };
  const buf = await res.arrayBuffer();
  return { ok: true, status: 200, bytes: buf.byteLength };
}

const SPECS = {
  creditmemo: {
    row: (i) => ({ "Credit Memo No": `CLDCM${pad(i)}`, "Customer": i === 500 ? "NONEXISTENT CUSTOMER XYZ" : "Customer A", "Credit Memo Date": TODAY, "Product/Service": "Claude Test Item", "Product/Service Quantity": "1", "Product/Service Rate": "10", "Memo": "Claude load test 2" }),
    edit: (r) => ({ ...r, "Memo": "Claude load test 2 EDITED" }),
  },
  salesreceipt: {
    row: (i) => ({ "Sales Receipt No": `CLDSR${pad(i)}`, "Customer": i === 500 ? "NONEXISTENT CUSTOMER XYZ" : "Customer A", "Sales Receipt Date": TODAY, "Deposit To": "Claude Test Bank", "Product/Service": "Claude Test Item", "Product/Service Quantity": "1", "Product/Service Rate": "10", "Memo": "Claude load test 2" }),
    edit: (r) => ({ ...r, "Memo": "Claude load test 2 EDITED" }),
  },
  refundreceipt: {
    row: (i) => ({ "Refund Receipt No": `CLDRR${pad(i)}`, "Customer": i === 500 ? "NONEXISTENT CUSTOMER XYZ" : "Customer A", "Refund Receipt date": TODAY, "Refunded From": "Claude Test Bank", "Product/Service": "Claude Test Item", "Product/Service Quantity": "1", "Product/Service Rate": "10", "Memo": "Claude load test 2" }),
    edit: (r) => ({ ...r, "Memo": "Claude load test 2 EDITED" }),
  },
  purchaseorder: {
    row: (i) => ({ "PO No": `CLDPO${pad(i)}`, "Vendor": i === 500 ? "NONEXISTENT VENDOR XYZ" : "Claude Test Vendor", "Purchase Order Date": TODAY, "Expense Account ": "Advertising & marketing", "Expense Line Amount": "10", "Memo": "Claude load test 2" }),
    edit: (r) => ({ ...r, "Memo": "Claude load test 2 EDITED" }),
  },
  vendorcredit: {
    row: (i) => ({ "Ref No": `CLDVC${pad(i)}`, "Vendor": i === 500 ? "NONEXISTENT VENDOR XYZ" : "Claude Test Vendor", "Payment Date": TODAY, "Expense Account ": "Advertising & marketing", "Expense Line Amount": "10", "Memo": "Claude load test 2" }),
    edit: (r) => ({ ...r, "Memo": "Claude load test 2 EDITED" }),
  },
  creditcardcredit: {
    row: (i) => ({ "Ref No": `CLDCC${pad(i)}`, "Account": "Claude Test Credit Card", "Payee": i === 500 ? "NONEXISTENT VENDOR XYZ" : "Claude Test Vendor", "Payment Date": TODAY, "Expense Account ": "Advertising & marketing", "Expense Line Amount": "10", "Memo": "Claude load test 2" }),
    edit: (r) => ({ ...r, "Memo": "Claude load test 2 EDITED" }),
  },
  journalentry: {
    rowsPerDoc: 2,
    rows: (i) => [
      { "Journal No": `CLDJ2${pad(i)}`, "Journal Date": TODAY, "Account": i === 500 ? "NONEXISTENT ACCOUNT XYZ" : "Accounts receivable (A/R)", "Amount": "10", "Name": "Customer A", "Memo": "Claude load test 2" },
      { "Journal No": `CLDJ2${pad(i)}`, "Journal Date": TODAY, "Account": "Cash", "Amount": "-10", "Memo": "Claude load test 2" },
    ],
    edit: (rs) => rs.map((r) => ({ ...r, "Memo": "Claude load test 2 EDITED" })),
  },
  deposit: {
    row: (i) => ({ "Deposit No": `CLDDEP${pad(i)}`, "Date": TODAY, "Deposit To Account": i === 500 ? "NONEXISTENT ACCOUNT XYZ" : "Cash", "Line Account": "Sales", "Line Amount": "10", "Memo": "Claude load test 2" }),
    edit: (r) => ({ ...r, "Memo": "Claude load test 2 EDITED" }),
  },
  transfer: {
    noDocKey: true,
    row: (i) => ({ "Transfer Funds From": i === 500 ? "NONEXISTENT ACCOUNT XYZ" : "Cash", "Transfer Funds To": "Claude Test Bank", "Transfer Amount": "10", "Date": TODAY, "Memo": `Claude load test 2 ${i}` }),
    edit: (r) => ({ ...r, "Memo": r["Memo"] + " EDITED" }),
  },
  timeactivity: {
    noDocKey: true,
    row: (i) => ({ "Name": i === 500 ? "NONEXISTENT EMPLOYEE XYZ" : "Claude TestEmployee", "Date": TODAY, "Hours": "1", "Customer": "Customer A", "Service": "Claude Test Item", "Description": `Claude load test 2 ${i}` }),
    edit: (r) => ({ ...r, "Description": r["Description"] + " EDITED" }),
  },
  customer: {
    noDocKey: true,
    row: (i) => (i === 500 ? { "Display Name As": "" } : { "Display Name As": `Claude Test Customer2 ${pad(i)}` }),
    edit: (r) => ({ ...r, "Notes": "Claude load test 2 EDITED" }),
  },
  vendor: {
    noDocKey: true,
    row: (i) => (i === 500 ? { "Display Name As": "" } : { "Display Name As": `Claude Test Vendor2 ${pad(i)}` }),
    edit: (r) => ({ ...r, "Notes": "Claude load test 2 EDITED" }),
  },
  item: {
    noDocKey: true,
    row: (i) => ({ "Name": `Claude Test Item2 ${pad(i)}`, "Type": "Service", "Income Account ": i === 500 ? "NONEXISTENT ACCOUNT XYZ" : "Sales" }),
    edit: (r) => ({ ...r, "Sales Description": "Claude load test 2 EDITED" }),
  },
  account: {
    noDocKey: true,
    row: (i) => ({ "Name": `Claude Test Account2 ${pad(i)}`, "Account Type": i === 500 ? "NotARealAccountType" : "Expense", "Account Subtype": i === 500 ? "NotARealSubtype" : "AdvertisingPromotional" }),
    edit: (r) => ({ ...r, "Description": "Claude load test 2 EDITED" }),
  },
  class: {
    noDocKey: true,
    row: (i) => (i === 500 ? { "Name": "" } : { "Name": `Claude Test Class2 ${pad(i)}` }),
    edit: (r) => ({ ...r }),
  },
  department: {
    noDocKey: true,
    row: (i) => (i === 500 ? { "Name": "" } : { "Name": `Claude Test Location2 ${pad(i)}` }),
    edit: (r) => ({ ...r }),
  },
  employee: {
    noDocKey: true,
    row: (i) => (i === 500 ? { "Display Name As": "", "First Name": "" } : { "Display Name As": `Claude Test Employee2 ${pad(i)}`, "First Name": "Claude", "Last Name": `Employee2${pad(i)}` }),
    edit: (r) => ({ ...r, "Email": "claude-test2@example.com" }),
  },
};

const ORDER = [
  "creditmemo", "salesreceipt", "refundreceipt", "purchaseorder", "vendorcredit", "creditcardcredit",
  "journalentry", "deposit", "transfer", "timeactivity",
  "customer", "vendor", "item", "account", "class", "department", "employee",
];

window.__phase2 = { status: "running", startedAt: Date.now(), entities: {} };

async function runEntity(entityId, n) {
  const spec = SPECS[entityId];
  const rep = { entity: entityId, n, phases: {} };
  window.__phase2.entities[entityId] = rep;

  try {
    let rows = [];
    if (spec.rowsPerDoc === 2) {
      for (let i = 1; i <= n; i++) rows.push(...spec.rows(i));
    } else {
      for (let i = 1; i <= n; i++) rows.push(spec.row(i));
    }

    const t0 = Date.now();
    const { data: createResp } = await commit(entityId, "upload", rows, `claude-p2-${entityId}.csv`);
    if (!createResp || !createResp.jobId) { rep.phases.create = { error: "commit failed", createResp }; return rep; }
    const full = createResp.background ? await pollUntilDone(createResp.jobId) : await getJob(createResp.jobId);
    const createMs = Date.now() - t0;
    rep.phases.create = {
      ms: createMs, jobId: createResp.jobId, background: createResp.background, status: full.status,
      successCount: full.successCount, errorCount: full.errorCount, totalRows: full.totalRows,
    };

    // Verify the failed-rows download feature: expect exactly the 1 seeded bad row.
    if ((full.errorCount ?? 0) > 0) {
      rep.phases.failedRowsCheck = await checkFailedRows(createResp.jobId);
    }

    const dl = await downloadCsv(entityId);
    rep.phases.download = { ms: dl.ms, rowCount: dl.rows.length };

    // Identify our rows by the marker Memo/Description/Name prefix used above.
    const isOurs = (r) => {
      const memo = r["Memo"] || r["Description"] || "";
      const name = r["Display Name As"] || r["Name"] || "";
      return memo.includes("Claude load test 2") || name.includes("Claude Test") && name.includes("2 ");
    };
    const ourRows = dl.rows.filter(isOurs);

    if (ourRows.length > 0 && spec.edit) {
      let modRows;
      if (spec.rowsPerDoc === 2) {
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
      const { data: modResp } = await commit(entityId, "modify", modRows, `claude-p2-${entityId}-edit.csv`);
      if (modResp && modResp.jobId) {
        const mfull = modResp.background ? await pollUntilDone(modResp.jobId) : await getJob(modResp.jobId);
        rep.phases.modify = {
          ms: Date.now() - t1, jobId: modResp.jobId, background: modResp.background, status: mfull.status,
          successCount: mfull.successCount, errorCount: mfull.errorCount, totalRows: mfull.totalRows,
        };
      } else {
        rep.phases.modify = { error: "commit failed", modResp };
      }
    }

    rep.ok = true;
  } catch (e) {
    rep.ok = false;
    rep.error = String((e && e.stack) || e);
  }
  return rep;
}

window.__runPhase2 = async function (n) {
  for (const entityId of ORDER) {
    await runEntity(entityId, n);
    window.__phase2.lastCompleted = entityId;
  }
  window.__phase2.status = "done";
  window.__phase2.finishedAt = Date.now();
};
