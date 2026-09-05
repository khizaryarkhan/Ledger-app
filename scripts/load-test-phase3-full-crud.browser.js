// NOT part of the app — phase 3 of the browser-console load-test harness.
// Full CRUD cycle (create/download/modify/delete where supported) at 500
// records per entity, for every entity not yet stress-tested at that scale
// AFTER all of this week's fixes landed together. Runs entities one at a
// time with a cooldown gap between each (self-inflicted QBO throttling from
// back-to-back rapid-fire tests was a real false-positive source earlier
// this session — see git history around c662a21/qboQueryAll retry fix).

const TODAY = "2026-09-06";
const pad = (n, w = 5) => String(n).padStart(w, "0");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function commitStart(entity, operation, rows, fileName) {
  const mapping = {}; Object.keys(rows[0]).forEach((k) => { mapping[k] = k; });
  const payload = { entity, operation, fileName, mapping, overrides: {}, rawRows: rows };
  const sres = await fetch("/api/batch/upload/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const sdata = await sres.json().catch(() => null);
  if (!sres.ok) return { error: sdata };
  if (sdata.chunked === false) {
    const res = await fetch("/api/batch/upload/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => null);
    if (data && data.jobId) fetch("/api/batch/jobs/" + data.jobId + "/run", { method: "POST" }).catch(() => {});
    return data;
  }
  fetch("/api/batch/upload/chunk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: sdata.jobId }) }).catch(() => {});
  return sdata;
}
async function pollUntilDone(jobId, maxWaitMs = 15 * 60 * 1000) {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    const j = await fetch("/api/batch/jobs/" + jobId + "?debugErrors=1").then((r) => r.json());
    if (j.status === "done" || j.status === "failed") return j;
    await sleep(2500);
  }
  return { status: "timeout" };
}
async function downloadCsv(entity) {
  const t0 = Date.now();
  const res = await fetch("/api/batch/download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity, format: "csv" }) });
  const text = await res.text();
  const ms = Date.now() - t0;
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return { ms, rows: [] };
  const parseLine = (line) => {
    const out = []; let cur = ""; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') inQ = false; else cur += c; }
      else { if (c === '"') inQ = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; }
    }
    out.push(cur); return out;
  };
  const headers = parseLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map((l) => { const cells = parseLine(l); const obj = {}; headers.forEach((h, i) => { obj[h] = cells[i] ?? ""; }); return obj; });
  return { ms, rows };
}
async function checkFailedRows(jobId) {
  const res = await fetch(`/api/batch/jobs/${jobId}/failed-rows`);
  return { ok: res.status === 200, status: res.status };
}
async function deleteRecords(entity, targets) {
  const res = await fetch("/api/batch/delete/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity, targets }) });
  return res.json().catch(() => null);
}

const SPECS = {
  estimate: {
    supportsDelete: true,
    row: (i) => ({ "Estimate No": `CLDF${pad(i)}`, "Customer": i === 500 ? "NONEXISTENT CUSTOMER XYZ" : "Customer A", "Estimate Date": TODAY, "Product/Service": "Claude Test Item", "Product/Service Quantity": "1", "Product/Service Rate": "10" }),
    edit: (r) => ({ ...r, "Memo": "Claude phase3 EDITED" }),
  },
  salesreceipt: {
    supportsDelete: true,
    row: (i) => ({ "Sales Receipt No": `CLDF${pad(i)}`, "Customer": i === 500 ? "NONEXISTENT CUSTOMER XYZ" : "Customer A", "Sales Receipt Date": TODAY, "Deposit To": "Claude Test Bank", "Product/Service": "Claude Test Item", "Product/Service Quantity": "1", "Product/Service Rate": "10" }),
    edit: (r) => ({ ...r, "Memo": "Claude phase3 EDITED" }),
  },
  refundreceipt: {
    supportsDelete: true,
    row: (i) => ({ "Refund Receipt No": `CLDF${pad(i)}`, "Customer": i === 500 ? "NONEXISTENT CUSTOMER XYZ" : "Customer A", "Refund Receipt date": TODAY, "Refunded From": "Claude Test Bank", "Product/Service": "Claude Test Item", "Product/Service Quantity": "1", "Product/Service Rate": "10" }),
    edit: (r) => ({ ...r, "Memo": "Claude phase3 EDITED" }),
  },
  purchaseorder: {
    supportsDelete: true,
    row: (i) => ({ "PO No": `CLDF${pad(i)}`, "Vendor": i === 500 ? "NONEXISTENT VENDOR XYZ" : "Claude Test Vendor", "Purchase Order Date": TODAY, "Expense Account ": "Advertising & marketing", "Expense Line Amount": "10" }),
    edit: (r) => ({ ...r, "Memo": "Claude phase3 EDITED" }),
  },
  vendorcredit: {
    supportsDelete: true,
    row: (i) => ({ "Ref No": `CLDF${pad(i)}`, "Vendor": i === 500 ? "NONEXISTENT VENDOR XYZ" : "Claude Test Vendor", "Payment Date": TODAY, "Expense Account ": "Advertising & marketing", "Expense Line Amount": "10" }),
    edit: (r) => ({ ...r, "Memo": "Claude phase3 EDITED" }),
  },
  check: {
    supportsDelete: true,
    row: (i) => ({ "Check no": `CLDF${pad(i)}`, "Bank Account ": "Cash", "Payee": i === 500 ? "NONEXISTENT VENDOR XYZ" : "Claude Test Vendor", "Payment Date": TODAY, "Expense Account ": "Advertising & marketing", "Expense Line Amount": "10" }),
    edit: (r) => ({ ...r, "Memo": "Claude phase3 EDITED" }),
  },
  creditcardcredit: {
    supportsDelete: true,
    row: (i) => ({ "Ref No": `CLDF${pad(i)}`, "Account": "Claude Test Credit Card", "Payee": "Claude Test Vendor", "Payment Date": TODAY, "Expense Account ": i === 500 ? "NONEXISTENT ACCOUNT XYZ" : "Advertising & marketing", "Expense Line Amount": "10" }),
    edit: (r) => ({ ...r, "Memo": "Claude phase3 EDITED" }),
  },
  journalentry: {
    supportsDelete: true, rowsPerDoc: 2,
    rows: (i) => [
      { "Journal No": `CLDF${pad(i)}`, "Journal Date": TODAY, "Account": i === 500 ? "NONEXISTENT ACCOUNT XYZ" : "Accounts receivable (A/R)", "Amount": "10", "Name": "Customer A" },
      { "Journal No": `CLDF${pad(i)}`, "Journal Date": TODAY, "Account": "Cash", "Amount": "-10" },
    ],
    edit: (rs) => rs.map((r) => ({ ...r, "Memo": "Claude phase3 EDITED" })),
  },
  deposit: {
    supportsDelete: true,
    row: (i) => ({ "Deposit No": `CLDF${pad(i)}`, "Date": TODAY, "Deposit To Account": i === 500 ? "NONEXISTENT ACCOUNT XYZ" : "Cash", "Line Account": "Sales", "Line Amount": "10" }),
    edit: (r) => ({ ...r, "Memo": "Claude phase3 EDITED" }),
  },
  transfer: {
    supportsDelete: true,
    row: (i) => ({ "Transfer Funds From": i === 500 ? "NONEXISTENT ACCOUNT XYZ" : "Cash", "Transfer Funds To": "Claude Test Bank", "Transfer Amount": "10", "Date": TODAY, "Memo": `f3-${i}` }),
    edit: (r) => ({ ...r, "Memo": r["Memo"] + " EDITED" }),
  },
  timeactivity: {
    supportsDelete: false,
    row: (i) => ({ "Name": i === 500 ? "NONEXISTENT EMPLOYEE XYZ" : "Claude TestEmployee", "Date": TODAY, "Hours": "1", "Customer": "Customer A", "Service": "Claude Test Item", "Description": `f3-${i}` }),
    edit: (r) => ({ ...r, "Description": r["Description"] + " EDITED" }),
  },
  customer: {
    supportsDelete: false,
    row: (i) => (i === 500 ? { "Display Name As": "" } : { "Display Name As": `Claude F3 Customer ${pad(i)}` }),
    edit: (r) => ({ ...r, "Notes": "Claude phase3 EDITED" }),
  },
  vendor: {
    supportsDelete: false,
    row: (i) => (i === 500 ? { "Display Name As": "" } : { "Display Name As": `Claude F3 Vendor ${pad(i)}` }),
    edit: (r) => ({ ...r, "Notes": "Claude phase3 EDITED" }),
  },
  item: {
    supportsDelete: false,
    row: (i) => ({ "Name": `Claude F3 Item ${pad(i)}`, "Type": "Service", "Income Account ": i === 500 ? "NONEXISTENT ACCOUNT XYZ" : "Sales" }),
    edit: (r) => ({ ...r, "Sales Description": "Claude phase3 EDITED" }),
  },
  account: {
    supportsDelete: false,
    row: (i) => ({ "Name": `Claude F3 Account ${pad(i)}`, "Account Type": i === 500 ? "NotARealAccountType" : "Expense", "Account Subtype": i === 500 ? "NotARealSubtype" : "AdvertisingPromotional" }),
    edit: (r) => ({ ...r, "Description": "Claude phase3 EDITED" }),
  },
  class: {
    supportsDelete: false,
    row: (i) => (i === 500 ? { "Name": "" } : { "Name": `Claude F3 Class ${pad(i)}` }),
    edit: (r) => ({ ...r }),
  },
  department: {
    supportsDelete: false,
    row: (i) => (i === 500 ? { "Name": "" } : { "Name": `Claude F3 Location ${pad(i)}` }),
    edit: (r) => ({ ...r }),
  },
  employee: {
    supportsDelete: false,
    row: (i) => (i === 500 ? { "Display Name As": "", "First Name": "" } : { "Display Name As": `Claude F3 Employee ${pad(i)}`, "First Name": "Claude", "Last Name": `F3${pad(i)}` }),
    edit: (r) => ({ ...r, "Email": "claude-f3@example.com" }),
  },
};

const ORDER = ["estimate", "salesreceipt", "refundreceipt", "purchaseorder", "vendorcredit", "check", "creditcardcredit", "journalentry", "deposit", "transfer", "timeactivity", "customer", "vendor", "item", "account", "class", "department", "employee"];

window.__phase3 = { status: "running", startedAt: Date.now(), entities: {} };

async function runEntity(entityId, n) {
  const spec = SPECS[entityId];
  const rep = { entity: entityId, n, phases: {} };
  window.__phase3.entities[entityId] = rep;
  try {
    let rows = [];
    if (spec.rowsPerDoc === 2) { for (let i = 1; i <= n; i++) rows.push(...spec.rows(i)); }
    else { for (let i = 1; i <= n; i++) rows.push(spec.row(i)); }

    // CREATE
    let t0 = Date.now();
    const createResp = await commitStart(entityId, "upload", rows, `p3-${entityId}.csv`);
    if (!createResp || !createResp.jobId) { rep.phases.create = { error: "start failed", raw: createResp }; return rep; }
    const createJob = await pollUntilDone(createResp.jobId);
    rep.phases.create = { ms: Date.now() - t0, status: createJob.status, s: createJob.successCount, e: createJob.errorCount, total: createJob.totalRows };
    if ((createJob.errorCount ?? 0) > 0) rep.phases.failedRowsCheck = await checkFailedRows(createResp.jobId);
    const createdIds = (createJob.results || []).filter((r) => r.ok).map((r) => r.qboId).filter(Boolean);
    rep.createdCount = createdIds.length;

    // DOWNLOAD
    const dl = await downloadCsv(entityId);
    rep.phases.download = { ms: dl.ms, rowCount: dl.rows.length };
    const idSet = new Set(createdIds.map(String));
    const ourRows = dl.rows.filter((r) => idSet.has(String(r["Id"])));

    // MODIFY
    if (ourRows.length > 0 && spec.edit) {
      let modRows;
      if (spec.rowsPerDoc === 2) {
        const byDoc = new Map();
        for (const r of ourRows) { const k = r["Journal No"]; if (!byDoc.has(k)) byDoc.set(k, []); byDoc.get(k).push(r); }
        modRows = []; for (const group of byDoc.values()) modRows.push(...spec.edit(group));
      } else {
        modRows = ourRows.map((r) => spec.edit(r));
      }
      t0 = Date.now();
      const modResp = await commitStart(entityId, "modify", modRows, `p3-${entityId}-edit.csv`);
      if (modResp && modResp.jobId) {
        const modJob = await pollUntilDone(modResp.jobId);
        rep.phases.modify = { ms: Date.now() - t0, status: modJob.status, s: modJob.successCount, e: modJob.errorCount, total: modJob.totalRows };
      } else {
        rep.phases.modify = { error: "start failed", raw: modResp };
      }
    }

    // DELETE (only where supported)
    if (spec.supportsDelete) {
      const dl2 = await downloadCsv(entityId);
      const seen = new Set();
      const targets = [];
      for (const r of dl2.rows) {
        if (!idSet.has(String(r["Id"])) || seen.has(r["Id"])) continue;
        seen.add(r["Id"]); targets.push({ id: r["Id"], syncToken: r["SyncToken"] });
      }
      if (targets.length) {
        t0 = Date.now();
        const delResp = await deleteRecords(entityId, targets);
        if (delResp && delResp.jobId) {
          const delJob = await pollUntilDone(delResp.jobId);
          rep.phases.delete = { ms: Date.now() - t0, status: delJob.status, s: delJob.successCount, e: delJob.errorCount, total: delJob.totalRows };
        } else {
          rep.phases.delete = { error: "delete-commit failed", raw: delResp };
        }
      }
    } else {
      rep.phases.delete = { skipped: "entity does not support delete" };
    }

    rep.ok = true;
  } catch (e) {
    rep.ok = false;
    rep.error = String((e && e.stack) || e);
  }
  return rep;
}

window.__runPhase3 = async function (n, gapMs) {
  for (const entityId of ORDER) {
    await sleep(gapMs);
    await runEntity(entityId, n);
    window.__phase3.lastCompleted = entityId;
  }
  window.__phase3.status = "done";
  window.__phase3.finishedAt = Date.now();
};
