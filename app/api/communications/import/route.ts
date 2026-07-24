import { db } from "@/db";
import { communications, customers, projects } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { logEvent } from "@/lib/audit";

// Bulk import of Customer / Project level comments from the downloadable
// template. Each row carries hidden customerId/projectId columns for exact
// matching; customerName/projectName are a fallback for rows typed by hand.
const Row = z.object({
  customerId:   z.string().uuid().nullable().optional(),
  projectId:    z.string().uuid().nullable().optional(),
  customerName: z.string().optional(),
  projectName:  z.string().optional(),
  date:         z.string().optional(),
  body:         z.string().min(1),
});
const Schema = z.object({ rows: z.array(Row).max(5000) });

const norm = (s: string) => s.trim().toLowerCase();

export async function POST(req: Request) {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;
  try {
    const { rows } = Schema.parse(await req.json());

    // Load this org's customers & projects once — for ID validation and the
    // name-matching fallback. Never trust a client-supplied id without this.
    const [orgCusts, orgProjs] = await Promise.all([
      db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.orgId, orgId!)),
      db.select({ id: projects.id, name: projects.name, customerId: projects.customerId }).from(projects).where(eq(projects.orgId, orgId!)),
    ]);
    const custById   = new Map(orgCusts.map(c => [c.id, c]));
    const custByName  = new Map(orgCusts.map(c => [norm(c.name ?? ""), c]));
    const projById    = new Map(orgProjs.map(p => [p.id, p]));
    const projByName  = new Map(orgProjs.map(p => [`${p.customerId}|${norm(p.name ?? "")}`, p]));

    // Resolve each row to validated ids + timestamp.
    type Resolved = { customerId: string; projectId: string | null; body: string; sentAt?: Date };
    const resolved: Resolved[] = [];
    let invalid = 0;
    for (const r of rows) {
      let customerId = r.customerId && custById.has(r.customerId) ? r.customerId : null;
      let projectId  = r.projectId  && projById.has(r.projectId)  ? r.projectId  : null;
      if (projectId && !customerId) customerId = projById.get(projectId)!.customerId; // project implies its customer
      if (!customerId && r.customerName) customerId = custByName.get(norm(r.customerName))?.id ?? null;
      if (!customerId) { invalid++; continue; }
      if (!projectId && r.projectName) projectId = projByName.get(`${customerId}|${norm(r.projectName)}`)?.id ?? null;
      if (projectId && projById.get(projectId)!.customerId !== customerId) { invalid++; continue; } // project/customer mismatch
      const body = r.body.trim();
      if (!body) { invalid++; continue; }
      let sentAt: Date | undefined;
      if (r.date) {
        // Anchor a date-only value (YYYY-MM-DD) at noon so it can't slip a day
        // across timezones; pass anything else through as-is.
        const raw = /^\d{4}-\d{2}-\d{2}$/.test(r.date.trim()) ? r.date.trim() + "T12:00:00" : r.date;
        const d = new Date(raw);
        if (!isNaN(d.getTime())) sentAt = d;
      }
      resolved.push({ customerId, projectId, body, sentAt });
    }

    // Dedupe against comments already logged (append-only history: skip exact
    // repeats so re-uploading the template never doubles up).
    const existing = await db
      .select({ customerId: communications.customerId, projectId: communications.projectId, body: communications.body })
      .from(communications)
      .where(and(
        eq(communications.orgId, orgId!),
        isNull(communications.invoiceId),
        inArray(communications.matchedBy, ["ProjectNote", "CustomerNote"]),
      ));
    const keyOf = (customerId: string, projectId: string | null, body: string) =>
      `${projectId ? "P:" + projectId : "C:" + customerId}|${norm(body)}`;
    const seen = new Set(existing.filter(e => e.body).map(e => keyOf(e.customerId, e.projectId, e.body!)));

    const toInsert: Resolved[] = [];
    let dupes = 0;
    for (const r of resolved) {
      const k = keyOf(r.customerId, r.projectId, r.body);
      if (seen.has(k)) { dupes++; continue; }
      seen.add(k);
      toInsert.push(r);
    }

    const authorId = (session!.user as any).id as string;
    const sender   = (session!.user as any).name ?? "Import";

    // neon-http has no transactions — a single multi-row insert is atomic.
    if (toInsert.length) {
      await db.insert(communications).values(toInsert.map(r => ({
        orgId: orgId!,
        customerId: r.customerId,
        projectId: r.projectId,
        invoiceId: null,
        direction: "Outbound" as const,
        channel: "Note" as const,
        subject: r.projectId ? "Project note" : "Customer note",
        body: r.body,
        sender,
        matchedBy: r.projectId ? "ProjectNote" : "CustomerNote",
        authorId,
        ...(r.sentAt ? { sentAt: r.sentAt } : {}),
      })));
    }

    await logEvent({
      orgId: orgId!, eventType: "note_added", actorId: authorId, actorName: sender,
      meta: { source: "bulk-import", imported: toInsert.length, skippedDupes: dupes, skippedInvalid: invalid },
    });

    return ok({ imported: toInsert.length, skippedDupes: dupes, skippedInvalid: invalid });
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error(e);
    return bad("Failed to import comments", 500);
  }
}
