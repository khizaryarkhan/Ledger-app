/**
 * Runs one scheduled import: reads the configured Google Sheet, creates a
 * batch_jobs row with the rows staged, and enqueues the normal commit worker.
 * Reuses the entire Data Studio import pipeline.
 */

import { db } from "@/db";
import { batchJobs, scheduledImports } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getEntity } from "./entities";
import { normalizeRows, groupDocs, autoMap } from "./engine";
import { getValidSheetsToken, fetchSheetValues } from "@/lib/google-sheets";
import { inngest } from "@/lib/inngest";

export async function runScheduledImport(scheduleId: string): Promise<void> {
  const [sched] = await db.select().from(scheduledImports).where(eq(scheduledImports.id, scheduleId)).limit(1);
  if (!sched || !sched.active) return;

  const entity = getEntity(sched.entityId);
  if (!entity?.build) return;

  const stamp = () => db.update(scheduledImports).set({ lastRunAt: new Date(), updatedAt: new Date() }).where(eq(scheduledImports.id, scheduleId));

  const token = await getValidSheetsToken(sched.orgId);
  if (!token) { await stamp(); return; } // Google Sheets not connected — skip quietly

  let rows: Record<string, any>[] = [];
  let headers: string[] = [];
  try {
    const data = await fetchSheetValues(token.accessToken, sched.spreadsheetId, sched.sheetRange);
    rows = data.rows; headers = data.headers;
  } catch {
    await stamp();
    return;
  }
  if (rows.length === 0) { await stamp(); return; }

  // Use the saved mapping, or auto-map the sheet's headers to the entity columns.
  let mapping = (sched.mapping as Record<string, string>) || {};
  if (Object.keys(mapping).length === 0) mapping = autoMap(headers, entity);
  const docCount = groupDocs(normalizeRows(rows, mapping), entity).length;

  const [job] = await db.insert(batchJobs).values({
    orgId: sched.orgId,
    userId: sched.createdBy,
    operation: "upload",
    entityId: entity.id,
    entityLabel: entity.label,
    fileName: `Scheduled — ${sched.name}`,
    status: "queued",
    totalRows: docCount,
    input: { mapping, overrides: {}, rawRows: rows },
  }).returning({ id: batchJobs.id });

  await db.update(scheduledImports).set({ lastRunAt: new Date(), lastJobId: job.id, updatedAt: new Date() }).where(eq(scheduledImports.id, scheduleId));
  await inngest.send({ name: "batch/commit", data: { jobId: job.id } });
}

const CADENCE_MS: Record<string, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

/** Return ids of active schedules that are due to run now. */
export async function findDueScheduleIds(now: number): Promise<string[]> {
  const all = await db.select().from(scheduledImports).where(eq(scheduledImports.active, true));
  return all.filter((s) => {
    const interval = CADENCE_MS[s.cadence] ?? CADENCE_MS.daily;
    if (!s.lastRunAt) return true;
    return now - new Date(s.lastRunAt).getTime() >= interval;
  }).map((s) => s.id);
}
