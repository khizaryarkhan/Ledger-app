import type { OpenPo, OpenSo, BomSummary } from "../api/types";

export type RootStackParamList = {
  Home: undefined;

  // Receivables (collections)
  ReceivablesOverview: undefined;
  /** `customerId` narrows the list to one customer; `title` renames the header. */
  ReceivablesInvoices: { customerId?: string; customerName?: string; filter?: string } | undefined;
  ReceivablesInvoiceDetail: { invoiceId: string; invoiceNumber?: string };
  ReceivablesEscalations: undefined;
  ReceivablesCustomers: undefined;

  // Operations (warehouse & production)
  ReceivingList: undefined;
  ReceivingDetail: { po: OpenPo };
  ReceivingAdHoc: undefined;
  ProductionList: undefined;
  ProductionDetail: { bom: BomSummary };
  ShippingList: undefined;
  ShippingDetail: { so: OpenSo };
};
