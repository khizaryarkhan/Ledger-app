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
import { qboQueryAll, qboReadOne, qboPost } from "./qbo-client";
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

/**
 * Create one invoice from an estimate, billing the amounts the user entered per
 * line. Reads the estimate fresh and copies each billed line's Item/Tax/Class/
 * Description verbatim (so tax + tracking carry), overriding Amount/Qty. Links
 * the invoice to the estimate.
 */
export async function createProgressInvoice(
  token: OrgQboToken,
  estimateId: string,
  inputs: { index: number; amount?: number; qty?: number }[],
  opts: { invoiceDate?: string; invoiceNo?: string } = {}
): Promise<{ ok: boolean; invoiceNumber?: string; invoiceId?: string; error?: string }> {
  const est = await qboReadOne(token, "estimate", estimateId);
  if (!est) return { ok: false, error: "Estimate not found" };
  const lines = salesLinesOf(est);

  const byIndex = new Map(inputs.map((i) => [i.index, i]));
  const Line: any[] = [];
  for (let i = 0; i < lines.length; i++) {
    const input = byIndex.get(i);
    if (!input) continue;
    const amount = num(input.amount);
    const qty = num(input.qty);
    if ((amount == null || amount === 0) && (qty == null || qty === 0)) continue;
    const src = lines[i];
    const d = src.SalesItemLineDetail || {};
    const rate = Number(d.UnitPrice);
    const lineAmount = amount ?? (qty != null && !isNaN(rate) ? round2(qty * rate) : 0);
    Line.push({
      DetailType: "SalesItemLineDetail",
      Amount: lineAmount,
      Description: src.Description,
      SalesItemLineDetail: {
        ItemRef: d.ItemRef,
        Qty: qty,
        UnitPrice: d.UnitPrice,
        TaxCodeRef: d.TaxCodeRef,
        ClassRef: d.ClassRef,
        ServiceDate: d.ServiceDate,
      },
    });
  }
  if (Line.length === 0) return { ok: false, error: "No amounts entered to invoice" };

  const payload: any = {
    CustomerRef: est.CustomerRef,
    Line,
    LinkedTxn: [{ TxnId: estimateId, TxnType: "Estimate" }],
    TxnDate: opts.invoiceDate || new Date().toISOString().slice(0, 10),
  };
  if (opts.invoiceNo) payload.DocNumber = opts.invoiceNo;
  if (est.CurrencyRef) payload.CurrencyRef = est.CurrencyRef;
  if (est.DepartmentRef) payload.DepartmentRef = est.DepartmentRef;
  if (est.ClassRef) payload.ClassRef = est.ClassRef;
  if (est.GlobalTaxCalculation) payload.GlobalTaxCalculation = est.GlobalTaxCalculation;
  if (est.BillEmail) payload.BillEmail = est.BillEmail;

  const res = await qboPost(token, "invoice", payload);
  if (!res.ok) return { ok: false, error: res.error };
  const inv = res.data?.Invoice;
  return { ok: true, invoiceNumber: inv?.DocNumber, invoiceId: inv?.Id };
}
