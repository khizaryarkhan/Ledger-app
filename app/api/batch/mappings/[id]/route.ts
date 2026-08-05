/**
 * DELETE /api/batch/mappings/[id] — remove a saved column mapping.
 */

import { db } from "@/db";
import { batchImportMappings } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrg, ok } from "@/lib/api";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  await db.delete(batchImportMappings)
    .where(and(eq(batchImportMappings.id, params.id), eq(batchImportMappings.orgId, orgId!)));

  return ok({ deleted: true });
}
