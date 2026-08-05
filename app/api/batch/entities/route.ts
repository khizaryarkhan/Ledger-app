/**
 * GET /api/batch/entities — the Data Studio entity registry for the org's
 * connected accounting system (QuickBooks or Xero). Drives the entity pickers.
 */

import { requireOrg, ok } from "@/lib/api";
import { ENTITIES, ENTITY_GROUPS } from "@/lib/batch/entities";
import { XERO_ENTITIES, XERO_GROUPS } from "@/lib/batch/xero/registry";
import { detectProvider } from "@/lib/batch/provider";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const provider = await detectProvider(orgId!);

  if (provider === "xero") {
    const entities = XERO_ENTITIES.map((e) => ({
      id: e.id, label: e.label, group: e.group, supports: e.supports,
      note: e.note ?? null, columns: e.columns,
      hasDateFilter: e.hasDateFilter, hasRefNumberFilter: false,
    }));
    return ok({ provider: "xero", entities, groups: XERO_GROUPS });
  }

  // Default: QuickBooks (also when nothing is connected — UI shows a connect hint).
  const entities = ENTITIES.map((e) => ({
    id: e.id, label: e.label, group: e.group, supports: e.supports,
    note: e.note ?? null, columns: e.columns,
    hasDateFilter: !!e.dateColumn, hasRefNumberFilter: !!e.refNumberColumn,
  }));
  return ok({ provider: provider ?? "qbo", entities, groups: ENTITY_GROUPS });
}
