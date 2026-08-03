/**
 * GET /api/batch/template?entity=invoice — download a blank spreadsheet
 * template (header row only) for the given entity.
 */

import * as XLSX from "xlsx";
import { requireOrg, bad } from "@/lib/api";
import { getEntity } from "@/lib/batch/entities";

export async function GET(req: Request) {
  const { error } = await requireOrg();
  if (error) return error;

  const entityId = new URL(req.url).searchParams.get("entity") || "";
  const entity = getEntity(entityId);
  if (!entity) return bad("Unknown entity", 404);

  const ws = XLSX.utils.aoa_to_sheet([entity.columns]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, entity.label.slice(0, 31));
  const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${entity.id}-template.xlsx"`,
    },
  });
}
