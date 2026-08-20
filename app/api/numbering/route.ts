/**
 * GET  /api/numbering               → the per-type number series config
 * GET  /api/numbering?peek=Journal  → the next number for one type (no consume)
 * PATCH /api/numbering               → update a series (prefix / next no / padding)
 *
 * Outside /api/accounting to avoid the [entity] dynamic-route collision.
 */

import { db } from "@/db";
import { documentSequences } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq } from "drizzle-orm";
import { DOC_TYPES, DocType, peekDocNumber, formatDocNumber } from "@/lib/accounting/numbering";
import { z } from "zod";

const TYPES = new Set(DOC_TYPES.map(d => d.type));

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const peek = new URL(req.url).searchParams.get("peek");
  if (peek) {
    if (!TYPES.has(peek as DocType)) return bad("Unknown document type", 400);
    return ok({ docNumber: await peekDocNumber(orgId!, peek as DocType) });
  }

  // Merge stored rows over the defaults so every type is always present.
  const rows = await db.select().from(documentSequences).where(eq(documentSequences.orgId, orgId!));
  const byType = new Map(rows.map(r => [r.docType, r]));
  return ok(DOC_TYPES.map(d => {
    const r = byType.get(d.type);
    const prefix = r?.prefix ?? d.prefix;
    const nextNo = r?.nextNo ?? 1;
    const padding = r?.padding ?? d.padding;
    return { type: d.type, label: d.label, prefix, nextNo, padding, preview: formatDocNumber(prefix, nextNo, padding) };
  }));
}

const PatchSchema = z.object({
  type:    z.string(),
  prefix:  z.string().max(16),
  nextNo:  z.number().int().min(1).max(100_000_000),
  padding: z.number().int().min(0).max(12),
});

export async function PATCH(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);

  let data: z.infer<typeof PatchSchema>;
  try { data = PatchSchema.parse(await req.json()); }
  catch (e: any) { return bad(e?.issues?.[0]?.message ?? "Invalid request"); }
  if (!TYPES.has(data.type as DocType)) return bad("Unknown document type", 400);

  const [row] = await db.insert(documentSequences)
    .values({ orgId: orgId!, docType: data.type, prefix: data.prefix, nextNo: data.nextNo, padding: data.padding })
    .onConflictDoUpdate({
      target: [documentSequences.orgId, documentSequences.docType],
      set: { prefix: data.prefix, nextNo: data.nextNo, padding: data.padding, updatedAt: new Date() },
    })
    .returning();
  return ok({ type: row.docType, prefix: row.prefix, nextNo: row.nextNo, padding: row.padding, preview: formatDocNumber(row.prefix, row.nextNo, row.padding) });
}
