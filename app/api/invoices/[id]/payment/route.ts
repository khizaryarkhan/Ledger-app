/**
 * POST /api/invoices/[id]/payment — record a payment against an invoice from
 * the collections UI (the Board's quick "record payment" action).
 *
 * This used to do `paid = (paid||0) + amount` directly on the `invoices` row:
 * no settlement link, no journal entry, no cash account. The money existed in
 * the collections UI and nowhere in the books — and it was silently discarded
 * the next time syncNativeInvoicePaid() recomputed `paid` from the links
 * graph (or, on a synced org, the next provider sync).
 *
 * It now posts a real Payment through lib/accounting/documents.ts, so the
 * money lands in the ledger (Dr Undeposited Funds / Cr A/R), a settlement
 * link is created, and `invoices.paid` is recomputed from that link by the
 * one writer that owns it. Nothing here writes `invoices.paid`.
 */

import { db } from "@/db";
import { invoices } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { logEvent } from "@/lib/audit";
import { postDocument } from "@/lib/accounting/documents";
import { systemAccountId, ensureSystemAccounts } from "@/lib/accounting/system-accounts";
import { LedgerValidationError } from "@/lib/ledger";

const Schema = z.object({
  amount: z.number().positive(),
  paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // YYYY-MM-DD
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;
  try {
    const { amount, paidDate } = Schema.parse(await req.json());
    const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, params.id), eq(invoices.orgId, orgId!))).limit(1);
    if (!inv) return bad("Invoice not found", 404);

    // A provider-owned invoice's ledger lives in QBO/Xero/Sage. Recording the
    // payment here would neither reach those books nor survive the next sync,
    // so say so plainly instead of writing a number that will vanish.
    if (!inv.journalEntryId) {
      const where = inv.source === "xero" ? "Xero" : inv.source === "sage" ? "Sage Intacct" : "QuickBooks";
      return bad(`This invoice is managed in ${where} — record the payment there and it will sync back here.`, 409);
    }
    if (!inv.customerId) return bad("This invoice has no customer, so a payment can't be applied to it.", 409);

    const date = paidDate || new Date().toISOString().slice(0, 10);

    // Deposit-to defaults to Undeposited Funds — the same thing QuickBooks does
    // when a payment is received without naming a bank account. The user can
    // move it to a real bank account later via a Deposit.
    await ensureSystemAccounts(orgId!);
    const undeposited = await systemAccountId(orgId!, "UndepositedFunds");
    if (!undeposited) return bad("No 'Undeposited Funds' account is set up to receive this payment.", 409);

    const posted = await postDocument(orgId!, {
      type: "Payment",
      date,
      partyId: inv.customerId,
      bankAccountId: undeposited,
      amount,
      allocations: [{ targetId: inv.journalEntryId, amount }],
    } as any, (session?.user as any)?.id ?? null);

    // postDocument → syncNativeInvoicePaid has already recomputed paid/status
    // from the links graph; re-read rather than trusting a local calculation.
    const [updated] = await db.select().from(invoices).where(and(eq(invoices.id, params.id), eq(invoices.orgId, orgId!))).limit(1);

    await logEvent({
      orgId:      orgId!,
      eventType:  "payment_recorded",
      customerId: inv.customerId,
      projectId:  inv.projectId ?? null,
      invoiceId:  inv.id,
      actorId:    (session?.user as any)?.id   ?? null,
      actorName:  (session?.user as any)?.name ?? null,
      meta: {
        amount,
        currency:  inv.currency,
        invoiceNo: inv.invoiceNumber,
        isPaid:    updated?.paymentStatus === "Paid",
        totalPaid: updated?.paid ?? null,
        invoiceTotal: inv.total,
        entryId:   posted?.id ?? null,
        docNumber: posted?.docNumber ?? null,
      },
    });

    return ok(updated);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[invoice payment]", e);
    return bad("Failed to record payment", 500);
  }
}
