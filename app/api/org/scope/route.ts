/**
 * GET /api/org/scope — the org set the current view spans, with names.
 * In group mode this is every branch in the active group; otherwise the single
 * active org. Lets the UI label rows by branch and offer an Organization filter.
 */

import { db } from "@/db";
import { organisations } from "@/db/schema";
import { requireReadScope, ok } from "@/lib/api";
import { inArray } from "drizzle-orm";

export async function GET() {
  const { error, orgIds, isGroup, groupId } = await requireReadScope();
  if (error) return error;

  const orgs = orgIds.length
    ? await db.select({ id: organisations.id, name: organisations.name, displayName: organisations.displayName })
        .from(organisations).where(inArray(organisations.id, orgIds))
    : [];

  return ok({
    isGroup,
    groupId,
    orgs: orgs.map((o) => ({ id: o.id, name: o.displayName || o.name })),
  });
}
