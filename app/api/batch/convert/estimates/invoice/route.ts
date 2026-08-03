/**
 * POST /api/batch/convert/estimates/invoice
 * Multipart body: file (the filled progress-invoicing export).
 *
 * Groups rows by Estimate Id and creates one invoice per estimate, billing only
 * the lines with a Qty/Amount to Invoice, each linked to its estimate.
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";
import { getOrgQboToken } from "@/lib/qbo-token";
import { parseWorkbook } from "@/lib/batch/engine";
import { RefResolver } from "@/lib/batch/ref-resolver";
import { qboPost } from "@/lib/batch/qbo-client";
import { buildProgressInvoice } from "@/lib/batch/convert";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id as string;

  const form = await req.formData().catch(() => null);
  if (!form) return bad("Expected multipart form data");
  const file = form.get("file");
  if (!(file instanceof File)) return bad("No file uploaded");
  if (file.size > 10 * 1024 * 1024) return bad("File exceeds 10 MB");

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected for this organisation", 400);

  const { rows } = parseWorkbook(Buffer.from(await file.arrayBuffer()));
  if (rows.length === 0) return bad("The file has no data rows");

  // Group rows by Estimate Id.
  const byEstimate = new Map<string, any[]>();
  for (const row of rows) {
    const id = row["Estimate Id"] != null ? String(row["Estimate Id"]).trim() : "";
    if (!id) continue;
    if (!byEstimate.has(id)) byEstimate.set(id, []);
    byEstimate.get(id)!.push(row);
  }
  if (byEstimate.size === 0) return bad("No 'Estimate Id' values found — use the exported file.");

  const [job] = await db.insert(batchJobs).values({
    orgId: orgId!, userId,
    operation: "convert",
    entityId: "estimate-progress-invoice",
    entityLabel: "Estimate → Invoice (by line)",
    fileName: file.name,
    status: "running",
    totalRows: byEstimate.size,
  }).returning({ id: batchJobs.id });

  const resolver = new RefResolver(token);
  await resolver.preload(["Customer", "Item", "Class", "Department", "TaxCode"]);

  const results: { estimate: string; ok: boolean; invoiceNo?: string; error?: string }[] = [];
  let successCount = 0, skipped = 0;

  for (const [estimateId, estRows] of byEstimate) {
    const estNo = estRows[0]["Estimate No"] ?? estimateId;
    try {
      const payload = await buildProgressInvoice(estimateId, estRows, resolver);
      if (!payload) { skipped++; results.push({ estimate: estNo, ok: false, error: "No lines marked to invoice — skipped" }); continue; }
      const res = await qboPost(token, "invoice", payload);
      if (res.ok) {
        successCount++;
        const inv = res.data?.Invoice;
        results.push({ estimate: estNo, ok: true, invoiceNo: inv?.DocNumber });
      } else {
        results.push({ estimate: estNo, ok: false, error: res.error });
      }
    } catch (e: any) {
      results.push({ estimate: estNo, ok: false, error: e?.message || "Conversion failed" });
    }
  }

  await db.update(batchJobs).set({
    status: "done",
    successCount,
    errorCount: byEstimate.size - successCount,
    results,
    finishedAt: new Date(),
  }).where(eq(batchJobs.id, job.id));

  return ok({ jobId: job.id, total: byEstimate.size, successCount, skipped, errorCount: byEstimate.size - successCount, results });
}
