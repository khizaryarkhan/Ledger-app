/**
 * GET /api/batch/entities — the Batch Functions entity registry (metadata only).
 * Drives the entity pickers in Upload / Download / Delete / Modify.
 */

import { requireOrg, ok } from "@/lib/api";
import { ENTITIES, ENTITY_GROUPS } from "@/lib/batch/entities";

export async function GET() {
  const { error } = await requireOrg();
  if (error) return error;

  const entities = ENTITIES.map((e) => ({
    id: e.id,
    label: e.label,
    group: e.group,
    supports: e.supports,
    note: e.note ?? null,
    columns: e.columns,
    hasDateFilter: !!e.dateColumn,
    hasRefNumberFilter: !!e.refNumberColumn,
  }));

  return ok({ entities, groups: ENTITY_GROUPS });
}
