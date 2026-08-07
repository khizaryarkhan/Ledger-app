/**
 * Estimate → Invoice (progress billing) — shared logic for the interactive UI,
 * the spreadsheet export, and invoice creation.
 *
 * "Already invoiced" per line is computed from the invoices linked to an
 * estimate, matched by ITEM ID (+ normalized description) rather than resolved
 * item name — name matching drifted and produced wrong figures. Single-line
 * estimates attribute the whole linked total to that line (no matching needed).
 */

import type { OrgQboToken } from "@/lib/qbo-token";
import { qboQueryAll, qboReadOne, qboPost, qboQueryTop } from "./qbo-client";
import { RefResolver, refDisplayName } from "./ref-resolver";

const num = (v: any) => (v == null || v === "" ? undefined : Number(v));
const norm = (s: any) => String(s ?? "").trim().toLowerCase();
const round2 = (n: number) => Math.round(n * 100) / 100;
const salesLinesOf = (r: any) => (r.Line || []).filter((l: any) => l.DetailType === "SalesItemLineDetail");
const lineKey = (l: any) => `${l.SalesItemLineDetail?.ItemRef?.value ?? ""}||${norm(l.Description)}`;

/** Fetch all invoices linked to the given estimates, keyed by invoice id. */
export async function fetchLinkedInvoices(token: OrgQboToken, estimates: any[]): Promise<Map<string, any>> {
  const ids = new Set<string>();
  for (const est of estimates)
    for (const lt of est.LinkedTxn || [])
      if (lt.TxnType === "Invoice" && lt.TxnId) ids.add(String(lt.TxnId));

  const byId = new Map<string, any>();
  const all = [...ids];
  for (let i = 0; i < all.length; i += 80) {
    const inList = all.slice(i, i + 80).map((x) => `'${x}'`).join(",");
    const recs = await qboQueryAll(token, "Invoice", `Id IN (${inList})`).catch(() => []);
    for (const r of recs) byId.set(String(r.Id), r);
  }
  return byId;
}

/**
 * Per sales-line already-invoiced amount (index-aligned with salesLinesOf(est)),
 * capped at each line's estimated amount so "remaining" never goes negative.
 */
export function invoicedByLineIndex(est: any, invoiceById: Map<string, any>): number[] {
  const lines = salesLinesOf(est);
  const already = new Array(lines.length).fill(0);

  // Sum linked-invoice line amounts by key.
  const pool = new Map<string, number>();
  let total = 0;
  for (const lt of est.LinkedTxn || []) {
    if (lt.TxnType !== "Invoice") continue;
    const inv = invoiceById.get(String(lt.TxnId));
    if (!inv) continue;
    for (const l of salesLinesOf(inv)) {
      const amt = Number(l.Amount) || 0;
      total += amt;
      const k = lineKey(l);
      pool.set(k, (pool.get(k) ?? 0) + amt);
    }
  }

  // Single-line estimate: attribute the whole linked total (matching not needed).
  if (lines.length === 1) {
    already[0] = round2(Math.min(total, Number(lines[0].Amount) || total));
    return already;
  }

  // Multi-line: attribute per key, capped at each line's estimate, consuming
  // from the pool so lines sharing a key split correctly.
  for (let i = 0; i < lines.length; i++) {
    const estAmt = Number(lines[i].Amount) || 0;
    const k = lineKey(lines[i]);
    const avail = pool.get(k) ?? 0;
    const take = Math.min(avail, estAmt);
    already[i] = round2(take);
    pool.set(k, avail - take);
  }
  return already;
}

export interface OpenEstimateLine {
  index: number; item: string; description: string;
  qty: number | null; rate: number | null; estAmount: number;
  alreadyInvoiced: number; remaining: number;
}
export interface OpenEstimate {
  id: string; number: string; customer: string; date: string; status: string;
  currency: string; total: number; alreadyTotal: number; remainingTotal: number;
  lines: OpenEstimateLine[];
}

/** Estimates (default Accepted) with per-line already-invoiced/remaining, for the UI. */
export async function getOpenEstimates(
  token: OrgQboToken,
  opts: { status?: string; from?: string; to?: string } = {}
): Promise<OpenEstimate[]> {
  const parts: string[] = [];
  if (opts.from) parts.push(`TxnDate >= '${opts.from}'`);
  if (opts.to) parts.push(`TxnDate <= '${opts.to}'`);
  const estimates = await qboQueryAll(token, "Estimate", parts.join(" AND "));

  const status = opts.status ?? "Accepted";
  const filtered = status && status !== "Any" ? estimates.filter((e) => e.TxnStatus === status) : estimates;

  const invoiceById = await fetchLinkedInvoices(token, filtered);
  const resolver = new RefResolver(token);
  await resolver.preload(["Item"]);

  const out: OpenEstimate[] = [];
  for (const est of filtered) {
    const lines = salesLinesOf(est);
    const already = invoicedByLineIndex(est, invoiceById);
    const uiLines: OpenEstimateLine[] = [];
    let alreadyTotal = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const d = l.SalesItemLineDetail || {};
      const estAmount = round2(Number(l.Amount) || 0);
      const inv = already[i] ?? 0;
      alreadyTotal += inv;
      uiLines.push({
        index: i,
        item: (await refDisplayName(d.ItemRef, "Item", resolver)) ?? "",
        description: l.Description ?? "",
        qty: d.Qty ?? null,
        rate: d.UnitPrice ?? null,
        estAmount,
        alreadyInvoiced: inv,
        remaining: round2(estAmount - inv),
      });
    }
    const total = round2(Number(est.TotalAmt) || uiLines.reduce((s, l) => s + l.estAmount, 0));
    out.push({
      id: est.Id, number: est.DocNumber ?? "", customer: est.CustomerRef?.name ?? "",
      date: est.TxnDate ?? "", status: est.TxnStatus ?? "", currency: est.CurrencyRef?.value ?? "",
      total, alreadyTotal: round2(alreadyTotal), remainingTotal: round2(total - alreadyTotal),
      lines: uiLines,
    });
  }
  return out;
}

export interface InvoiceNumberSeed { prefix: string; num: number; width: number; }

/**
 * Seed for auto-numbering invoices when QBO "Custom transaction numbers" is ON
 * (the API does NOT auto-fill DocNumber in that mode — it saves blank). We take
 * the highest existing invoice number and continue the sequence from there.
 * Callers increment `num` per invoice they create.
 */
export async function nextInvoiceNumberSeed(token: OrgQboToken): Promise<InvoiceNumberSeed> {
  const recent = await qboQueryTop(token, "Invoice", 200).catch(() => []);
  let best: InvoiceNumberSeed | null = null;
  for (const r of recent) {
    const m = String(r.DocNumber ?? "").trim().match(/^(\D*?)(\d+)$/);
    if (!m) continue;
    const n = parseInt(m[2], 10);
    if (!best || n > best.num) best = { prefix: m[1], num: n, width: m[2].length };
  }
  // No numeric invoice numbers found → start a sensible default sequence.
  return best ?? { prefix: "", num: 1000, width: 4 };
}

/** Format the invoice number `offset` steps past the seed (offset starts at 1). */
export function formatInvoiceNumber(seed: InvoiceNumberSeed, offset: number): string {
  const n = seed.num + offset;
  return seed.prefix + String(n).padStart(seed.width, "0");
}

/**
 * Turn a user-supplied FIRST invoice number into a seed such that
 * formatInvoiceNumber(seed, 1) === the supplied number (so the first created
 * invoice is exactly what the user typed, then increments).
 */
export function seedFromStart(start: string): InvoiceNumberSeed | null {
  const m = String(start).trim().match(/^(\D*?)(\d+)$/);
  if (!m) return null;
  return { prefix: m[1], num: parseInt(m[2], 10) - 1, width: m[2].length };
}

export type ProgressInvoiceStatus =
  | "LINKED"                                   // invoice created AND QBO persisted the estimate link
  | "INVOICE_CREATED_QBO_LINK_NOT_PERSISTED"   // invoice created, QBO silently discarded the link
  | "QBO_CREATE_REJECTED"                      // QBO refused to create the invoice
  | "ESTIMATE_NOT_FOUND"
  | "NO_LINES";

export interface ProgressInvoiceResult {
  ok: boolean;                 // true if the invoice was created (link status is separate)
  invoiceCreated: boolean;
  invoiceId?: string;
  invoiceNumber?: string;
  estimateId: string;
  estimateDocNumber?: string;
  linkRequested: boolean;      // did we send the estimate LinkedTxn
  linkPersisted: boolean;      // did a fresh QBO read confirm the link
  estimateListsInvoice?: boolean; // does the estimate side expose the invoice
  updateAttempted?: boolean;
  status: ProgressInvoiceStatus;
  error?: string;
  raw?: any;                   // the final stored invoice (fresh read)
  trace?: any;                 // full diagnostics (see logging)
}

/**
 * Create one invoice from an estimate, billing the amounts the user entered per
 * line. Reads the estimate fresh and copies each billed line's Item/Tax/Class/
 * Description verbatim (so tax + tracking carry), overriding Amount/Qty, and
 * requests the native QBO Estimate→Invoice link.
 *
 * CRITICAL: a successful create is NOT proof the link stuck — QBO can accept the
 * request and silently discard the LinkedTxn. So we always re-READ the invoice
 * from QBO and verify the relationship is persisted, make ONE controlled update
 * attempt if it isn't, verify again, and report `linkPersisted` + `status`
 * honestly (never a single generic "success"). No blind repeated retries.
 */
export async function createProgressInvoice(
  token: OrgQboToken,
  estimateId: string,
  inputs: { index: number; amount?: number; qty?: number }[],
  opts: { invoiceDate?: string; invoiceNo?: string; debug?: boolean } = {}
): Promise<ProgressInvoiceResult> {
  const est = await qboReadOne(token, "estimate", estimateId);
  if (!est) return { ok: false, invoiceCreated: false, estimateId, linkRequested: false, linkPersisted: false, status: "ESTIMATE_NOT_FOUND", error: "Estimate not found" };
  const estDocNumber = est.DocNumber as string | undefined;
  const estSyncToken = est.SyncToken as string | undefined;
  const lines = salesLinesOf(est);

  // Clone the ENTIRE estimate → invoice so every detail carries verbatim
  // (billing/shipping address, custom fields incl. PO ref, customer message,
  // terms, ship info, class, location, currency, tax mode). We only strip
  // fields that don't belong on an invoice or are read-only, swap the lines for
  // the billed amounts, set the date, and add the estimate link.
  const payload: any = JSON.parse(JSON.stringify(est));
  const STRIP = [
    "Id", "SyncToken", "MetaData", "domain", "sparse", "status",
    "TxnStatus", "ExpirationDate", "AcceptedBy", "AcceptedDate",
    "DocNumber",          // never carry the estimate's number onto the invoice
    "LinkedTxn",          // replaced below with the estimate link
    "Balance", "TotalAmt", "HomeTotalAmt", "HomeBalance",
    "TxnTaxDetail",       // let QBO recompute tax from the lines
    "RecurDataRef", "DeliveryInfo", "EInvoiceStatus", "Deposit",
  ];
  for (const k of STRIP) delete payload[k];

  // Billed lines: copy each estimate sales line as-is, overriding the amount.
  const byIndex = new Map(inputs.map((i) => [i.index, i]));
  const Line: any[] = [];
  const lineLinks: (string | null)[] = [];   // estimate line id per billed line, in Line order
  for (let i = 0; i < lines.length; i++) {
    const input = byIndex.get(i);
    if (!input) continue;
    const amount = num(input.amount);
    const qty = num(input.qty);
    if ((amount == null || amount === 0) && (qty == null || qty === 0)) continue;

    const line = JSON.parse(JSON.stringify(lines[i]));  // faithful copy of the estimate line
    const estLineId = line.Id;                          // estimate line id → this line's TxnLineId link
    delete line.Id;
    const d = line.SalesItemLineDetail || (line.SalesItemLineDetail = {});

    // The billed portion (ex-tax) for this line.
    const estUnitPrice = Number(d.UnitPrice);
    let billed = amount;
    if (billed == null && qty != null && !isNaN(estUnitPrice)) billed = round2(qty * estUnitPrice);
    billed = round2(billed ?? 0);

    // Mirror QBO's own progress-invoice line shape (see a UI-created one): keep
    // the estimate line's UnitPrice and express the billed portion as Qty, so
    // Qty × UnitPrice == billed and QBO shows Qty as the fraction (e.g. 0.15 for
    // 15%). This is the representation QBO stores for a progress line and is what
    // makes it accept the line-level estimate link below. Requires "Progress
    // Invoicing" enabled in QBO company settings.
    if (!isNaN(estUnitPrice) && estUnitPrice !== 0) {
      d.UnitPrice = estUnitPrice;
      d.Qty = billed / estUnitPrice;   // full precision so Qty×UnitPrice == billed exactly
    } else {
      // No usable unit price on the estimate line — bill a flat amount at Qty 1.
      d.Qty = 1;
      d.UnitPrice = billed;
    }
    line.Amount = billed;

    // Link this invoice line back to its estimate line — QBO surfaces the
    // "Linked transactions" badge (and does progress-invoicing math) from this
    // line-level LinkedTxn, not the transaction-level one alone.
    if (estLineId != null) line.LinkedTxn = [{ TxnId: estimateId, TxnType: "Estimate", TxnLineId: String(estLineId) }];
    Line.push(line);
    lineLinks.push(estLineId != null ? String(estLineId) : null);
  }
  if (Line.length === 0) return { ok: false, invoiceCreated: false, estimateId, estimateDocNumber: estDocNumber, linkRequested: false, linkPersisted: false, status: "NO_LINES", error: "No amounts entered to invoice" };

  payload.Line = Line;
  payload.LinkedTxn = [{ TxnId: estimateId, TxnType: "Estimate" }];
  payload.TxnDate = opts.invoiceDate || new Date().toISOString().slice(0, 10);
  delete payload.DueDate;              // let QBO derive it from the copied terms
  if (opts.invoiceNo) payload.DocNumber = opts.invoiceNo;

  // Full diagnostics — always collected and logged (returned only when debug).
  const trace: any = {
    estimateId, estimateDocNumber: estDocNumber, estimateSyncToken: estSyncToken,
    estimateLineIdsUsed: lineLinks,
    sentTxnLink: payload.LinkedTxn,
    sentLineLinks: Line.map((l) => l.LinkedTxn ?? null),
  };

  // STEP 1: create the invoice (with the estimate link requested).
  if (opts.debug) trace.rawCreatePayload = JSON.parse(JSON.stringify(payload));
  const res = await qboPost(token, "invoice", payload);
  trace.createIntuitTid = res.intuitTid ?? null;
  if (opts.debug) trace.rawCreateResponse = res.data ?? res.error;
  if (!res.ok) {
    trace.createError = res.error;
    console.warn("[estimate-invoice-link] CREATE REJECTED", JSON.stringify(trace));
    return { ok: false, invoiceCreated: false, estimateId, estimateDocNumber: estDocNumber, linkRequested: true, linkPersisted: false, status: "QBO_CREATE_REJECTED", error: res.error, trace: opts.debug ? trace : undefined };
  }
  const inv = res.data?.Invoice;
  const invoiceId: string | undefined = inv?.Id;
  const invoiceNumber: string | undefined = inv?.DocNumber;
  trace.invoiceId = invoiceId;
  trace.invoiceNumber = invoiceNumber;
  trace.invoiceLineIdsCreated = (inv?.Line || []).filter((l: any) => l.DetailType === "SalesItemLineDetail").map((l: any) => l.Id);
  trace.createResponseLinked = hasEstimateLink(inv);

  // STEP 2: re-READ from QBO — a create response is not proof the link stuck.
  let stored = inv;
  if (invoiceId) {
    const fresh = await qboReadOne(token, "invoice", invoiceId).catch(() => null);
    if (fresh) stored = fresh;
  }
  trace.readbackLinkedTxn = stored?.LinkedTxn ?? null;
  trace.afterCreateReadbackLinked = hasEstimateLink(stored);

  // STEP 3: if not persisted, ONE controlled update attempt (supported QBO
  // mechanism), then verify again. No further blind retries.
  trace.updateAttempted = false;
  if (invoiceId && !hasEstimateLink(stored)) {
    trace.updateAttempted = true;
    try {
      const upd = JSON.parse(JSON.stringify(stored));
      upd.LinkedTxn = [{ TxnId: estimateId, TxnType: "Estimate" }];
      const salesUpd = (upd.Line || []).filter((l: any) => l.DetailType === "SalesItemLineDetail");
      for (let k = 0; k < salesUpd.length; k++) {
        const eid = lineLinks[k];
        if (eid) salesUpd[k].LinkedTxn = [{ TxnId: estimateId, TxnType: "Estimate", TxnLineId: eid }];
        // QBO rounds Qty to 7dp on storage, so the stored Amount can drift from
        // Qty×UnitPrice — which fails the update's Amount check. Re-derive Amount
        // from the (rounded) stored Qty×UnitPrice so the payload is consistent.
        const d = salesUpd[k].SalesItemLineDetail || {};
        const q = Number(d.Qty), up = Number(d.UnitPrice);
        if (!isNaN(q) && !isNaN(up)) salesUpd[k].Amount = Math.round(q * up * 100) / 100;
      }
      if (opts.debug) trace.rawUpdatePayload = JSON.parse(JSON.stringify(upd));
      const ures = await qboPost(token, "invoice", upd, { operation: "update" });
      trace.updateIntuitTid = ures.intuitTid ?? null;
      if (opts.debug) trace.rawUpdateResponse = ures.data ?? ures.error;
      trace.updateOk = ures.ok;
      trace.updateError = ures.error ?? null;
      trace.updateResponseLinked = ures.ok ? hasEstimateLink(ures.data?.Invoice) : null;
      // Verify with a fresh read (not the update response).
      if (invoiceId) {
        const fresh2 = await qboReadOne(token, "invoice", invoiceId).catch(() => null);
        if (fresh2) stored = fresh2;
        else if (ures.data?.Invoice) stored = ures.data.Invoice;
      }
      trace.afterUpdateReadbackLinked = hasEstimateLink(stored);
    } catch (e: any) {
      trace.updateThrew = e?.message || String(e);
    }
  }

  const linkPersisted = hasEstimateLink(stored);

  // STEP 4: estimate-side VERIFICATION (read only) — does QBO expose the invoice
  // through the estimate's own transaction relationships? Diagnostic; no write.
  let estimateListsInvoice: boolean | undefined;
  try {
    const estAfter = await qboReadOne(token, "estimate", estimateId).catch(() => null);
    estimateListsInvoice = (estAfter?.LinkedTxn || []).some((x: any) => x.TxnType === "Invoice" && String(x.TxnId) === String(invoiceId));
    trace.estimateListsInvoice = estimateListsInvoice;
  } catch { /* verification best-effort */ }

  const status: ProgressInvoiceStatus = linkPersisted ? "LINKED" : "INVOICE_CREATED_QBO_LINK_NOT_PERSISTED";
  trace.finalLinked = linkPersisted;
  trace.status = status;
  if (opts.debug) trace.rawReadbackInvoice = stored;   // full GET/read-back JSON

  // Always log the full diagnostic line so a failed link is traceable in prod.
  (linkPersisted ? console.log : console.warn)("[estimate-invoice-link]", JSON.stringify(trace));

  return {
    ok: true,
    invoiceCreated: true,
    invoiceId,
    invoiceNumber,
    estimateId,
    estimateDocNumber: estDocNumber,
    linkRequested: true,
    linkPersisted,
    estimateListsInvoice,
    updateAttempted: trace.updateAttempted,
    status,
    raw: stored,
    trace: opts.debug ? trace : undefined,
  };
}

/** True if the invoice carries an estimate link at transaction or line level. */
function hasEstimateLink(inv: any): boolean {
  if (!inv) return false;
  if ((inv.LinkedTxn || []).some((x: any) => x.TxnType === "Estimate")) return true;
  return (inv.Line || []).some((l: any) => (l.LinkedTxn || []).some((x: any) => x.TxnType === "Estimate"));
}
