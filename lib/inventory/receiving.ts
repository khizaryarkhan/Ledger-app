/**
 * Goods receipt — the receiving step between a Purchase Order and a Bill.
 *
 *   Dr  Inventory Asset (per item, at cost)
 *     Cr  GR/IR clearing  (Goods Received Not Invoiced — accrued payable)
 *
 * and a FIFO cost lot is created for each line (lot/batch no captured here, not
 * on the PO). A Bill created from the receipt later debits GR/IR to clear it to
 * Accounts Payable. Receiving can be linked to PO lines (advancing their
 * received qty) or done ad-hoc with no PO. neon-http has no transactions — the
 * balanced JE posts first, then lots + subledger rows commit against its id.
 */

import { db } from "@/db";
import { goodsReceipts, goodsReceiptLines, tradeDocumentLines, organisations } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { postJournalEntry, LedgerValidationError, type PostLine } from "@/lib/ledger";
import { ensureSystemAccounts, systemAccountId, INV_SUBTYPE } from "@/lib/accounting/system-accounts";
import { loadItemCostInfo, commitReceipt } from "@/lib/inventory/valuation";
import { nextDocNumber } from "@/lib/accounting/numbering";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const round4 = (n: number) => Math.round((Number(n) || 0) * 1e4) / 1e4;
const round6 = (n: number) => Math.round((Number(n) || 0) * 1e6) / 1e6;
const err = (m: string): never => { throw new LedgerValidationError(m); };

export type ReceiptLineInput = {
  itemId: string;
  poId?: string | null;
  poLineId?: string | null;
  description?: string | null;
  qtyBase: number;                 // received quantity in the item's base UoM
  unitCost: number;                // transaction-currency cost per base UoM
  lotNo?: string | null;
  expiryDate?: string | null;
};

export type ReceiptInput = {
  supplierId?: string | null;
  supplierLabel?: string | null;
  receiptDate: string;             // YYYY-MM-DD
  currency?: string | null;
  exchangeRate?: number | null;    // 1 {currency} = {rate} {home}
  notes?: string | null;
  lines: ReceiptLineInput[];
};

export async function postGoodsReceipt(orgId: string, input: ReceiptInput, actorId: string | null) {
  const date = input.receiptDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) err("A valid receipt date is required.");
  const rows = (input.lines ?? []).filter(l => l.itemId && Math.abs(Number(l.qtyBase) || 0) > 0);
  if (!rows.length) err("Add at least one line with an item and a received quantity.");

  const [org] = await db.select({ home: organisations.currency, mc: organisations.multicurrencyEnabled })
    .from(organisations).where(eq(organisations.id, orgId)).limit(1);
  const home = org?.home ?? "PKR";
  const currency = (input.currency?.trim() || home).toUpperCase();
  const rate = currency === home ? 1 : (Number(input.exchangeRate) || 0);
  if (currency !== home) {
    if (!org?.mc) err("Enable multi-currency before receiving in a foreign currency.");
    if (!(rate > 0)) err("Enter a valid exchange rate.");
  }

  await ensureSystemAccounts(orgId);
  const grirId = await systemAccountId(orgId, INV_SUBTYPE.grir);
  const invAssetId = await systemAccountId(orgId, INV_SUBTYPE.asset);
  if (!grirId) err("No Goods-Received-Not-Invoiced clearing account is set up.");

  const itemMap = await loadItemCostInfo(orgId, rows.map(r => r.itemId));

  // Build the balanced entry: Dr each item's inventory asset (home), Cr GR/IR.
  const lines: PostLine[] = [];
  let grirTotal = 0;
  const commits: { r: ReceiptLineInput; homeUnit: number; amount: number; assetAcct: string }[] = [];
  for (const r of rows) {
    const item = itemMap.get(r.itemId);
    if (!item) err(`Item ${r.itemId} not found.`);
    if (!item!.tracked) err(`${item!.name} isn't an inventory-tracked item — only tracked items can be received into stock.`);
    const assetAcct = item!.assetAccountId ?? invAssetId;
    if (!assetAcct) err(`No inventory asset account for ${item!.name}.`);
    const qty = round4(Math.abs(Number(r.qtyBase) || 0));
    const homeUnit = round6((Number(r.unitCost) || 0) * rate);
    const amount = round4(qty * homeUnit);
    if (amount <= 0) continue;
    lines.push({ accountId: assetAcct!, debit: round2(amount), description: `Received — ${item!.name}` });
    grirTotal = round2(grirTotal + round2(amount));
    commits.push({ r, homeUnit, amount, assetAcct: assetAcct! });
  }
  if (!commits.length) err("Nothing to receive — check quantities and costs.");
  lines.push({ accountId: grirId!, credit: grirTotal, description: "Goods received not invoiced" });

  const receiptNo = await nextDocNumber(orgId, "GoodsReceipt");
  const entry = await postJournalEntry({
    orgId, entryDate: date, memo: input.notes?.trim() || `Goods receipt ${receiptNo}`,
    series: "GoodsReceipt", sourceType: "GoodsReceipt", docNumber: receiptNo, createdBy: actorId,
    reference: input.supplierLabel ?? null, lines,
  });

  const [receipt] = await db.insert(goodsReceipts).values({
    orgId, receiptNo, supplierId: input.supplierId ?? null, supplierLabel: input.supplierLabel ?? null,
    receiptDate: date, currency, exchangeRate: rate.toString(), status: "Posted",
    entryId: entry.id, grirTotal: grirTotal.toString(), billedAmount: "0",
    notes: input.notes?.trim() || null, createdBy: actorId,
  } as any).returning({ id: goodsReceipts.id });
  const receiptId = receipt.id;

  // Create lots + subledger movements, receipt lines, and advance PO progress.
  for (const c of commits) {
    const item = itemMap.get(c.r.itemId)!;
    const qty = round4(Math.abs(Number(c.r.qtyBase) || 0));
    const lotId = await commitReceipt(orgId, {
      itemId: item.id, qty, unitCost: c.homeUnit, lotNo: c.r.lotNo ?? null, expiryDate: c.r.expiryDate ?? null,
      supplierId: input.supplierId ?? null, sourceType: "purchase", receivedDate: date,
      refType: "GoodsReceipt", refId: entry.id, entryId: entry.id, createdBy: actorId, note: c.r.description ?? null,
    }).catch(e => { console.error("[receiving lot]", e); return null; });
    await db.insert(goodsReceiptLines).values({
      orgId, receiptId, itemId: item.id, poId: c.r.poId ?? null, poLineId: c.r.poLineId ?? null,
      description: c.r.description ?? item.name, qtyBase: qty.toString(), unitCost: c.homeUnit.toString(),
      amount: c.amount.toString(), lotId: lotId ?? null, lotNo: c.r.lotNo ?? null, expiryDate: c.r.expiryDate ?? null,
    } as any);
    if (c.r.poLineId) {
      await db.update(tradeDocumentLines)
        .set({ receivedQty: sql`${tradeDocumentLines.receivedQty} + ${qty.toString()}` })
        .where(and(eq(tradeDocumentLines.id, c.r.poLineId), eq(tradeDocumentLines.orgId, orgId)));
    }
  }

  return { id: receiptId, receiptNo, entryId: entry.id, grirTotal };
}
