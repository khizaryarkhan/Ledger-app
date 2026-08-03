/**
 * POST /api/batch/upload/commit
 * JSON body: { entity, operation: "upload"|"modify", fileName, mapping, rawRows }
 *
 * Builds a QBO payload per document and creates (upload) or updates (modify)
 * each in QuickBooks, logging the run to batch_jobs with per-row results.
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";
import { getEntity } from "@/lib/batch/entities";
import { normalizeRows, groupDocs } from "@/lib/batch/engine";
import { getOrgQboToken } from "@/lib/qbo-token";
import { qboPost } from "@/lib/batch/qbo-client";
import { RefResolver } from "@/lib/batch/ref-resolver";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id as string;

  const body = await req.json().catch(() => null);
  if (!body) return bad("Invalid JSON body");

  const entity = getEntity(String(body.entity || ""));
  if (!entity) return bad("Unknown entity", 404);

  const operation: "upload" | "modify" = body.operation === "modify" ? "modify" : "upload";
  if (operation === "upload" && !entity.supports.upload) return bad(entity.note || "Upload not supported");
  if (operation === "modify" && !entity.supports.modify) return bad(entity.note || "Modify not supported");
  if (!entity.build) return bad("This entity has no payload builder");

  const mapping: Record<string, string> = body.mapping || {};
  const rawRows: any[] = Array.isArray(body.rawRows) ? body.rawRows : [];
  if (rawRows.length === 0) return bad("No rows to process");

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected for this organisation", 400);

  const normalized = normalizeRows(rawRows, mapping);
  const docs = groupDocs(normalized, entity);

  // Create the job row up front so it's visible even if the request times out.
  const [job] = await db.insert(batchJobs).values({
    orgId: orgId!,
    userId,
    operation,
    entityId: entity.id,
    entityLabel: entity.label,
    fileName: body.fileName ?? null,
    status: "running",
    totalRows: docs.length,
  }).returning({ id: batchJobs.id });

  const resolver = new RefResolver(token);
  if (entity.refs?.length) await resolver.preload(entity.refs);

  const results: { row: number; ok: boolean; qboId?: string; docNumber?: string; error?: string }[] = [];
  let successCount = 0;

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    try {
      const built = await entity.build(doc, resolver);
      let payload = built.payload;

      if (operation === "modify") {
        // Modify requires the existing Id + SyncToken (supplied via the sheet).
        const id = doc.rows[0]["Id"] ?? doc.rows[0]["QBO Id"];
        const syncToken = doc.rows[0]["SyncToken"] ?? doc.rows[0]["Sync Token"];
        if (!id) throw new Error("Modify needs an 'Id' column (download the records first)");
        payload = { ...payload, Id: String(id), SyncToken: String(syncToken ?? "0"), sparse: true };
      }

      const res = await qboPost(token, entity.qboEntity!, payload, {
        operation: operation === "modify" ? "update" : undefined,
      });

      if (res.ok) {
        const created = res.data?.[capitalize(entity.qboEntity!)] || firstRecord(res.data);
        successCount++;
        results.push({ row: i + 1, ok: true, qboId: created?.Id, docNumber: created?.DocNumber });
      } else {
        results.push({ row: i + 1, ok: false, error: res.error });
      }
    } catch (e: any) {
      results.push({ row: i + 1, ok: false, error: e?.message || "Build failed" });
    }
  }

  await db.update(batchJobs).set({
    status: "done",
    successCount,
    errorCount: docs.length - successCount,
    results,
    finishedAt: new Date(),
  }).where(eq(batchJobs.id, job.id));

  return ok({ jobId: job.id, total: docs.length, successCount, errorCount: docs.length - successCount, results });
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function firstRecord(data: any) {
  if (!data) return null;
  const key = Object.keys(data).find((k) => k !== "time");
  return key ? data[key] : null;
}
