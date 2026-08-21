/**
 * POST /api/batch/upload/commit
 * JSON body: { entity, operation: "upload"|"modify", fileName, mapping, overrides, rawRows }
 *
 * Queues the import/update as a background job (Inngest) so large files aren't
 * bound by the request timeout, and returns a jobId the UI polls for progress.
 */

import { db } from "@/db";
import { batchJobs, organisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";
import { getEntity } from "@/lib/batch/entities";
import { getXeroEntity } from "@/lib/batch/xero/registry";
import { detectProvider } from "@/lib/batch/provider";
import { normalizeRows, groupDocs } from "@/lib/batch/engine";
import { normalizeDateColumns, dateFileHeaders, orgDateOrder } from "@/lib/batch/dates";
import { getOrgQboToken } from "@/lib/qbo-token";
import { getOrgXeroToken } from "@/lib/xero-token";
import { inngest } from "@/lib/inngest";
import { runBatchCommitJob } from "@/lib/batch/commit-runner";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id as string;

  const body = await req.json().catch(() => null);
  if (!body) return bad("Invalid JSON body");

  const provider = await detectProvider(orgId!);
  const entity: any = provider === "xero" ? getXeroEntity(String(body.entity || "")) : getEntity(String(body.entity || ""));
  if (!entity) return bad("Unknown entity", 404);

  const operation: "upload" | "modify" = body.operation === "modify" ? "modify" : "upload";
  if (operation === "upload" && !entity.supports.upload) return bad(entity.note || "Import not supported");
  if (operation === "modify" && !entity.supports.modify) return bad(entity.note || "Update not supported");
  if (!entity.build) return bad("This entity has no payload builder");

  const mapping: Record<string, string> = body.mapping || {};
  const overrides: Record<string, Record<string, string>> = body.overrides || {};
  const rawRows: any[] = Array.isArray(body.rawRows) ? body.rawRows : [];
  if (rawRows.length === 0) return bad("No rows to process");

  // Safety net: ensure date columns are canonical YYYY-MM-DD before the job is
  // queued (idempotent — already-ISO dates pass through unchanged).
  const [org] = await db.select({ dateFormat: organisations.dateFormat }).from(organisations).where(eq(organisations.id, orgId!)).limit(1);
  normalizeDateColumns(rawRows, dateFileHeaders(entity, mapping), orgDateOrder(org?.dateFormat));

  const token = provider === "xero" ? await getOrgXeroToken(orgId!).catch(() => null) : await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad(`${provider === "xero" ? "Xero" : "QuickBooks"} is not connected for this organisation`, 400);

  // Count documents up front so the UI can show the denominator immediately.
  const docCount = groupDocs(normalizeRows(rawRows, mapping), entity).length;

  const [job] = await db.insert(batchJobs).values({
    orgId: orgId!,
    userId,
    operation,
    entityId: entity.id,
    entityLabel: entity.label,
    fileName: body.fileName ?? null,
    status: "queued",
    totalRows: docCount,
    input: { mapping, overrides, rawRows },
  }).returning({ id: batchJobs.id });

  // Interactive-sized batches run INLINE in this request — completion must not
  // depend on background-worker delivery (the batch/commit Inngest event wasn't
  // being consumed in every environment, leaving jobs stuck at "queued"
  // forever). This fits comfortably in the 60s budget. The runner claims the
  // job atomically, so this is safe. Larger batches still go to the queue.
  const INLINE_MAX = 100;
  if (docCount <= INLINE_MAX) {
    await runBatchCommitJob(job.id).catch((e) => console.error("[batch inline commit]", e));
    return ok({ jobId: job.id, total: docCount, background: false });
  }

  await inngest.send({ name: "batch/commit", data: { jobId: job.id } });
  return ok({ jobId: job.id, total: docCount, background: true });
}
