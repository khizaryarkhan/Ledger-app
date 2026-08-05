/**
 * POST /api/batch/estimates/invoice-batch
 * JSON body: { items: [{ estimateId, estimateNumber?, invoiceNo?, lines:[{index, amount?, qty?}] }], invoiceDate? }
 *
 * Queues a background job that creates one linked invoice per estimate from the
 * worksheet, returning a jobId the UI polls for progress.
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { getOrgQboToken } from "@/lib/qbo-token";
import { inngest } from "@/lib/inngest";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id as string;

  const body = await req.json().catch(() => null);
  const items = Array.isArray(body?.items) ? body.items : [];
  if (items.length === 0) return bad("Nothing to invoice — enter amounts on at least one estimate");

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected for this organisation", 400);

  const [job] = await db.insert(batchJobs).values({
    orgId: orgId!, userId,
    operation: "upload",
    entityId: "estimateinvoice",
    entityLabel: "Invoice from Estimates",
    fileName: `${items.length} estimate${items.length === 1 ? "" : "s"}`,
    status: "queued",
    totalRows: items.length,
    input: { items, invoiceDate: body.invoiceDate, startInvoiceNo: body.startInvoiceNo },
  }).returning({ id: batchJobs.id });

  await inngest.send({ name: "batch/estimate-invoice-batch", data: { jobId: job.id } });
  return ok({ jobId: job.id, total: items.length });
}
