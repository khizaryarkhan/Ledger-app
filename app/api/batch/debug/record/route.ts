/**
 * GET /api/batch/debug/record?entity=deposit&id=148
 *
 * Read-only diagnostic: returns the RAW QuickBooks JSON for one record,
 * exactly as QBO's API returns it — no shaping, no column mapping. Used to
 * inspect what a transaction's Line array actually contains after an Update
 * (e.g. whether a line carries a LinkedTxn to a Payment, which behaves
 * differently from a plain manual line and isn't visible from the sheet
 * columns or the QuickBooks UI at a glance).
 *
 * Org-scoped (requireOrg), read-only, no mutation risk.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { getEntity } from "@/lib/batch/entities";
import { getOrgQboToken } from "@/lib/qbo-token";
import { qboReadOne } from "@/lib/batch/qbo-client";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const url = new URL(req.url);
  const entityId = url.searchParams.get("entity") || "";
  const id = url.searchParams.get("id") || "";
  if (!entityId || !id) return bad("Pass ?entity=<entity id>&id=<QuickBooks Id>");

  const entity = getEntity(entityId);
  if (!entity?.qboEntity) return bad("Unknown entity", 404);

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected for this organisation", 400);

  const record = await qboReadOne(token, entity.qboEntity, id);
  if (!record) return bad("Record not found", 404);

  return ok({ record });
}
