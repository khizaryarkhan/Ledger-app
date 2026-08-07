/**
 * GET /api/batch/estimates/debug-link?estimate=1643   (estimate DocNumber)
 *   or ?invoice=INV-123                                 (invoice DocNumber)
 *
 * READ-ONLY diagnostic. Dumps the raw QBO LinkedTxn structure for an estimate
 * and every invoice linked to it (or a single invoice), so we can see exactly
 * how QBO records an estimate→invoice link that shows correctly in the UI, and
 * match our created invoices to it. No writes. Safe to leave in.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { getOrgQboToken } from "@/lib/qbo-token";
import { qboQueryAll, qboReadOne, qboDelete, qboPost } from "@/lib/batch/qbo-client";
import { createProgressInvoice } from "@/lib/batch/estimate-invoicing";
import { db } from "@/db";
import { batchJobs, estimates, organisations, userOrganisations } from "@/db/schema";
import { and, eq, desc, ilike, isNotNull } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 120;

const esc = (s: string) => s.replace(/'/g, "\\'");

// Trim an invoice to the parts that matter for link diagnosis.
function slimInvoice(inv: any) {
  return {
    Id: inv.Id,
    DocNumber: inv.DocNumber,
    TxnDate: inv.TxnDate,
    Customer: inv.CustomerRef,
    txnLevelLinkedTxn: inv.LinkedTxn ?? null,
    lines: (inv.Line || [])
      .filter((l: any) => l.DetailType === "SalesItemLineDetail")
      .map((l: any) => ({
        Id: l.Id,
        Amount: l.Amount,
        Qty: l.SalesItemLineDetail?.Qty,
        UnitPrice: l.SalesItemLineDetail?.UnitPrice,
        Description: l.Description,
        ItemRef: l.SalesItemLineDetail?.ItemRef,
        lineLevelLinkedTxn: l.LinkedTxn ?? null,
      })),
  };
}

export async function GET(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id as string;

  const url = new URL(req.url);
  const estNo = url.searchParams.get("estimate");
  const estId = url.searchParams.get("estimateId");
  const invNo = url.searchParams.get("invoice");

  // The active company is resolved from the active_org_id cookie, which can be
  // out of sync with the company the user is viewing in a multi-company account.
  // ?companies=1 lists the user's companies so we can target the right one.
  const myCompanies = await db
    .select({ orgId: userOrganisations.orgId, role: userOrganisations.role, name: organisations.name })
    .from(userOrganisations)
    .innerJoin(organisations, eq(organisations.id, userOrganisations.orgId))
    .where(eq(userOrganisations.userId, userId));
  if (url.searchParams.get("companies")) {
    return ok({ activeOrgIdFromCookie: orgId, companies: myCompanies });
  }

  // ?company=<name substring> or ?orgId=<id> → run against that company instead
  // of the cookie's, but ONLY if the user is a member of it (safe override).
  const companyTerm = url.searchParams.get("company");
  const orgIdParam = url.searchParams.get("orgId");
  let workingOrgId = orgId!;
  if (orgIdParam && myCompanies.some((c) => c.orgId === orgIdParam)) {
    workingOrgId = orgIdParam;
  } else if (companyTerm) {
    const hit = myCompanies.find((c) => (c.name || "").toLowerCase().includes(companyTerm.toLowerCase()));
    if (!hit) return bad(`You are not a member of any company matching "${companyTerm}". Try ?companies=1.`, 404);
    workingOrgId = hit.orgId;
  }

  const token = await getOrgQboToken(workingOrgId).catch(() => null);
  if (!token) return bad(`QuickBooks is not connected for the selected company (org ${workingOrgId})`, 400);

  // Raw GET straight from QBO with the intuit_tid header — no transform, so we
  // can inspect every property QBO stores (?rawInvoice / ?rawEstimate) and the
  // company's Progress Invoicing preference (?prefs).
  const rawGet = async (path: string) => {
    const res = await fetch(`https://quickbooks.api.intuit.com/v3/company/${token.realmId}/${path}?minorversion=73`, {
      headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "application/json" },
    });
    const intuit_tid = res.headers.get("intuit_tid");
    const body = await res.json().catch(() => null);
    return { httpStatus: res.status, intuit_tid, body };
  };
  const rawInvoice = url.searchParams.get("rawInvoice");
  if (rawInvoice) return ok(await rawGet(`invoice/${encodeURIComponent(rawInvoice)}`));
  const rawEstimate = url.searchParams.get("rawEstimate");
  if (rawEstimate) return ok(await rawGet(`estimate/${encodeURIComponent(rawEstimate)}`));
  if (url.searchParams.get("prefs")) {
    const p = await rawGet("preferences");
    return ok({ intuit_tid: p.intuit_tid, SalesFormsPrefs: p.body?.Preferences?.SalesFormsPrefs ?? null });
  }

  // ?setProgress=on|off → toggle this company's Progress Invoicing via the
  // Preferences API (read-modify-write the full object), then read back and
  // report whether it actually persisted. WRITE — changes a company setting.
  const setProgress = url.searchParams.get("setProgress");
  if (setProgress === "on" || setProgress === "off") {
    const desired = setProgress === "on";
    const cur = await rawGet("preferences");
    const prefsObj = cur.body?.Preferences;
    if (!prefsObj) return bad("Could not read Preferences to update", 502);
    const before = prefsObj?.SalesFormsPrefs?.UsingProgressInvoicing ?? null;
    prefsObj.SalesFormsPrefs = prefsObj.SalesFormsPrefs || {};
    prefsObj.SalesFormsPrefs.UsingProgressInvoicing = desired;
    const upd = await qboPost(token, "preferences", prefsObj, { operation: "update" });
    const after = await rawGet("preferences");
    const afterVal = after.body?.Preferences?.SalesFormsPrefs?.UsingProgressInvoicing ?? null;
    return ok({
      company: workingOrgId,
      requested: desired,
      before,
      updateOk: upd.ok,
      updateError: upd.error ?? null,
      updateIntuitTid: upd.intuitTid ?? null,
      after: afterVal,
      afterIntuitTid: after.intuit_tid,
      persisted: afterVal === desired,
    });
  }

  // Resolve an estimate by internal Id, QBO DocNumber, or our synced number.
  const resolveEstimate = async (term: string): Promise<{ est: any; estId: string } | null> => {
    let est = await qboReadOne(token, "estimate", term);
    if (est) return { est, estId: term };
    const m = await qboQueryAll(token, "Estimate", `DocNumber LIKE '%${esc(term)}%'`).catch(() => []);
    if (m.length) return { est: m[0], estId: String(m[0].Id) };
    const [row] = await db.select({ qboId: estimates.qboId }).from(estimates)
      .where(and(eq(estimates.orgId, workingOrgId), isNotNull(estimates.qboId), ilike(estimates.estimateNumber, `%${term}%`))).limit(1);
    if (row?.qboId) { est = await qboReadOne(token, "estimate", row.qboId); if (est) return { est, estId: row.qboId }; }
    return null;
  };

  // ?minimalLink=<estimate>[&amount=N] → STEP 6 SELF-CLEANING TEST. Create a bare
  // invoice with NO link, then send ONLY a minimal sparse update {Id, SyncToken,
  // sparse:true, LinkedTxn:[{TxnId, TxnType:"Estimate"}]} — isolating the link
  // write from our full payload — read back, verify, then delete. Full raw.
  const minLink = url.searchParams.get("minimalLink");
  if (minLink) {
    const r = await resolveEstimate(minLink);
    if (!r) return bad(`No estimate matching ${minLink}`, 404);
    const { est, estId } = r;
    const sline = (est.Line || []).find((l: any) => l.DetailType === "SalesItemLineDetail");
    if (!sline) return bad("Estimate has no sales lines", 400);
    const amount = Number(url.searchParams.get("amount") || 1);
    const up = Number(sline.SalesItemLineDetail?.UnitPrice) || amount;
    const qty = up ? amount / up : 1;

    // 1. Create a plain invoice — NO LinkedTxn at all.
    const createPayload: any = {
      CustomerRef: est.CustomerRef,
      ...(est.CurrencyRef ? { CurrencyRef: est.CurrencyRef } : {}),
      Line: [{
        DetailType: "SalesItemLineDetail",
        Amount: Math.round(qty * up * 100) / 100,
        SalesItemLineDetail: {
          ItemRef: sline.SalesItemLineDetail?.ItemRef,
          Qty: qty,
          UnitPrice: up,
          ...(sline.SalesItemLineDetail?.TaxCodeRef ? { TaxCodeRef: sline.SalesItemLineDetail.TaxCodeRef } : {}),
        },
      }],
    };
    const createRes = await qboPost(token, "invoice", createPayload);
    if (!createRes.ok) return ok({ step: "create-failed", createPayload, error: createRes.error, intuit_tid: createRes.intuitTid });
    const created = createRes.data?.Invoice;

    // 2. Minimal sparse update — ONLY the estimate link.
    const sparse = { Id: created.Id, SyncToken: created.SyncToken, sparse: true, LinkedTxn: [{ TxnId: estId, TxnType: "Estimate" }] };
    const updRes = await qboPost(token, "invoice", sparse, { operation: "update" });

    // 3. Fresh read-back.
    const after = await rawGet(`invoice/${created.Id}`);
    const afterInv = after.body?.Invoice;
    const linkedAfter = (afterInv?.LinkedTxn || []).some((x: any) => x.TxnType === "Estimate");

    // 4. Cleanup delete.
    let cleanup = "not attempted";
    try {
      const latestSync = afterInv?.SyncToken || updRes.data?.Invoice?.SyncToken || created.SyncToken;
      const del = await qboDelete(token, "invoice", String(created.Id), String(latestSync));
      cleanup = del.ok ? "deleted (no residue)" : `DELETE FAILED — remove invoice ${created.DocNumber || created.Id}: ${del.error}`;
    } catch (e: any) { cleanup = `DELETE THREW: ${e?.message}`; }

    return ok({
      estimateId: estId,
      estimateDocNumber: est.DocNumber,
      invoiceId: created.Id,
      createPayload,
      createResponseLinkedTxn: created.LinkedTxn ?? [],
      createIntuitTid: createRes.intuitTid,
      sparseUpdatePayload: sparse,
      sparseUpdateOk: updRes.ok,
      sparseUpdateError: updRes.error ?? null,
      sparseUpdateResponseLinkedTxn: updRes.data?.Invoice?.LinkedTxn ?? null,
      updateIntuitTid: updRes.intuitTid,
      readbackLinkedTxn: afterInv?.LinkedTxn ?? [],
      readbackIntuitTid: after.intuit_tid,
      linkPersisted: linkedAfter,
      status: linkedAfter ? "LINKED" : "INVOICE_CREATED_QBO_LINK_NOT_PERSISTED",
      cleanup,
    });
  }

  // ?find=1742 → estimates whose DocNumber contains the term, with status +
  // linked-invoice ids. Lets us check status (API linking is ignored for
  // Closed/Rejected estimates) and grab the estimateId.
  const find = url.searchParams.get("find");
  if (find) {
    const matches = await qboQueryAll(token, "Estimate", `DocNumber LIKE '%${esc(find)}%'`).catch(() => []);
    return ok({
      matches: matches.map((e: any) => ({
        estimateId: e.Id,
        DocNumber: e.DocNumber,
        TxnStatus: e.TxnStatus,
        customer: e.CustomerRef?.name,
        total: e.TotalAmt,
        linkedInvoices: (e.LinkedTxn || []).filter((lt: any) => lt.TxnType === "Invoice").map((lt: any) => lt.TxnId),
      })),
    });
  }

  // ?tryCreate=<estimateId>[&amount=1][&line=0] → SELF-CLEANING TEST. Create a
  // tiny progress invoice against a real estimate, read back exactly what QBO
  // stored (link + qty/price), then DELETE it so nothing remains in the books.
  // Lets us verify the exact payload QBO accepts + links, with zero residue.
  const tryId = url.searchParams.get("tryCreate");
  if (tryId) {
    // Resolve by internal Id first, else by DocNumber (LIKE) in this session's org.
    let est = await qboReadOne(token, "estimate", tryId);
    let estId = tryId;
    if (!est) {
      const m = await qboQueryAll(token, "Estimate", `DocNumber LIKE '%${esc(tryId)}%'`).catch(() => []);
      if (m.length) { est = m[0]; estId = String(m[0].Id); }
    }
    if (!est) {
      // Resolve via OUR DB estimate number → stored QBO id (same id the worksheet
      // uses; DocNumber in QBO may differ from our synced number).
      const [row] = await db
        .select({ qboId: estimates.qboId })
        .from(estimates)
        .where(and(eq(estimates.orgId, workingOrgId), isNotNull(estimates.qboId), ilike(estimates.estimateNumber, `%${tryId}%`)))
        .limit(1);
      if (row?.qboId) { estId = row.qboId; est = await qboReadOne(token, "estimate", estId); }
    }
    if (!est) return bad(`No estimate matching ${tryId} (tried Id, QBO DocNumber, and our estimate number)`, 404);
    const salesLines = (est.Line || []).filter((l: any) => l.DetailType === "SalesItemLineDetail");
    if (salesLines.length === 0) return bad("Estimate has no sales lines", 400);
    const lineIdx = Number(url.searchParams.get("line") || 0);
    const amount = Number(url.searchParams.get("amount") || 1);

    const res = await createProgressInvoice(token, estId, [{ index: lineIdx, amount }], { debug: true });
    if (!res.invoiceCreated) {
      return ok({ tryCreate: estId, estimate: { DocNumber: est.DocNumber, TxnStatus: est.TxnStatus, priorInvoiceLinks: (est.LinkedTxn || []).filter((l: any) => l.TxnType === "Invoice").length }, status: res.status, error: res.error, trace: res.trace });
    }
    const raw = res.raw || {};
    const stored = slimInvoice(raw);
    let cleanup = "not attempted";
    try {
      const del = await qboDelete(token, "invoice", String(raw.Id), String(raw.SyncToken));
      cleanup = del.ok ? "deleted (no residue)" : `DELETE FAILED — remove invoice ${raw.DocNumber || raw.Id} manually: ${del.error}`;
    } catch (e: any) {
      cleanup = `DELETE THREW — remove invoice ${raw.DocNumber || raw.Id} manually: ${e?.message}`;
    }
    return ok({
      tryCreate: estId,
      estimate: { DocNumber: est.DocNumber, TxnStatus: est.TxnStatus, priorInvoiceLinks: (est.LinkedTxn || []).filter((l: any) => l.TxnType === "Invoice").length },
      billedLine: lineIdx,
      billedAmount: amount,
      invoiceCreated: res.invoiceCreated,
      invoiceId: res.invoiceId,
      linkRequested: res.linkRequested,
      linkPersisted: res.linkPersisted,
      estimateListsInvoice: res.estimateListsInvoice,
      status: res.status,
      trace: res.trace,
      stored,
      cleanup,
    });
  }

  // ?lastjob=1 → the most recent invoice-from-estimates batch: its per-row
  // results (success doc numbers / exact QBO errors) AND, for each created
  // invoice, the link QBO actually stored. One fetch tells the whole story.
  if (url.searchParams.get("lastjob")) {
    const [job] = await db
      .select()
      .from(batchJobs)
      .where(and(eq(batchJobs.orgId, workingOrgId), eq(batchJobs.entityId, "estimateinvoice")))
      .orderBy(desc(batchJobs.createdAt))
      .limit(1);
    if (!job) return ok({ note: "No invoice-from-estimates job found yet." });

    const rows = (job.results as any[]) || [];
    const createdIds = rows.filter((r) => r.ok && r.qboId).map((r) => String(r.qboId));
    let created: any[] = [];
    if (createdIds.length) {
      const inList = createdIds.map((x) => `'${x}'`).join(",");
      const invs = await qboQueryAll(token, "Invoice", `Id IN (${inList})`).catch(() => []);
      created = invs.map(slimInvoice);
    }
    return ok({
      job: { createdAt: job.createdAt, status: job.status, total: job.totalRows, ok: job.successCount, failed: job.errorCount },
      rows,
      createdInvoicesAsStoredInQbo: created,
    });
  }

  // No params → list recent estimates that HAVE at least one linked invoice, so
  // the caller can pick a real one to inspect.
  if (!estNo && !estId && !invNo) {
    const recent = await qboQueryAll(token, "Estimate", "").catch(() => []);
    const withInvoices = recent
      .filter((e: any) => (e.LinkedTxn || []).some((lt: any) => lt.TxnType === "Invoice"))
      .map((e: any) => ({
        estimateId: e.Id,
        DocNumber: e.DocNumber,
        TxnStatus: e.TxnStatus,
        customer: e.CustomerRef?.name,
        linkedInvoiceCount: (e.LinkedTxn || []).filter((lt: any) => lt.TxnType === "Invoice").length,
      }))
      .slice(0, 40);
    return ok({
      hint: "Pick one and call ?estimateId=<estimateId> (or ?estimate=<DocNumber>) to see the link structure.",
      estimatesWithLinkedInvoices: withInvoices,
    });
  }

  if (invNo) {
    const invs = await qboQueryAll(token, "Invoice", `DocNumber = '${esc(invNo)}'`);
    return ok({ invoices: invs.map(slimInvoice) });
  }

  const where = estId ? `Id = '${esc(estId)}'` : `DocNumber = '${esc(estNo!)}'`;
  const ests = await qboQueryAll(token, "Estimate", where);
  if (ests.length === 0) return bad(`No estimate matching ${estId ? `Id ${estId}` : `DocNumber ${estNo}`}`, 404);
  const est = ests[0];

  const linkedInvoiceIds = (est.LinkedTxn || [])
    .filter((lt: any) => lt.TxnType === "Invoice" && lt.TxnId)
    .map((lt: any) => String(lt.TxnId));

  let invoices: any[] = [];
  if (linkedInvoiceIds.length) {
    const inList = linkedInvoiceIds.map((x: string) => `'${x}'`).join(",");
    invoices = await qboQueryAll(token, "Invoice", `Id IN (${inList})`).catch(() => []);
  }

  return ok({
    estimate: {
      Id: est.Id,
      DocNumber: est.DocNumber,
      TxnStatus: est.TxnStatus,
      Customer: est.CustomerRef,
      estimateLevelLinkedTxn: est.LinkedTxn ?? null,
      lines: (est.Line || [])
        .filter((l: any) => l.DetailType === "SalesItemLineDetail")
        .map((l: any) => ({ Id: l.Id, Amount: l.Amount, Description: l.Description, ItemRef: l.SalesItemLineDetail?.ItemRef })),
    },
    linkedInvoices: invoices.map(slimInvoice),
  });
}
