/**
 * POST /api/batch/bulk-edit/apply
 * Body: { entity, ids: string[], setClassId?, setLocationId? }
 *
 * Stages a batch job and hands off to the chunked engine
 * (lib/batch/fieldedit-chunk-runner.ts) — durable and resumable, same as
 * upload/delete. This used to `await runFieldEditJob(...)` INLINE, which
 * blocked the whole HTTP response until every record was edited: the client
 * already had a poll() loop wired up for this route, but it was dead code —
 * by the time the first poll fired, the response (and thus the job) had
 * always already finished, since nothing returned until it did. A large
 * selection just meant a long-hanging request against a 60s ceiling with no
 * progress shown, and the same silent-kill risk as the old delete path if it
 * ran past that ceiling. The field-edit semantics themselves (minimal sparse
 * updates, class-per-line safety against progress-invoicing links) are
 * unchanged.
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { getEntity } from "@/lib/batch/entities";
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

  const entity = getEntity(String(body.entity || ""));
  if (!entity?.qboEntity) return bad("Unknown entity", 404);
  if (!entity.supports?.modify) return bad("This entity can't be bulk-edited", 400);

  const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
  if (ids.length === 0) return bad("Select at least one record");

  const setClassId: string | null = body.setClassId ? String(body.setClassId) : null;
  const setLocationId: string | null = body.setLocationId ? String(body.setLocationId) : null;
  const customFields: { definitionId: string; name?: string; value: string }[] =
    Array.isArray(body.customFields)
      ? body.customFields
          .filter((c: any) => c && c.definitionId && c.value != null && String(c.value) !== "")
          .map((c: any) => ({ definitionId: String(c.definitionId), name: c.name ? String(c.name) : undefined, value: String(c.value) }))
      : [];

  // QBO's BillEmail.Address holds ONE OR MORE addresses separated by commas
  // (max 100 chars total). Accept a comma list, validate each, and normalise
  // the separators to a single comma the way QBO stores them.
  const EMAIL_MAX = 100;
  let setEmail: string | null = null;
  if (body.setEmail && String(body.setEmail).trim()) {
    const parts = String(body.setEmail).split(",").map((s) => s.trim()).filter(Boolean);
    const invalid = parts.find((p) => !/^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/.test(p));
    if (invalid) return bad(`"${invalid}" is not a valid email address`);
    setEmail = parts.join(",");
    if (setEmail.length > EMAIL_MAX) {
      return bad(`QuickBooks limits the email field to ${EMAIL_MAX} characters — you have ${setEmail.length}. Use fewer or shorter addresses.`);
    }
  }

  if (!setClassId && !setLocationId && !setEmail && customFields.length === 0) {
    return bad("Pick at least one field to set (Class, Location, Email or a custom field)");
  }

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected for this organisation", 400);

  const changed = [
    setClassId ? "Class" : null,
    setLocationId ? "Location" : null,
    setEmail ? "Email" : null,
    customFields.length ? `${customFields.length} custom field${customFields.length === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" + ");

  const [job] = await db.insert(batchJobs).values({
    orgId: orgId!,
    userId,
    operation: "modify",
    entityId: entity.id,
    // The "Bulk edit" label prefix, not the operation column, is what tells
    // Job History apart from a sheet-based update — see dispatchChunk in
    // inngest/functions/batch.ts, which routes on input.fieldEdit instead.
    entityLabel: `Bulk edit (${changed}) — ${entity.label}`,
    status: "running",
    totalRows: ids.length,
    processedCount: 0,
    leaseUntil: new Date(), // chunk-resumable marker — see upload/start route
    input: { fieldEdit: { ids, setClassId, setLocationId, setEmail, customFields } },
  }).returning({ id: batchJobs.id });

  await inngest.send({ name: "batch/chunk-run", data: { jobId: job.id, orgId: orgId! } }).catch(() => {});

  return ok({ jobId: job.id, total: ids.length, background: true });
}
