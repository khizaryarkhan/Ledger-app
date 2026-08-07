/**
 * Background worker for the Invoice-from-Estimates worksheet: creates one linked
 * invoice per estimate from the staged per-line amounts, with live progress.
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOrgQboToken } from "@/lib/qbo-token";
import { createProgressInvoice, nextInvoiceNumberSeed, formatInvoiceNumber, seedFromStart } from "./estimate-invoicing";
import { RefResolver } from "./ref-resolver";

interface BatchItem {
  estimateId: string;
  estimateNumber?: string;
  invoiceNo?: string;
  lines: { index: number; amount?: number; qty?: number }[];
}

export async function runEstimateInvoiceBatch(jobId: string): Promise<void> {
  const [job] = await db.select().from(batchJobs).where(eq(batchJobs.id, jobId)).limit(1);
  if (!job || job.status === "done" || job.status === "failed") return;

  const fail = (error: string) =>
    db.update(batchJobs).set({ status: "failed", results: [{ ok: false, error }], input: null, finishedAt: new Date() }).where(eq(batchJobs.id, jobId));

  const token = await getOrgQboToken(job.orgId).catch(() => null);
  if (!token) { await fail("QuickBooks is not connected"); return; }

  const input = (job.input || {}) as any;
  const items: BatchItem[] = Array.isArray(input.items) ? input.items : [];
  const invoiceDate: string | undefined = input.invoiceDate;
  const startInvoiceNo: string | undefined = input.startInvoiceNo;

  await db.update(batchJobs).set({ status: "running", totalRows: items.length }).where(eq(batchJobs.id, jobId));

  // Invoice numbering:
  //  - user typed a starting number → sequence from there (first = that number);
  //  - else if QBO custom transaction numbers is ON (API won't auto-fill, saving
  //    a blank number) → continue from the highest existing invoice number;
  //  - else send nothing and let QBO auto-assign.
  let seed = startInvoiceNo ? seedFromStart(startInvoiceNo) : null;
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
      const res = await createProgressInvoice(token, it.estimateId, it.lines, { invoiceDate, invoiceNo });
      if (res.invoiceCreated) {
        successCount++;
        results.push({ row: i + 1, ok: true, qboId: res.invoiceId, docNumber: res.invoiceNumber, estimate: it.estimateNumber, linkPersisted: res.linkPersisted, status: res.status });
      } else {
        results.push({ row: i + 1, ok: false, error: res.error, estimate: it.estimateNumber, status: res.status });
      }
    } catch (e: any) {
      results.push({ row: i + 1, ok: false, error: e?.message || "Failed", estimate: it.estimateNumber });
    }
    if ((i + 1) % 5 === 0)
      await db.update(batchJobs).set({ successCount, errorCount: i + 1 - successCount }).where(eq(batchJobs.id, jobId));
  }

  await db.update(batchJobs).set({
    status: "done", successCount, errorCount: items.length - successCount,
    results, input: null, finishedAt: new Date(),
  }).where(eq(batchJobs.id, jobId));
}
