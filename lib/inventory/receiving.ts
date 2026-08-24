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
import { and, eq, inArray, sql } from "drizzle-orm";
import { postJournalEntry, LedgerValidationError, type PostLine } from "@/lib/ledger";
import { ensureSystemAccounts, systemAccountId, INV_SUBTYPE } from "@/lib/accounting/system-accounts";
import { loadItemCostInfo, commitReceipt } from "@/lib/inventory/valuation";
import { nextDocNumber } from "@/lib/accounting/numbering";
import { postDocument } from "@/lib/accounting/documents";
import { createLink } from "@/lib/accounting/links";
import { round2, round4, round6 } from "@/lib/inventory/round";

const err = (m: string): never => { throw new LedgerValidationError(m); };

export type ReceiptLineInput = {
  itemId: string;
  skuId?: string | null;           // stock SKU received into (SI/FP)
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
    if (qty <= 0) continue;
    const homeUnit = round6((Number(r.unitCost) || 0) * rate);
    const amount = round4(qty * homeUnit);
    // Always receive into stock (a lot is created even at zero cost); only the
    // GL debit/GR-IR credit is added when there is a cost to capitalise.
    if (amount > 0) {
      lines.push({ accountId: assetAcct!, debit: round2(amount), description: `Received — ${item!.name}` });
      grirTotal = round2(grirTotal + round2(amount));
    }
    commits.push({ r, homeUnit, amount, assetAcct: assetAcct! });
  }
  if (!commits.length) err("Nothing to receive — check quantities.");
  if (grirTotal > 0) lines.push({ accountId: grirId!, credit: grirTotal, description: "Goods received not invoiced" });

  const receiptNo = await nextDocNumber(orgId, "GoodsReceipt");
  const entry = lines.length > 0 ? await postJournalEntry({
    orgId, entryDate: date, memo: input.notes?.trim() || `Goods receipt ${receiptNo}`,
    series: "GoodsReceipt", sourceType: "GoodsReceipt", docNumber: receiptNo, createdBy: actorId,
    reference: input.supplierLabel ?? null, lines,
  }) : null;

  const [receipt] = await db.insert(goodsReceipts).values({
    orgId, receiptNo, supplierId: input.supplierId ?? null, supplierLabel: input.supplierLabel ?? null,
    receiptDate: date, currency, exchangeRate: rate.toString(), status: "Posted",
    entryId: entry?.id ?? null, grirTotal: grirTotal.toString(), billedAmount: "0",
    notes: input.notes?.trim() || null, createdBy: actorId,
  } as any).returning({ id: goodsReceipts.id });
  const receiptId = receipt.id;
  const refId = entry?.id ?? receiptId;

  // Create lots + subledger movements, receipt lines, and advance PO progress.
  for (const c of commits) {
    const item = itemMap.get(c.r.itemId)!;
    const qty = round4(Math.abs(Number(c.r.qtyBase) || 0));
    const lotId = await commitReceipt(orgId, {
      itemId: item.id, skuId: c.r.skuId ?? null, qty, unitCost: c.homeUnit, lotNo: c.r.lotNo ?? null, expiryDate: c.r.expiryDate ?? null,
      supplierId: input.supplierId ?? null, sourceType: "purchase", receivedDate: date,
      refType: "GoodsReceipt", refId, entryId: entry?.id ?? null, createdBy: actorId, note: c.r.description ?? null,
    }).catch(e => { console.error("[receiving lot]", e); return null; });
    await db.insert(goodsReceiptLines).values({
      orgId, receiptId, itemId: item.id, skuId: c.r.skuId ?? null, poId: c.r.poId ?? null, poLineId: c.r.poLineId ?? null,
      description: c.r.description ?? item.name, qtyBase: qty.toString(), unitCost: c.homeUnit.toString(),
      amount: c.amount.toString(), lotId: lotId ?? null, lotNo: c.r.lotNo ?? null, expiryDate: c.r.expiryDate ?? null,
    } as any);
    if (c.r.poLineId) {
      await db.update(tradeDocumentLines)
        .set({ receivedQty: sql`${tradeDocumentLines.receivedQty} + ${qty.toString()}` })
        .where(and(eq(tradeDocumentLines.id, c.r.poLineId), eq(tradeDocumentLines.orgId, orgId)));
    }
  }

  return { id: receiptId, receiptNo, entryId: entry?.id ?? null, grirTotal };
}

export type BillFromReceiptsInput = {
  receiptIds: string[];
  billDate: string;                // YYYY-MM-DD
  dueDate?: string | null;
  reference?: string | null;       // supplier bill no.
  taxRateId?: string | null;       // applied to each line
  memo?: string | null;
};

/**
 * Create a supplier Bill from one or more posted goods receipts. Bills the
 * un-billed accrued cost of each receipt line against the GR/IR clearing
 * account, so posting clears GR/IR to Accounts Payable (Dr GR/IR / Cr A/P).
 * All receipts must be the same supplier. Amounts are the home-currency accrued
 * cost, so GR/IR clears exactly.
 */
export async function billFromReceipts(orgId: string, input: BillFromReceiptsInput, actorId: string | null) {
  if (!input.receiptIds?.length) err("Select at least one receipt to bill.");
  await ensureSystemAccounts(orgId);
  const grirId = await systemAccountId(orgId, INV_SUBTYPE.grir);
  if (!grirId) err("No Goods-Received-Not-Invoiced clearing account is set up.");

  const receipts = await db.select().from(goodsReceipts)
    .where(and(eq(goodsReceipts.orgId, orgId), inArray(goodsReceipts.id, input.receiptIds)));
  if (!receipts.length) err("Receipts not found.");
  const supplierIds = [...new Set(receipts.map(r => r.supplierId ?? "—"))];
  if (supplierIds.length > 1) err("All selected receipts must be for the same supplier.");
  const supplierId = receipts[0].supplierId ?? null;
  const supplierLabel = receipts[0].supplierLabel ?? null;

  const lineRows = await db.select().from(goodsReceiptLines)
    .where(and(eq(goodsReceiptLines.orgId, orgId), inArray(goodsReceiptLines.receiptId, input.receiptIds)));

  // Bill the un-billed remainder of each receipt line (qty basis).
  const billLines: any[] = [];
  const touched: { lineId: string; qty: number; amount: number }[] = [];
  for (const l of lineRows) {
    const rem = round4(Number(l.qtyBase) - Number(l.billedQty));
    if (rem <= 0) continue;
    // Match the receipt's rounding basis (round4 then round2) so GR/IR clears
    // to exactly zero when a receipt line is fully billed.
    const amount = round2(round4(rem * Number(l.unitCost)));
    if (amount <= 0) continue;
    billLines.push({ accountId: grirId, itemId: null, description: l.description ?? "Received goods", qty: rem, rate: Number(l.unitCost), amount, taxRateId: input.taxRateId ?? null });
    touched.push({ lineId: l.id, qty: rem, amount });
  }
  if (!billLines.length) err("These receipts are already fully billed.");

  const entry = await postDocument(orgId, {
    type: "Bill", date: input.billDate,
    memo: input.memo?.trim() || `Bill for goods received (${receipts.map(r => r.receiptNo).filter(Boolean).join(", ")})`,
    partyType: "Vendor", partyId: supplierId, partyLabel: supplierLabel,
    dueDate: input.dueDate ?? null, reference: input.reference?.trim() || null,
    lines: billLines,
  }, actorId);

  // Link receipts → bill, and advance billed progress.
  const totalBilled = round2(touched.reduce((s, t) => s + t.amount, 0));
  for (const r of receipts) {
    await createLink(orgId, { fromType: "GoodsReceipt", fromId: r.id, toType: "Bill", toId: entry.id, relation: "receipt_bill", amount: 0, contextEntryId: entry.id }, actorId)
      .catch(e => console.error("[receipt_bill link]", e));
  }
  const lineById = new Map(lineRows.map(l => [l.id, l]));
  const perReceipt = new Map<string, number>();
  for (const t of touched) {
    await db.update(goodsReceiptLines).set({ billedQty: sql`${goodsReceiptLines.billedQty} + ${t.qty.toString()}` })
      .where(and(eq(goodsReceiptLines.id, t.lineId), eq(goodsReceiptLines.orgId, orgId)));
    const gl = lineById.get(t.lineId);
    if (gl?.poLineId) await db.update(tradeDocumentLines).set({ billedQty: sql`${tradeDocumentLines.billedQty} + ${t.qty.toString()}` })
      .where(and(eq(tradeDocumentLines.id, gl.poLineId), eq(tradeDocumentLines.orgId, orgId)));
    if (gl) perReceipt.set(gl.receiptId, round2((perReceipt.get(gl.receiptId) ?? 0) + t.amount));
  }
  for (const [rid, amt] of perReceipt) {
    await db.update(goodsReceipts).set({ billedAmount: sql`${goodsReceipts.billedAmount} + ${amt.toString()}`, updatedAt: new Date() })
      .where(and(eq(goodsReceipts.id, rid), eq(goodsReceipts.orgId, orgId)));
  }

  return { id: entry.id, docNumber: entry.docNumber, txnNo: entry.txnNo, billed: totalBilled };
}
