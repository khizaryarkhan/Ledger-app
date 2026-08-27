/**
 * POST /api/batch/upload/start
 * Body: { entity, operation, fileName, mapping, overrides, rawRows }
 *
 * Stages a chunked import: creates the job with the whole file attached but
 * processes NOTHING yet. The client then drives /api/batch/upload/chunk in a
 * loop until the file is done — so import size never hits a request timeout.
 *
 * QuickBooks only. For Xero it returns { chunked: false } and the client falls
 * back to the legacy /api/batch/upload/commit path.
 */

import { db } from "@/db";
import { batchJobs, organisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";
import { getEntity } from "@/lib/batch/entities";
import { detectProvider } from "@/lib/batch/provider";
import { normalizeRows, groupDocs } from "@/lib/batch/engine";
import { normalizeDateColumns, dateFileHeaders, orgDateOrder } from "@/lib/batch/dates";
import { getOrgQboToken } from "@/lib/qbo-token";
import { inngest } from "@/lib/inngest";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id as string;

  const body = await req.json().catch(() => null);
  if (!body) return bad("Invalid JSON body");

  // Xero has no chunked path yet — tell the client to use the legacy commit.
  if ((await detectProvider(orgId!)) === "xero") return ok({ chunked: false });

  const entity: any = getEntity(String(body.entity || ""));
  if (!entity) return bad("Unknown entity", 404);

  const operation: "upload" | "modify" = body.operation === "modify" ? "modify" : "upload";
  if (operation === "upload" && !entity.supports.upload) return bad(entity.note || "Import not supported");
  if (operation === "modify" && !entity.supports.modify) return bad(entity.note || "Update not supported");
  if (!entity.build) return bad("This entity has no payload builder");

  const mapping: Record<string, string> = body.mapping || {};
  const overrides: Record<string, Record<string, string>> = body.overrides || {};
  const rawRows: any[] = Array.isArray(body.rawRows) ? body.rawRows : [];
  if (rawRows.length === 0) return bad("No rows to process");

  const [org] = await db.select({ dateFormat: organisations.dateFormat }).from(organisations).where(eq(organisations.id, orgId!)).limit(1);
  normalizeDateColumns(rawRows, dateFileHeaders(entity, mapping), orgDateOrder(org?.dateFormat));

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected for this organisation", 400);

  const docCount = groupDocs(normalizeRows(rawRows, mapping), entity).length;

  const [job] = await db.insert(batchJobs).values({
    orgId: orgId!,
    userId,
    operation,
    entityId: entity.id,
    entityLabel: entity.label,
    fileName: body.fileName ?? null,
    status: "running",
    totalRows: docCount,
    processedCount: 0,
    // Already-expired on purpose: this is the structural marker
    // (lib/batch/reap.ts, inngest/functions/batch.ts) that says "this job is
    // chunk-resumable" — set at creation, before any chunk has ever run, so
    // a dropped FIRST event is just as resumable as a dropped later one.
    leaseUntil: new Date(),
    input: { mapping, overrides, rawRows },
  }).returning({ id: batchJobs.id });

  // Drive it server-side from here on — the client no longer has to keep a
  // tab open and looping for the import to complete (see runBatchChunkLoop).
  await inngest.send({ name: "batch/chunk-run", data: { jobId: job.id, orgId: orgId! } }).catch(() => {});

  return ok({ chunked: true, jobId: job.id, total: docCount });
}
