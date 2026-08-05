/**
 * GET  /api/batch/scheduled — list the org's scheduled Google Sheet imports.
 * POST /api/batch/scheduled — create one { entityId, name, sheetUrl, sheetRange, mapping, cadence }.
 */

import { db } from "@/db";
import { scheduledImports } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";
import { getEntity } from "@/lib/batch/entities";
import { parseSpreadsheetId } from "@/lib/google-sheets";

const CADENCES = ["hourly", "daily", "weekly"];

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const rows = await db.select().from(scheduledImports)
    .where(eq(scheduledImports.orgId, orgId!))
    .orderBy(desc(scheduledImports.createdAt));
  return ok({ schedules: rows });
}

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id as string;

  const body = await req.json().catch(() => null);
  if (!body) return bad("Invalid JSON body");

  const entity = getEntity(String(body.entityId || ""));
  if (!entity || !entity.supports.upload) return bad("Choose an importable entity");
  const name = String(body.name || "").trim();
  if (!name) return bad("A name is required");
  const spreadsheetId = parseSpreadsheetId(String(body.sheetUrl || ""));
  if (!spreadsheetId) return bad("A Google Sheet URL or id is required");
  const cadence = CADENCES.includes(body.cadence) ? body.cadence : "daily";
  const sheetRange = String(body.sheetRange || "Sheet1").trim() || "Sheet1";
  const mapping = body.mapping && typeof body.mapping === "object" ? body.mapping : {};

  const [row] = await db.insert(scheduledImports).values({
    orgId: orgId!, entityId: entity.id, name, spreadsheetId, sheetRange, mapping, cadence,
    createdBy: userId,
  }).returning({ id: scheduledImports.id });

  return ok({ id: row.id });
}
