/**
 * POST /api/batch/estimates/invoice-batch
 * JSON body: { items: [{ estimateId, estimateNumber?, invoiceNo?, lines:[{index, amount?, qty?}] }], invoiceDate?, startInvoiceNo? }
 *
 * Creates one invoice per estimate SYNCHRONOUSLY (clones the estimate, bills the
 * given lines, links to the estimate) and returns the results. Logged to
 * batch_jobs for history + undo.
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { getOrgQboToken } from "@/lib/qbo-token";
import { createProgressInvoice, nextInvoiceNumberSeed, formatInvoiceNumber, seedFromStart } from "@/lib/batch/estimate-invoicing";
import { RefResolver } from "@/lib/batch/ref-resolver";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id as string;

  const body = await req.json().catch(() => null);
  const items = Array.isArray(body?.items) ? body.items : [];
  if (items.length === 0) return bad("Nothing to invoice — enter amounts on at least one estimate");

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected for this organisation", 400);

  // Invoice numbering: user-supplied start → sequence from there; else if QBO
  // custom transaction numbers is on (API won't auto-fill) → continue from the
  // highest existing number; else let QBO assign.
  let seed = body.startInvoiceNo ? seedFromStart(String(body.startInvoiceNo)) : null;
  if (!seed) {
    const company = await new RefResolver(token).company().catch(() => null);
    if (company?.customTxnNumbers) seed = await nextInvoiceNumberSeed(token).catch(() => null);
  }
  let seq = 0;

  const results: any[] = [];
  let successCount = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    try {
      let invoiceNo = it.invoiceNo;
      if (!invoiceNo && seed) invoiceNo = formatInvoiceNumber(seed, ++seq);
      const res = await createProgressInvoice(token, it.estimateId, it.lines, { invoiceDate: body.invoiceDate, invoiceNo });
      if (res.ok) {
        successCount++;
        // Did QBO actually store the estimate link? Inspect the created invoice
        // it returned (transaction-level LinkedTxn or any line-level one).
        const raw = res.raw || {};
        const txnLinked = (raw.LinkedTxn || []).some((x: any) => x.TxnType === "Estimate");
        const lineLinked = (raw.Line || []).some((l: any) => (l.LinkedTxn || []).some((x: any) => x.TxnType === "Estimate"));
        results.push({
          row: i + 1, ok: true, qboId: res.invoiceId, docNumber: res.invoiceNumber, estimate: it.estimateNumber,
          linkedToEstimate: txnLinked || lineLinked,
          storedTxnLink: raw.LinkedTxn ?? null,
        });
      } else {
        results.push({ row: i + 1, ok: false, error: res.error, estimate: it.estimateNumber });
      }
    } catch (e: any) {
      results.push({ row: i + 1, ok: false, error: e?.message || "Failed", estimate: it.estimateNumber });
    }
  }

  // Audit log is best-effort — a logging failure must NEVER fail an operation
  // that already created invoices in QBO (that would report "failed" for work
  // that actually succeeded, and leave no trace to undo from).
  try {
    await db.insert(batchJobs).values({
      orgId: orgId!, userId,
      operation: "upload",
      entityId: "estimateinvoice",
      entityLabel: "Invoice from Estimates",
      fileName: `${items.length} estimate${items.length === 1 ? "" : "s"}`,
      status: "done",
      totalRows: items.length,
      successCount,
      errorCount: items.length - successCount,
      results,
      finishedAt: new Date(),
    });
  } catch (e) {
    console.error("[invoice-batch] failed to log batch job (invoices were still created):", e);
  }

  return ok({ total: items.length, successCount, errorCount: items.length - successCount, results });
}
