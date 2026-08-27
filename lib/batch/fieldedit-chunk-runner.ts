/**
 * Chunked, resumable bulk-edit runner (QuickBooks).
 *
 * /api/batch/bulk-edit/apply used to `await runFieldEditJob(...)` INLINE,
 * inside the HTTP handler — meaning the request didn't return until every
 * record was edited. The client already had a poll() loop wired up (built
 * for consistency with the other flows) but it was dead code: by the time the
 * first poll fired, the job was always already "done", because the whole
 * thing had run synchronously before the response even came back. A large
 * selection just meant a long-hanging fetch with a bare 60s ceiling and no
 * incremental progress shown — and if it ran past that ceiling, a mid-loop
 * kill (same failure mode as the old delete path).
 *
 * Field-edit semantics (minimal sparse updates, class-per-line safety check
 * against progress-invoicing links) are unchanged from field-edit-runner.ts —
 * only the execution shape moved onto the shared lease/cursor engine so it's
 * resumable and durable exactly like upload and delete now are.
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getEntity } from "./entities";
import { getOrgQboToken } from "@/lib/qbo-token";
import { qboPost, qboReadOne } from "./qbo-client";
import { RefResolver } from "./ref-resolver";
import { claimChunk, finishChunkCall, releaseLeaseOnError, runChunkLoop, type ChunkOutcome } from "./lease";

function firstRecord(data: any) {
  if (!data) return null;
  const key = Object.keys(data).find((k) => k !== "time");
  return key ? data[key] : null;
}

export async function processFieldEditChunk(orgId: string, jobId: string): Promise<ChunkOutcome> {
  const [job] = await db.select().from(batchJobs)
    .where(and(eq(batchJobs.id, jobId), eq(batchJobs.orgId, orgId))).limit(1);
  if (!job) return { accepted: false, processedCount: 0, totalRows: 0, done: false, error: "Job not found" };
  if (job.status === "done") return { accepted: false, processedCount: job.processedCount ?? 0, totalRows: job.totalRows, done: true, status: "done" };

  const cursor = job.processedCount ?? 0;
  const claim = await claimChunk(jobId, cursor);
  if (!claim.claimed) {
    return { accepted: false, processedCount: claim.processedCount, totalRows: claim.totalRows, done: claim.status === "done", status: claim.status ?? undefined, busy: claim.busy };
  }

  try {
    const entity = getEntity(job.entityId);
    if (!entity?.qboEntity) throw new Error("Unknown entity");
    const token = await getOrgQboToken(job.orgId).catch(() => null);
    if (!token) throw new Error("QuickBooks is not connected for this organisation");

    const spec = ((job.input || {}) as any).fieldEdit || {};
    const ids: string[] = Array.isArray(spec.ids) ? spec.ids.map(String) : [];
    const setClassId: string | null = spec.setClassId ?? null;
    const setLocationId: string | null = spec.setLocationId ?? null;
    const setEmail: string | null = spec.setEmail ? String(spec.setEmail).trim() : null;
    const customFields: { definitionId: string; name?: string; value: string }[] =
      Array.isArray(spec.customFields) ? spec.customFields.filter((c: any) => c && c.definitionId) : [];

    if (!setClassId && !setLocationId && !setEmail && customFields.length === 0) {
      throw new Error("Nothing to change — pick at least one field to set.");
    }
    if (ids.length === 0) throw new Error("This edit's staged records were cleared (it was left idle too long). Re-select the remaining records to continue.");

    const total = ids.length;
    if (total !== job.totalRows) await db.update(batchJobs).set({ totalRows: total }).where(eq(batchJobs.id, jobId));

    if (cursor >= total) {
      await finishChunkCall(jobId, true);
      return { accepted: true, processedCount: cursor, totalRows: total, done: true, status: "done" };
    }

    const resolver = new RefResolver(token);
    const { classPerLine } = await resolver.company();

    const { processedTo } = await runChunkLoop(jobId, cursor, total, async (i) => {
      const id = ids[i];
      const rec = await qboReadOne(token, entity.qboEntity!, id);
      if (!rec) return { ok: false, row: i + 1, error: "Record no longer exists in QuickBooks" };

      // Fresh SyncToken from the live read — never a stale one.
      const payload: any = { Id: id, SyncToken: String(rec.SyncToken ?? "0"), sparse: true };

      if (setLocationId) payload.DepartmentRef = { value: setLocationId };
      if (setEmail) payload.BillEmail = { Address: setEmail };

      if (customFields.length) {
        const merged: any[] = Array.isArray(rec.CustomField) ? rec.CustomField.map((c: any) => ({ ...c })) : [];
        for (const cf of customFields) {
          const hit = merged.find((c: any) => String(c.DefinitionId) === String(cf.definitionId));
          if (hit) { hit.StringValue = cf.value; hit.Type = hit.Type || "StringType"; }
          else merged.push({ DefinitionId: String(cf.definitionId), Name: cf.name, Type: "StringType", StringValue: cf.value });
        }
        payload.CustomField = merged;
      }

      if (setClassId) {
        if (!classPerLine) {
          payload.ClassRef = { value: setClassId };
        } else {
          const linked = Array.isArray(rec.LinkedTxn) && rec.LinkedTxn.some((l: any) => l?.TxnType === "Invoice");
          if (linked) {
            return { ok: false, row: i + 1, error: "Skipped — your company tracks Class per line, and this record is linked to an invoice. Updating its lines would break that link, so set the class in QuickBooks directly." };
          }
          payload.Line = (rec.Line || []).map((ln: any) => {
            const detailKey = Object.keys(ln).find((k) => /LineDetail$/.test(k));
            if (detailKey && ln[detailKey]) {
              return { ...ln, [detailKey]: { ...ln[detailKey], ClassRef: { value: setClassId } } };
            }
            return ln;
          });
        }
      }

      const res = await qboPost(token, entity.qboEntity!, payload, { operation: "update" });
      if (!res.ok) return { ok: false, row: i + 1, error: res.error };
      const rr = firstRecord(res.data);
      return { ok: true, row: i + 1, qboId: rr?.Id ?? id, docNumber: rr?.DocNumber };
    });

    const done = processedTo >= total;
    await finishChunkCall(jobId, done);

    const [fin] = await db.select({ sc: batchJobs.successCount, ec: batchJobs.errorCount })
      .from(batchJobs).where(eq(batchJobs.id, jobId)).limit(1);
    return { accepted: true, processedCount: processedTo, totalRows: total, done, status: done ? "done" : "running", successCount: fin?.sc ?? 0, errorCount: fin?.ec ?? 0 };
  } catch (e: any) {
    await releaseLeaseOnError(jobId);
    return { accepted: false, processedCount: cursor, totalRows: job.totalRows, done: false, error: e?.message || "Chunk failed" };
  }
}
