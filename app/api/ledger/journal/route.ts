/**
 * GET  /api/ledger/journal          → list entries (newest first) with lines
 * POST /api/ledger/journal          → post a manual journal entry
 *
 * All the accounting invariants (balance, XOR debit/credit, account checks)
 * live in lib/ledger — this route is a thin, org-scoped wrapper.
 */

import { db } from "@/db";
import { journalEntries, journalLines, accounts } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, desc, inArray } from "drizzle-orm";
import { z } from "zod";
import { postJournalEntry, LedgerValidationError } from "@/lib/ledger";

const LineSchema = z.object({
  accountId:    z.string().uuid(),
  debit:        z.number().min(0).optional(),
  credit:       z.number().min(0).optional(),
  description:  z.string().max(1000).nullable().optional(),
  classId:      z.string().uuid().nullable().optional(),
  locationId:   z.string().uuid().nullable().optional(),
  costCentreId: z.string().uuid().nullable().optional(),
  customerId:   z.string().uuid().nullable().optional(),
  projectId:    z.string().uuid().nullable().optional(),
  nameType:     z.enum(["Customer", "Vendor", "Employee"]).nullable().optional(),
  nameId:       z.string().uuid().nullable().optional(),
  nameLabel:    z.string().max(255).nullable().optional(),
  currency:     z.string().max(8).nullable().optional(),
  exchangeRate: z.number().positive().nullable().optional(),
  fxDebit:      z.number().min(0).nullable().optional(),
  fxCredit:     z.number().min(0).nullable().optional(),
});

const EntrySchema = z.object({
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memo:      z.string().max(2000).optional(),
  lines:     z.array(LineSchema).min(2).max(100),
});

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

  const entries = await db.select().from(journalEntries)
    .where(eq(journalEntries.orgId, orgId!))
    .orderBy(desc(journalEntries.entryNumber))
    .limit(limit);

  const ids = entries.map(e => e.id);
  const lines = ids.length
    ? await db.select().from(journalLines)
        .where(and(eq(journalLines.orgId, orgId!), inArray(journalLines.entryId, ids)))
    : [];
  const linesByEntry: Record<string, any[]> = {};
  for (const l of lines) (linesByEntry[l.entryId] ??= []).push(l);
  Object.values(linesByEntry).forEach(list => list.sort((a, b) => a.lineNo - b.lineNo));

  return ok(entries.map(e => ({ ...e, lines: linesByEntry[e.id] ?? [] })));
}

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  let data: z.infer<typeof EntrySchema>;
  try { data = EntrySchema.parse(await req.json()); }
  catch (e: any) { return bad(e?.issues?.[0]?.message ?? "Invalid request"); }

  // Control-account lines must name their party — A/R needs a Customer, A/P a
  // Vendor — or the subledgers can't reconcile (this is how QBO enforces it).
  const acctIds = [...new Set(data.lines.map(l => l.accountId))];
  const accts = await db.select({ id: accounts.id, type: accounts.type })
    .from(accounts).where(and(eq(accounts.orgId, orgId!), inArray(accounts.id, acctIds)));
  const typeById = new Map(accts.map(a => [a.id, a.type]));
  for (const l of data.lines) {
    const t = typeById.get(l.accountId);
    const named = !!(l.nameLabel && l.nameLabel.trim());
    if (t === "Accounts Receivable" && !(l.nameType === "Customer" && named)) return bad("An Accounts Receivable line needs a Customer name.");
    if (t === "Accounts Payable" && !(l.nameType === "Vendor" && named)) return bad("An Accounts Payable line needs a Vendor name.");
  }

  try {
    const entry = await postJournalEntry({
      orgId: orgId!,
      entryDate: data.entryDate,
      memo: data.memo ?? null,
      sourceType: "Manual",
      createdBy: (session?.user as any)?.id ?? null,
      lines: data.lines as any, // zod guarantees the shape; strict:false makes the inferred type all-optional
    });
    return ok(entry);
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[ledger] post failed:", e);
    return bad("Failed to post journal entry", 500);
  }
}
