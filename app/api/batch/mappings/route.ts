/**
 * Saved column mappings for recurring imports.
 * GET  /api/batch/mappings?entity=invoice  → list saved mappings for org+entity
 * POST /api/batch/mappings                  → save { entityId, name, mapping }
 */

import { db } from "@/db";
import { batchImportMappings } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const entity = new URL(req.url).searchParams.get("entity") || "";
  const conds = [eq(batchImportMappings.orgId, orgId!)];
  if (entity) conds.push(eq(batchImportMappings.entityId, entity));

  const rows = await db
    .select({ id: batchImportMappings.id, name: batchImportMappings.name, entityId: batchImportMappings.entityId, mapping: batchImportMappings.mapping, updatedAt: batchImportMappings.updatedAt })
    .from(batchImportMappings)
    .where(and(...conds))
    .orderBy(desc(batchImportMappings.updatedAt));

  return ok({ mappings: rows });
}

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id as string;

  const body = await req.json().catch(() => null);
  if (!body) return bad("Invalid JSON body");
  const entityId = String(body.entityId || "");
  const name = String(body.name || "").trim();
  const mapping = body.mapping;
  if (!entityId || !name) return bad("Entity and name are required");
  if (!mapping || typeof mapping !== "object") return bad("A mapping is required");

  // Upsert by (org, entity, name): overwrite if it already exists.
  const [existing] = await db.select({ id: batchImportMappings.id }).from(batchImportMappings)
    .where(and(eq(batchImportMappings.orgId, orgId!), eq(batchImportMappings.entityId, entityId), eq(batchImportMappings.name, name)))
    .limit(1);

  if (existing) {
    await db.update(batchImportMappings).set({ mapping, updatedAt: new Date() }).where(eq(batchImportMappings.id, existing.id));
    return ok({ id: existing.id, updated: true });
  }

  const [row] = await db.insert(batchImportMappings)
    .values({ orgId: orgId!, entityId, name, mapping, createdBy: userId })
    .returning({ id: batchImportMappings.id });
  return ok({ id: row.id, created: true });
}
