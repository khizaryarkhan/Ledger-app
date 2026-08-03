/**
 * GET /api/batch/template?entity=invoice — download a spreadsheet template.
 *
 * Sheet 1 "Template" — header row only; this is what the user fills in and uploads.
 * Sheet 2 "Sample (Your QuickBooks)" — the last ~10 real records for this entity,
 * mapped into the same columns, as a safe read-only reference. Populated only when
 * QuickBooks is connected and the entity is queryable; otherwise the template is
 * returned with headers alone.
 */

import * as XLSX from "xlsx";
import { requireOrg, bad } from "@/lib/api";
import { getEntity } from "@/lib/batch/entities";
import { getOrgQboToken } from "@/lib/qbo-token";
import { qboQueryTop } from "@/lib/batch/qbo-client";
import { recordToRow } from "@/lib/batch/downloader";
import { RefResolver } from "@/lib/batch/ref-resolver";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const entityId = new URL(req.url).searchParams.get("entity") || "";
  const entity = getEntity(entityId);
  if (!entity) return bad("Unknown entity", 404);

  const columns = entity.columns.map((c) => c.trim());

  const wb = XLSX.utils.book_new();

  // Sheet 1 — clean import template (headers only).
  const templateWs = XLSX.utils.aoa_to_sheet([columns]);
  XLSX.utils.book_append_sheet(wb, templateWs, "Template");

  // Sheet 2 — real sample rows from the org's QuickBooks, best-effort.
  if (entity.qboReadName) {
    try {
      const token = await getOrgQboToken(orgId!).catch(() => null);
      if (token) {
        const where = entity.qboExtraWhere || "";
        const records = await qboQueryTop(token, entity.qboReadName, 10, where);
        if (records.length > 0) {
          const resolver = new RefResolver(token);
          if (entity.reverseRefs?.length) await resolver.preload(entity.reverseRefs);

          // Expand each record into its full set of template rows (one per line).
          const mappedRows: Record<string, any>[] = [];
          for (const r of records) {
            const rows = entity.toRows
              ? await entity.toRows(r, resolver)
              : [recordToRow(entity, r)];
            mappedRows.push(...rows);
          }
          const aoa = [columns, ...mappedRows.map((row) => columns.map((c) => row[c] ?? ""))];
          const sampleWs = XLSX.utils.aoa_to_sheet(aoa);
          XLSX.utils.book_append_sheet(wb, sampleWs, "Sample (Your QuickBooks)");
        }
      }
    } catch {
      // Ignore — sample data is a convenience, never block the template download.
    }
  }

  const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${entity.id}-template.xlsx"`,
    },
  });
}
