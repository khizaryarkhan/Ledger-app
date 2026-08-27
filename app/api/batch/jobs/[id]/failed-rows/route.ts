/**
 * GET /api/batch/jobs/[id]/failed-rows — download ONLY the rows that failed in a
 * batch import/update, as a ready-to-fix, ready-to-reimport spreadsheet.
 *
 * This is the answer to "some rows failed — now what?": instead of re-uploading
 * the whole file (which would duplicate every row that already succeeded), the
 * user gets just the failures, each with the exact error in a trailing "Import
 * Error" column. They fix those rows and re-import that file alone.
 *
 * Only works for jobs run after the engine started retaining failed-row data
 * (older jobs still show row + error in the UI, just can't be re-downloaded).
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrg, bad } from "@/lib/api";
import { getEntity } from "@/lib/batch/entities";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [job] = await db.select().from(batchJobs)
    .where(and(eq(batchJobs.id, params.id), eq(batchJobs.orgId, orgId!)))
    .limit(1);
  if (!job) return bad("Job not found", 404);

  const results: any[] = Array.isArray(job.results) ? (job.results as any[]) : [];
  const failed = results.filter((r) => r && r.ok === false);
  if (failed.length === 0) return bad("This job had no failed rows.", 404);

  // Failed rows carry their original source rows in `data` (added with the
  // failed-row-retention fix). Jobs from before that won't have it.
  const withData = failed.filter((r) => Array.isArray(r.data) && r.data.length > 0);
  if (withData.length === 0) {
    return bad("The failed rows for this job can't be re-downloaded — it ran before failed-row capture was added. Re-run the import to get a downloadable error file.", 422);
  }

  // Column order from the entity template when known; else the union of keys
  // seen across the failed rows (provider-agnostic fallback).
  const entity = getEntity(job.entityId);
  let headers: string[];
  if (entity?.columns?.length) {
    headers = entity.columns.map((c) => c.trim());
  } else {
    const seen = new Set<string>();
    for (const r of withData) for (const row of r.data) for (const k of Object.keys(row || {})) seen.add(k);
    headers = [...seen];
  }
  const ERROR_COL = "Import Error";

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Failed rows", { views: [{ state: "frozen", ySplit: 1 }] });

  const headerRow = ws.addRow([...headers, ERROR_COL]);
  headerRow.eachCell((c: any, col: number) => {
    c.font = { name: "Calibri", bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: col === headers.length + 1 ? "FFFFE1E1" : "FFF0F0F0" } };
    c.border = { bottom: { style: "thin" } };
  });

  for (const r of withData) {
    for (const row of r.data as Record<string, any>[]) {
      const cells = headers.map((h) => {
        const v = row[h] ?? row[h + " "] ?? row[h.trim()];
        return v == null ? "" : v;
      });
      cells.push(String(r.error ?? "Failed"));
      ws.addRow(cells);
    }
  }
  ws.columns.forEach((col: any, i: number) => { col.width = i === headers.length ? 48 : 22; });

  const buf = await wb.xlsx.writeBuffer();
  const fname = `${job.entityId}-failed-rows.xlsx`;
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  });
}
