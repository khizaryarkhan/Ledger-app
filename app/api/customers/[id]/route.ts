import { db } from "@/db";
import { customers } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq, and } from "drizzle-orm";
import { logEvent } from "@/lib/audit";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const [c] = await db.select().from(customers).where(and(eq(customers.id, params.id), eq(customers.orgId, orgId!))).limit(1);
  if (!c) return bad("Not found", 404);
  return ok(c);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  const [before] = await db.select().from(customers).where(and(eq(customers.id, params.id), eq(customers.orgId, orgId!))).limit(1);
  if (!before) return bad("Not found", 404);

  const body = await req.json();
  // Allowlist editable columns — never let the client rewrite id/orgId/createdAt
  // or non-columns via a blind spread of the loaded row.
  const EDITABLE = [
    "name", "code", "country", "currency", "paymentTerms", "taxNumber",
    "riskRating", "status", "creditLimit", "accountOwnerId", "collectionOwnerId",
    "repId", "regionId", "notes", "paymentMethod", "phone", "mobile", "email",
    "website", "firstName", "lastName", "companyName", "addressStreet",
    "addressLine2", "addressCity", "addressState", "addressPostcode", "chaseByProject",
  ] as const;
  const set: Record<string, any> = { updatedAt: new Date() };
  for (const k of EDITABLE) if (k in body) set[k] = body[k];
  const [updated] = await db.update(customers)
    .set(set)
    .where(and(eq(customers.id, params.id), eq(customers.orgId, orgId!)))
    .returning();
  if (!updated) return bad("Not found", 404);

  const actorId   = (session?.user as any)?.id   ?? null;
  const actorName = (session?.user as any)?.name ?? null;
  const base = { orgId: orgId!, customerId: updated.id, actorId, actorName };

  // ── Chase mode changed ─────────────────────────────────────────────────────
  if (body.chaseByProject !== undefined && body.chaseByProject !== before.chaseByProject) {
    await logEvent({
      ...base,
      eventType: "chase_mode_changed",
      meta: {
        chaseByProject: body.chaseByProject,
        mode: body.chaseByProject ? "By Project" : "By Customer",
        customerName: updated.name,
      },
    });
  }

  // ── Programme toggled (autoReminders field) ───────────────────────────────
  if (body.autoReminders !== undefined && body.autoReminders !== (before as any).autoReminders) {
    await logEvent({
      ...base,
      eventType: "programme_toggled",
      meta: {
        enabled: body.autoReminders,
        customerName: updated.name,
      },
    });
  }

  return ok(updated);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  await db.delete(customers).where(and(eq(customers.id, params.id), eq(customers.orgId, orgId!)));
  return ok({ ok: true });
}
