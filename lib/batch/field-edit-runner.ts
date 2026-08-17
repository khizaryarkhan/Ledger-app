/**
 * Background runner for a Bulk Edit job — set Class and/or Location on a set of
 * existing QuickBooks transactions via MINIMAL SPARSE updates.
 *
 * Why this exists (and why it's separate from the sheet-based commit runner):
 * the sheet flow rebuilds a transaction's whole Line array and resends it, which
 * makes QBO recompute the txn and DROP its LinkedTxn (progress-invoicing links)
 * while Progress Invoicing is ON. This runner sends only the fields being
 * changed and never a rebuilt Line array for header-level fields, so links and
 * everything else are preserved. Class tracked per LINE is the only case that
 * must touch lines — and there we read-merge onto the existing lines and refuse
 * to touch a record that carries an invoice link.
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getEntity } from "./entities";
import { getOrgQboToken } from "@/lib/qbo-token";
import { qboPost, qboReadOne } from "./qbo-client";
import { RefResolver } from "./ref-resolver";

const PROGRESS_EVERY = 5;

export async function runFieldEditJob(jobId: string): Promise<void> {
  const [job] = await db.select().from(batchJobs).where(eq(batchJobs.id, jobId)).limit(1);
  if (!job || job.status === "done" || job.status === "failed") return;

  // Atomic claim — safe to trigger from both the inline kick and any worker.
  const claim = await db.update(batchJobs)
    .set({ status: "running" })
    .where(and(eq(batchJobs.id, jobId), eq(batchJobs.status, "queued")))
    .returning({ id: batchJobs.id });
  if (claim.length === 0) return;

  const fail = (error: string) =>
    db.update(batchJobs).set({ status: "failed", results: [{ ok: false, error }], input: null, finishedAt: new Date() })
      .where(eq(batchJobs.id, jobId));

  try {
    const entity = getEntity(job.entityId);
    if (!entity?.qboEntity) { await fail("Unknown entity"); return; }

    const token = await getOrgQboToken(job.orgId).catch(() => null);
    if (!token) { await fail("QuickBooks is not connected for this organisation"); return; }

    const spec = ((job.input || {}) as any).fieldEdit || {};
    const ids: string[] = Array.isArray(spec.ids) ? spec.ids.map(String) : [];
    const setClassId: string | null = spec.setClassId ?? null;
    const setLocationId: string | null = spec.setLocationId ?? null;
    if (!setClassId && !setLocationId) { await fail("Nothing to change — pick a Class and/or Location."); return; }
    if (ids.length === 0) { await fail("No records selected."); return; }

    const resolver = new RefResolver(token);
    const { classPerLine } = await resolver.company();

    const results: any[] = [];
    let successCount = 0;

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      try {
        const rec = await qboReadOne(token, entity.qboEntity, id);
        if (!rec) { results.push({ row: i + 1, ok: false, error: "Record no longer exists in QuickBooks" }); continue; }

        // Fresh SyncToken from the live read — never a stale one.
        const payload: any = { Id: id, SyncToken: String(rec.SyncToken ?? "0"), sparse: true };

        // Location is always a header field — safe, never touches lines.
        if (setLocationId) payload.DepartmentRef = { value: setLocationId };

        if (setClassId) {
          if (!classPerLine) {
            // Header-level class — safe, no Line array sent.
            payload.ClassRef = { value: setClassId };
          } else {
            // Per-line class requires sending Line. That would drop an
            // estimate↔invoice link, so refuse when the record carries one.
            const linked = Array.isArray(rec.LinkedTxn) && rec.LinkedTxn.some((l: any) => l?.TxnType === "Invoice");
            if (linked) {
              results.push({ row: i + 1, ok: false, error: "Skipped — your company tracks Class per line, and this record is linked to an invoice. Updating its lines would break that link, so set the class in QuickBooks directly." });
              continue;
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

        const res = await qboPost(token, entity.qboEntity, payload, { operation: "update" });
        if (res.ok) {
          const rr = firstRecord(res.data);
          successCount++;
          results.push({ row: i + 1, ok: true, qboId: rr?.Id ?? id, docNumber: rr?.DocNumber });
        } else {
          results.push({ row: i + 1, ok: false, error: res.error });
        }
      } catch (e: any) {
        results.push({ row: i + 1, ok: false, error: e?.message || "Update failed" });
      }

      if ((i + 1) % PROGRESS_EVERY === 0) {
        await db.update(batchJobs).set({ successCount, errorCount: i + 1 - successCount }).where(eq(batchJobs.id, jobId));
      }
    }

    await db.update(batchJobs).set({
      status: "done", successCount, errorCount: ids.length - successCount,
      results, input: null, finishedAt: new Date(),
    }).where(eq(batchJobs.id, jobId));
  } catch (e: any) {
    await fail(e?.message || "The bulk edit crashed unexpectedly").catch(() => {});
  }
}

function firstRecord(data: any) {
  if (!data) return null;
  const key = Object.keys(data).find((k) => k !== "time");
  return key ? data[key] : null;
}
