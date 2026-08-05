/**
 * POST /api/batch/scheduled/[id]/run — run a scheduled import now (on demand).
 */

import { db } from "@/db";
import { scheduledImports } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";
import { inngest } from "@/lib/inngest";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [sched] = await db.select({ id: scheduledImports.id }).from(scheduledImports)
    .where(and(eq(scheduledImports.id, params.id), eq(scheduledImports.orgId, orgId!)))
    .limit(1);
  if (!sched) return bad("Schedule not found", 404);

  await inngest.send({ name: "batch/scheduled-run", data: { scheduleId: sched.id } });
  return ok({ queued: true });
}
