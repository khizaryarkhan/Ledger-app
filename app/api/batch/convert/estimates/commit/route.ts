/**
 * POST /api/batch/convert/estimates/commit
 * JSON body: { ids: string[], invoiceDate?, dueDate? }
 *
 * Creates an invoice linked to each selected estimate, logging the run to
 * batch_jobs. Reads each estimate fresh so the copied lines and links are
 * current.
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";
import { getOrgQboToken } from "@/lib/qbo-token";
import { qboReadOne, qboPost } from "@/lib/batch/qbo-client";
import { invoiceFromEstimate } from "@/lib/batch/convert";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id as string;

  const body = await req.json().catch(() => null);
  if (!body) return bad("Invalid JSON body");

  const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
  if (ids.length === 0) return bad("No estimates selected");

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected for this organisation", 400);

  const [job] = await db.insert(batchJobs).values({
    orgId: orgId!,
    userId,
    operation: "convert",
    entityId: "estimate-to-invoice",
    entityLabel: "Estimate → Invoice",
    status: "running",
    totalRows: ids.length,
  }).returning({ id: batchJobs.id });

  const results: { id: string; ok: boolean; invoiceId?: string; invoiceNo?: string; error?: string }[] = [];
  let successCount = 0;

  for (const id of ids) {
    try {
      const est = await qboReadOne(token, "estimate", id);
      if (!est) { results.push({ id, ok: false, error: "Estimate not found" }); continue; }
      const payload = invoiceFromEstimate(est, { invoiceDate: body.invoiceDate, dueDate: body.dueDate });
      if (!payload.Line?.length) { results.push({ id, ok: false, error: "Estimate has no billable lines" }); continue; }

      const res = await qboPost(token, "invoice", payload);
      if (res.ok) {
        const inv = res.data?.Invoice || firstRecord(res.data);
        successCount++;
        results.push({ id, ok: true, invoiceId: inv?.Id, invoiceNo: inv?.DocNumber });
      } else {
        results.push({ id, ok: false, error: res.error });
      }
    } catch (e: any) {
      results.push({ id, ok: false, error: e?.message || "Conversion failed" });
    }
  }

  await db.update(batchJobs).set({
    status: "done",
    successCount,
    errorCount: ids.length - successCount,
    results,
    finishedAt: new Date(),
  }).where(eq(batchJobs.id, job.id));

  return ok({ jobId: job.id, total: ids.length, successCount, errorCount: ids.length - successCount, results });
}

function firstRecord(data: any) {
  if (!data) return null;
  const key = Object.keys(data).find((k) => k !== "time");
  return key ? data[key] : null;
}
