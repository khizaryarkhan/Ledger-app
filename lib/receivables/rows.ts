/**
 * The canonical invoice row shape for the mobile receivables screens.
 *
 * The list, the Today queue and the alerts feed all draw the same row, so the
 * mapping lives here rather than being re-derived per endpoint. When it drifted
 * (one endpoint returning `stage` as a key, another as a label) the app had to
 * special-case each — the row component should be able to trust one shape.
 */

import { db } from "@/db";
import { invoiceDisputes } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { resolveStageLabel, type Stage } from "@/lib/stages";
import { openBalance, isOpenInvoice, isCreditMemo, daysOverdue } from "./rep-scope";

const r2 = (n: number) => Math.round(n * 100) / 100;

export type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  projectName: string | null;
  currency: string;
  total: number;
  balance: number;
  dueDate: string;
  daysOverdue: number;
  stage: string;
  stageLabel: string;
  paymentStatus: string;
  promiseDate: string | null;
  promiseBroken: boolean;
  disputeReason: string | null;
  hasOpenDispute: boolean;
  escalatedTo: string | null;
  isCreditMemo: boolean;
  isOpen: boolean;
};

/** Which of these invoices have an unresolved dispute — one query, not one per row. */
export async function openDisputeIds(orgId: string, invoiceIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!invoiceIds.length) return out;
  const rows = await db.select({ invoiceId: invoiceDisputes.invoiceId, status: invoiceDisputes.status })
    .from(invoiceDisputes)
    .where(and(eq(invoiceDisputes.orgId, orgId), inArray(invoiceDisputes.invoiceId, invoiceIds)));
  for (const d of rows) if (d.status === "Open" || d.status === "Under Review") out.add(d.invoiceId);
  return out;
}

export function toInvoiceRow(
  inv: any,
  custName: string | null,
  projName: string | null,
  stages: Stage[],
  hasOpenDispute: boolean,
): InvoiceRow {
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    customerId: inv.customerId,
    customerName: custName ?? "—",
    projectName: projName ?? null,
    currency: inv.currency,
    total: r2(Number(inv.total || 0)),
    balance: r2(openBalance(inv)),
    dueDate: inv.dueDate,
    daysOverdue: daysOverdue(inv.dueDate),
    stage: inv.collectionStage || "New",
    stageLabel: resolveStageLabel(inv.collectionStage || "New", stages),
    paymentStatus: inv.paymentStatus,
    promiseDate: inv.promiseDate ?? null,
    // A promise whose date has passed is a BROKEN commitment, not a
    // commitment — the board shows it in red and so should the app.
    promiseBroken: !!inv.promiseDate && daysOverdue(inv.promiseDate) > 0,
    disputeReason: inv.disputeReason ?? null,
    hasOpenDispute,
    escalatedTo: inv.escalatedToName ?? null,
    isCreditMemo: isCreditMemo(inv),
    isOpen: isOpenInvoice(inv),
  };
}
