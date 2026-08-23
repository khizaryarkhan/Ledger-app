// Mirrors the request/response shapes of app/api/inventory/{receiving,production,shipping,boms,po-open,so-open}
// on the ledger-app backend. Keep in sync with lib/inventory/{receiving,production,shipping}.ts.

export type Org = { id: string; name: string };

export type OpenPoLine = {
  lineId: string;
  itemId: string;
  itemName: string;
  baseUom: string;
  orderUom: string | null;
  packLevel: string | null;
  unitsPerOrderUnit: number | null;
  rate: number;
  orderedBaseQty: number;
  receivedQty: number;
  remainingQty: number;
  unitCostBase: number;
};

export type OpenPo = {
  id: string;
  docNumber: string;
  partyId: string | null;
  partyLabel: string | null;
  currency: string | null;
  exchangeRate: number | null;
  issueDate: string | null;
  expiryDate: string | null;
  lines: OpenPoLine[];
};

export type ReceiptLineInput = {
  itemId: string;
  poId?: string | null;
  poLineId?: string | null;
  description?: string | null;
  qtyBase: number;
  unitCost: number;
  lotNo?: string | null;
  expiryDate?: string | null;
};

/** An item from the register (`/api/inventory/items`), for no-PO receipts. */
export type InventoryItem = {
  id: string;
  name: string;
  code: string | null;
  baseUom: string | null;
  productType: string;
  status: string;
  unitCost: number | null;
  onHandQty: number;
};

// Mirrors lib/inventory/item-kinds.ts — only these kinds hold stock, so only
// these can be received into inventory.
const TRACKED_KINDS = new Set(["FinishedProduct", "StockItem", "RawMaterial", "WorkInProgress"]);
export const isTrackedItem = (i: InventoryItem) => TRACKED_KINDS.has(i.productType) && i.status === "Active";

export type ReceiptInput = {
  supplierId?: string | null;
  supplierLabel?: string | null;
  receiptDate: string; // YYYY-MM-DD
  currency?: string | null;
  exchangeRate?: number | null;
  notes?: string | null;
  lines: ReceiptLineInput[];
};

export type OpenSoLine = {
  lineId: string;
  itemId: string;
  itemName: string;
  baseUom: string;
  orderedBaseQty: number;
  shippedQty: number;
  remainingQty: number;
  saleRateBase: number | null;
  taxRateId: string | null;
};

export type OpenSo = {
  id: string;
  docNumber: string;
  partyId: string | null;
  partyLabel: string | null;
  currency: string | null;
  exchangeRate: number | null;
  issueDate: string | null;
  expiryDate: string | null;
  lines: OpenSoLine[];
};

export type ShipmentLineInput = {
  itemId: string;
  soId?: string | null;
  soLineId?: string | null;
  description?: string | null;
  qtyBase: number;
  saleRate?: number | null;
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

export type BomSummary = {
  id: string;
  name: string;
  code: string | null;
  outputItemId: string | null;
  outputItemName: string | null;
  status: string;
  batchType: "Input" | "Output";
  batchSize: string;
  inputCount: number;
  outputCount: number;
};

export type BomLine = {
  id: string;
  itemId: string;
  qty: string;
  uom: string | null;
  role: "input" | "output";
  item: { id: string; name: string; code: string | null; productType: string; baseUom: string } | null;
};

export type BomDetail = {
  bom: BomSummary & { notes: string | null; processingStep: string | null; expYield: string | null };
  inputs: BomLine[];
  outputs: BomLine[];
};

export type ProductionInputLine = { itemId: string; qty: number; lotPicks?: { lotId: string; qty: number }[] };

export type ProductionInput = {
  bomId?: string | null;
  outputItemId: string;
  qtyToProduce: number;
  producedDate: string;
  lotNo?: string | null;
  expiryDate?: string | null;
  notes?: string | null;
  inputs: ProductionInputLine[];
};
