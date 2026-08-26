/**
 * POST /api/mobile/receivables/invoices/[id]/note   { body }
 *   → logs an internal note against the invoice.
 *
 * The web portal posts these straight to /api/communications, which means the
 * client has to supply customerId/projectId/direction/channel/sender itself —
 * five fields a phone shouldn't have to know or be trusted with. Here the
 * invoice is the only input: everything else is derived server-side from the
 * row, so a note lands in the same chatbox with the same shape as one typed at
 * a desk, and no client can mislabel one.
 */

import { db } from "@/db";
import { invoices, communications } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq } from "drizzle-orm";
import { isInvoiceInScope } from "@/lib/receivables/rep-scope";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  const userId = (session!.user as any)?.id ?? null;
  if (!(await isInvoiceInScope(orgId!, userId, params.id))) return bad("Invoice not found", 404);

  let payload: any = {};
  try { payload = await req.json(); } catch { /* empty body → caught below */ }
  const text = String(payload?.body ?? "").trim();
  if (!text) return bad("Note text is required");
  if (text.length > 4000) return bad("Note is too long (4000 characters max)");

  const [inv] = await db.select({ customerId: invoices.customerId, projectId: invoices.projectId, stage: invoices.collectionStage })
    .from(invoices).where(and(eq(invoices.orgId, orgId!), eq(invoices.id, params.id))).limit(1);
  if (!inv) return bad("Invoice not found", 404);

  const [created] = await db.insert(communications).values({
    orgId: orgId!,
    customerId: inv.customerId,
    projectId: inv.projectId ?? null,
    invoiceId: params.id,
    direction: "Outbound",
    channel: "Note",
    subject: String(payload?.subject ?? "Note").slice(0, 200),
    body: text,
    sender: (session!.user as any)?.name ?? null,
    matchedBy: "Mobile",
    authorId: userId,
    stageAtSend: inv.stage ?? null,
  }).returning();

  return ok({ note: created });
}
