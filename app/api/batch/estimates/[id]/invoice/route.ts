/**
 * POST /api/batch/estimates/[id]/invoice
 * JSON body: { lines: [{ index, amount?, qty? }], invoiceDate?, invoiceNo? }
 *
 * Creates one invoice from the estimate, billing the entered per-line amounts,
 * linked to the estimate. Logs to batch_jobs so it appears in Job History and
 * can be undone.
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";
import { getOrgQboToken } from "@/lib/qbo-token";
import { createProgressInvoice } from "@/lib/batch/estimate-invoicing";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id as string;

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.lines)) return bad("Invalid body");

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected for this organisation", 400);

  const res = await createProgressInvoice(token, params.id, body.lines, {
    invoiceDate: body.invoiceDate, invoiceNo: body.invoiceNo,
  });

  // Log to Job History (so it's auditable + undoable).
  await db.insert(batchJobs).values({
    orgId: orgId!, userId,
    operation: "upload",
    entityId: "estimateinvoice",
    entityLabel: "Invoice from Estimate",
    fileName: `Estimate ${body.estimateNumber || params.id}`,
    status: "done",
    totalRows: 1,
    successCount: res.ok ? 1 : 0,
    errorCount: res.ok ? 0 : 1,
    results: res.ok
      ? [{ row: 1, ok: true, qboId: res.invoiceId, docNumber: res.invoiceNumber }]
      : [{ row: 1, ok: false, error: res.error }],
    finishedAt: new Date(),
  });

  if (!res.ok) return bad(res.error || "Invoice creation failed");
  return ok({ ok: true, invoiceNumber: res.invoiceNumber });
}
