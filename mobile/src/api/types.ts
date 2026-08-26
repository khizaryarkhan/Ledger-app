// Mirrors the request/response shapes of app/api/inventory/{receiving,production,shipping,boms,po-open,so-open}
// on the ledger-app backend. Keep in sync with lib/inventory/{receiving,production,shipping}.ts.

export type Org = { id: string; name: string };

// ── Receivables (collections) ───────────────────────────────────────────────
// Mirrors app/api/mobile/receivables/*.

export type AgingBuckets = {
  current: number; d30: number; d60: number; d90: number; d90plus: number; total: number;
};

export type ArSummary = {
  rep: { id: string; name: string; tier: string; managerId: string | null } | null;
  scoped: boolean;
  totals: {
    totalAR: number; overdueAR: number; overdueCount: number;
    openCount: number; unappliedCredits: number;
  };
  aging: AgingBuckets;
  /** Open-invoice counts per stage, using the org's own stage labels. */
  stages: { label: string; count: number }[];
  /** The org's stage list — the options the detail screen's stage editor offers. */
  stageOptions: { key: string; label: string; isClosed: boolean }[];
};

export type ReceivableInvoice = {
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
  /** `stage` renamed to whatever this org calls it. Show this, filter on `stage`. */
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

export type InvoiceDetail = {
  invoice: ReceivableInvoice & {
    customerEmail: string | null;
    /** True when the invoice came from QBO/Xero and a provider PDF exists. */
    hasPdf: boolean;
    paid: number;
    invoiceDate: string;
    poNumber: string | null;
    notes: string | null;
    escalatedToName: string | null;
    escalatedToEmail: string | null;
  };
  contacts: { id: string; name: string; email: string | null; phone: string | null; isPrimary: boolean }[];
  promises: { id: string; promiseDate: string; amount: number | null; source: string; note: string | null; status: string; createdAt: string }[];
  disputes: { id: string; category: string; reason: string | null; source: string; status: string; outcome: string | null; resolution: string | null; createdAt: string }[];
  activity: { id: string; direction: string; channel: string; subject: string | null; body: string | null; sentAt: string; sender: string | null; authorName: string | null }[];
};

export type EscalationList = {
  total: number;
  count: number;
  invoices: {
    id: string; invoiceNumber: string; customerName: string; projectName: string | null;
    currency: string; balance: number; dueDate: string; daysOverdue: number;
    escalationType: string | null; escalatedToName: string | null; escalatedAt: string | null;
  }[];
};

export type ReceivableCustomer = {
  id: string; name: string; code: string | null; currency: string;
  balance: number; overdue: number; openCount: number; oldestDays: number;
};

/** One prioritised group in the Today queue (/api/mobile/receivables/today). */
export type TodaySection = {
  key: string;
  title: string;
  blurb: string;
  tone: "danger" | "promise" | "warn" | "dispute" | "neutral";
  count: number;
  value: number;
  invoices: ReceivableInvoice[];
};

export type TodayQueue = {
  scoped: boolean;
  /** Things gone wrong, not things merely outstanding — this is the tab badge. */
  actionable: number;
  sections: TodaySection[];
};

/** One derived alert (/api/mobile/notifications). */
export type Alert = {
  id: string;
  kind: "reply" | "dispute" | "broken" | "escalation";
  tone: "promise" | "dispute" | "danger" | "warn";
  title: string;
  body: string | null;
  at: string;
  actionable: boolean;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  currency: string;
  balance: number;
};

export type AlertFeed = { since: string; actionable: number; alerts: Alert[] };

/** Dispute categories accepted by the API (lib/disputes on the server). */
export const DISPUTE_CATEGORIES = [
  "Wrong Amount", "Already Paid", "Goods/Service", "Duplicate", "Other",
] as const;

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
