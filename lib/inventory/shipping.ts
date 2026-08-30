/**
 * Sales shipment — the fulfilment step between a Sales Order and an Invoice
 * (order-to-cash mirror of goods receipts). COGS is recognised at SHIPMENT:
 *
 *   Dr  COGS            (FIFO cost of the goods that left)
 *     Cr  Inventory Asset
 *
 * relieving stock lots. The Invoice created from the shipment posts revenue only
 * (Dr A/R / Cr Revenue) at sale price and does NOT relieve stock again (its
 * lines carry no itemId, so the documents engine won't re-post COGS).
 */

import { db } from "@/db";
import { salesShipments, shipmentLines, tradeDocumentLines, apItems, organisations, customers } from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { postJournalEntry, LedgerValidationError, type PostLine } from "@/lib/ledger";
import { ensureSystemAccounts, systemAccountId, INV_SUBTYPE } from "@/lib/accounting/system-accounts";
import { loadItemCostInfo, planIssue, commitIssue } from "@/lib/inventory/valuation";
import { nextDocNumber } from "@/lib/accounting/numbering";
import { postDocument } from "@/lib/accounting/documents";
import { createLink } from "@/lib/accounting/links";
import { round2, round4 } from "@/lib/inventory/round";
import { requiresApproval, stagePendingApproval } from "@/lib/inventory/approvals";

const err = (m: string): never => { throw new LedgerValidationError(m); };

export type ShipmentLineInput = {
  itemId: string;
  skuId?: string | null;           // stock SKU shipped (SI/FP); relieves that SKU's lots
  soId?: string | null;
  soLineId?: string | null;
  description?: string | null;
  qtyBase: number;                 // shipped quantity in item base UoM
  saleRate?: number | null;        // sale price per base UoM (transaction currency) — for invoicing
  taxRateId?: string | null;
};

export type ShipmentInput = {
  customerId?: string | null;
  customerLabel?: string | null;
  shipmentDate: string;
  currency?: string | null;
  exchangeRate?: number | null;
  notes?: string | null;
  lines: ShipmentLineInput[];
};

export async function postShipment(orgId: string, input: ShipmentInput, actorId: string | null, opts?: { skipApprovalCheck?: boolean }) {
  const date = input.shipmentDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) err("A valid shipment date is required.");
  const rows = (input.lines ?? []).filter(l => l.itemId && Math.abs(Number(l.qtyBase) || 0) > 0);
  if (!rows.length) err("Add at least one line with an item and a shipped quantity.");

  const [org] = await db.select({ home: organisations.currency, mc: organisations.multicurrencyEnabled })
    .from(organisations).where(eq(organisations.id, orgId)).limit(1);
  const home = org?.home ?? "PKR";
  const currency = (input.currency?.trim() || home).toUpperCase();
  const rate = currency === home ? 1 : (Number(input.exchangeRate) || 0);
  if (currency !== home) {
    if (!org?.mc) err("Enable multi-currency before shipping in a foreign currency.");
    if (!(rate > 0)) err("Enter a valid exchange rate.");
  }

  // The UI always resolves and sends customerLabel alongside customerId, but
  // any other caller (a script, a future integration) might send only the
  // id — resolve the name server-side rather than silently recording a
  // shipment with no customer display name (surfaces as blank in every
  // report, e.g. Lot Traceability's "Sold-To Customer" column).
  let customerLabel = input.customerLabel ?? null;
  if (!customerLabel && input.customerId) {
    const [customer] = await db.select({ name: customers.name }).from(customers).where(and(eq(customers.id, input.customerId), eq(customers.orgId, orgId))).limit(1);
    customerLabel = customer?.name ?? null;
  }

  await ensureSystemAccounts(orgId);
  const cogsSys = await systemAccountId(orgId, INV_SUBTYPE.cogs);
  const invAssetId = await systemAccountId(orgId, INV_SUBTYPE.asset);

  const itemMap = await loadItemCostInfo(orgId, rows.map(r => r.itemId));
  // Item income account + list price (for the invoice) — not in the cost map.
  const extra = await db.select({ id: apItems.id, income: apItems.incomeAccountId, price: apItems.unitPrice })
    .from(apItems).where(and(eq(apItems.orgId, orgId), inArray(apItems.id, rows.map(r => r.itemId))));
  const extraById = new Map(extra.map(e => [e.id, e]));

  // Plan FIFO issues, build the Dr COGS / Cr Inventory entry (home currency).
  const lines: PostLine[] = [];
  let cogsTotal = 0, saleTotal = 0;
  const commits: { r: ShipmentLineInput; qty: number; plan: any; cogsAcct: string; assetAcct: string; income: string | null; saleRate: number }[] = [];
  for (const r of rows) {
    const item = itemMap.get(r.itemId);
    if (!item) err(`Item ${r.itemId} not found.`);
    if (!item!.tracked) err(`${item!.name} isn't inventory-tracked — only tracked items ship from stock.`);
    const cogsAcct = item!.cogsAccountId ?? cogsSys;
    const assetAcct = item!.assetAccountId ?? invAssetId;
    if (!cogsAcct || !assetAcct) err(`No COGS / inventory account for ${item!.name}.`);
    const qty = round4(Math.abs(Number(r.qtyBase) || 0));
    if (qty <= 0) continue;
    const plan = await planIssue(orgId, item!, qty, undefined, r.skuId ?? null);
    const cost = round2(plan.totalCost);
    if (cost > 0) { lines.push({ accountId: cogsAcct!, debit: cost, description: `COGS — ${item!.name}` }); lines.push({ accountId: assetAcct!, credit: cost, description: `Inventory relief — ${item!.name}` }); cogsTotal = round2(cogsTotal + cost); }
    const ex = extraById.get(r.itemId);
    // Guard here, not only at invoice time: a shipment with no income account
    // would relieve stock (Dr COGS) yet could never be invoiced — stranding the
    // sale. Require the account up front so the shipment is always invoiceable.
    if (!ex?.income) err(`${item!.name} has no income account set — add one in Products & Services before shipping, otherwise the shipment can't be invoiced.`);
    const saleRate = r.saleRate != null && r.saleRate !== undefined ? Number(r.saleRate) : (ex?.price != null ? Number(ex.price) : 0);
    saleTotal = round2(saleTotal + qty * saleRate);
    // Income account for the eventual invoice — must NOT fall back to the asset
    // account, or revenue would post to Inventory. Left null → invoicing guards it.
    commits.push({ r, qty, plan, cogsAcct: cogsAcct!, assetAcct: assetAcct!, income: ex?.income ?? null, saleRate });
  }

  if (!opts?.skipApprovalCheck && await requiresApproval(orgId, "shipment", saleTotal)) {
    const pending = await stagePendingApproval(orgId, "shipment", input, saleTotal, actorId);
    return { pending: true, id: pending.id, amount: saleTotal } as any;
  }

  const shipmentNo = await nextDocNumber(orgId, "Shipment");
  let entryId: string | null = null;
  if (lines.length > 0) {
    const entry = await postJournalEntry({
      orgId, entryDate: date, memo: input.notes?.trim() || `Shipment ${shipmentNo}`,
      series: "Shipment", sourceType: "Shipment", docNumber: shipmentNo, createdBy: actorId,
      reference: customerLabel, lines,
    });
    entryId = entry.id;
  }

  const [shipment] = await db.insert(salesShipments).values({
    orgId, shipmentNo, customerId: input.customerId ?? null, customerLabel,
    shipmentDate: date, currency, exchangeRate: rate.toString(), status: "Posted",
    entryId, cogsTotal: cogsTotal.toString(), saleTotal: saleTotal.toString(), invoicedAmount: "0",
    notes: input.notes?.trim() || null, createdBy: actorId,
  } as any).returning({ id: salesShipments.id });
  const shipmentId = shipment.id;

  for (const c of commits) {
    const item = itemMap.get(c.r.itemId)!;
    // Relieve stock for the shipped qty regardless of cost (free/zero-cost lots
    // must still leave inventory). refId keys the movement even with no JE.
    if (c.qty > 0) {
      await commitIssue(orgId, { itemId: item.id, plan: c.plan, skuId: c.r.skuId ?? null, movementType: "issue_sale", refType: "Shipment", refId: entryId ?? shipmentId, entryId: entryId ?? null, date, createdBy: actorId, note: `Shipment ${shipmentNo}` })
        .catch(e => console.error("[shipment issue]", e));
    }
    await db.insert(shipmentLines).values({
      orgId, shipmentId, itemId: item.id, skuId: c.r.skuId ?? null, soId: c.r.soId ?? null, soLineId: c.r.soLineId ?? null,
      description: c.r.description ?? item.name, qtyBase: c.qty.toString(),
      unitCost: (c.qty > 0 ? round4(c.plan.totalCost / c.qty) : 0).toString(), cogsAmount: round2(c.plan.totalCost).toString(),
      saleRate: c.saleRate.toString(), incomeAccountId: c.income, taxRateId: c.r.taxRateId ?? null,
    } as any);
    if (c.r.soLineId) {
      await db.update(tradeDocumentLines).set({ receivedQty: sql`${tradeDocumentLines.receivedQty} + ${c.qty.toString()}` })
        .where(and(eq(tradeDocumentLines.id, c.r.soLineId), eq(tradeDocumentLines.orgId, orgId)));
    }
  }

  return { id: shipmentId, shipmentNo, entryId, cogsTotal, saleTotal };
}

export type InvoiceFromShipmentsInput = {
  shipmentIds: string[];
  invoiceDate: string;
  dueDate?: string | null;
  reference?: string | null;
  memo?: string | null;
};

/**
 * Create a customer Invoice from one or more shipments. Bills the un-invoiced
 * shipped quantity at its sale price — Dr A/R / Cr Revenue. COGS was already
 * recognised at shipment, so invoice lines carry no itemId (no double relief).
 */
export async function invoiceFromShipments(orgId: string, input: InvoiceFromShipmentsInput, actorId: string | null) {
  if (!input.shipmentIds?.length) err("Select at least one shipment to invoice.");
  const shipments = await db.select().from(salesShipments)
    .where(and(eq(salesShipments.orgId, orgId), inArray(salesShipments.id, input.shipmentIds)));
  if (!shipments.length) err("Shipments not found.");
  const customers = [...new Set(shipments.map(s => s.customerId ?? "—"))];
  if (customers.length > 1) err("All selected shipments must be for the same customer.");
  const currencies = [...new Set(shipments.map(s => (s.currency ?? "").toUpperCase()))];
  if (currencies.length > 1) err("All selected shipments must be in the same currency — invoice them separately.");
  const customerId = shipments[0].customerId ?? null;
  const customerLabel = shipments[0].customerLabel ?? null;
  const currency = shipments[0].currency ?? null;
  const exchangeRate = shipments[0].exchangeRate != null ? Number(shipments[0].exchangeRate) : null;

  const lineRows = await db.select().from(shipmentLines)
    .where(and(eq(shipmentLines.orgId, orgId), inArray(shipmentLines.shipmentId, input.shipmentIds)));

  const invLines: any[] = [];
  const touched: { lineId: string; shipmentId: string; qty: number; amount: number }[] = [];
  for (const l of lineRows) {
    const rem = round4(Number(l.qtyBase) - Number(l.invoicedQty));
    if (rem <= 0) continue;
    const rate = Number(l.saleRate) || 0;
    const amount = round2(rem * rate);
    // Revenue line — itemId omitted so the documents engine posts revenue only.
    invLines.push({ accountId: l.incomeAccountId, itemId: null, description: l.description ?? "Goods shipped", qty: rem, rate, amount, taxRateId: l.taxRateId ?? null });
    touched.push({ lineId: l.id, shipmentId: l.shipmentId, qty: rem, amount });
  }
  if (!invLines.length) err("These shipments are already fully invoiced.");
  if (invLines.some(l => !l.accountId)) err("An item on these shipments has no income account set — set one on the item first.");

  const entry = await postDocument(orgId, {
    type: "Invoice", date: input.invoiceDate,
    memo: input.memo?.trim() || `Invoice for shipments (${shipments.map(s => s.shipmentNo).filter(Boolean).join(", ")})`,
    partyType: "Customer", partyId: customerId, partyLabel: customerLabel,
    currency: currency ?? undefined, exchangeRate: exchangeRate ?? undefined,
    dueDate: input.dueDate ?? null, reference: input.reference?.trim() || null,
    lines: invLines,
  }, actorId);

  for (const s of shipments) {
    await createLink(orgId, { fromType: "Shipment", fromId: s.id, toType: "Invoice", toId: entry.id, relation: "shipment_invoice", amount: 0, contextEntryId: entry.id }, actorId)
      .catch(e => console.error("[shipment_invoice link]", e));
  }
  const lineById = new Map(lineRows.map(l => [l.id, l]));
  const perShipment = new Map<string, number>();
  for (const t of touched) {
    await db.update(shipmentLines).set({ invoicedQty: sql`${shipmentLines.invoicedQty} + ${t.qty.toString()}` })
      .where(and(eq(shipmentLines.id, t.lineId), eq(shipmentLines.orgId, orgId)));
    const sl = lineById.get(t.lineId);
    if (sl?.soLineId) await db.update(tradeDocumentLines).set({ billedQty: sql`${tradeDocumentLines.billedQty} + ${t.qty.toString()}` })
      .where(and(eq(tradeDocumentLines.id, sl.soLineId), eq(tradeDocumentLines.orgId, orgId)));
    perShipment.set(t.shipmentId, round2((perShipment.get(t.shipmentId) ?? 0) + t.amount));
  }
  for (const [sid, amt] of perShipment) {
    await db.update(salesShipments).set({ invoicedAmount: sql`${salesShipments.invoicedAmount} + ${amt.toString()}`, updatedAt: new Date() })
      .where(and(eq(salesShipments.id, sid), eq(salesShipments.orgId, orgId)));
  }

  return { id: entry.id, docNumber: entry.docNumber, txnNo: entry.txnNo };
}
