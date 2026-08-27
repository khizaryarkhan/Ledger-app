/**
 * Batch Functions entity registry.
 *
 * The single source of truth for every QuickBooks entity the Batch module
 * supports: its template columns, capability matrix, date/reference filter
 * fields, and the builder that turns spreadsheet rows into a QBO payload.
 *
 * The engine, API routes, and UI are all driven by this list, so adding or
 * adjusting an entity is a data change here — not new code paths.
 */

import type { BatchEntity } from "./types";
import {
  makeSalesBuilder, buildReceivePayment, makeVendorTxnBuilder, makePurchaseBuilder,
  buildBillPayment, buildJournalEntry, buildDeposit, buildTransfer, buildTimeActivity,
  buildCustomer, buildVendor, buildItem, buildAccount, buildEmployee, makeSimpleListBuilder,
} from "./builders";
import {
  makeSalesRowMapper, makeVendorRowMapper, makePurchaseRowMapper,
  mapReceivePaymentRow, mapBillPaymentRow, mapJournalEntryRows, mapDepositRows,
  mapTransferRow, mapTimeActivityRow, mapCustomerRow, mapVendorRow, mapItemRow,
  mapAccountRow, mapEmployeeRow, makeSimpleListRowMapper,
} from "./row-mappers";

import { buildProgressInvoice, PROGRESS_COLUMNS } from "./convert";

const SALES_REVERSE_REFS = ["Customer", "Item", "Class", "Department", "TaxCode", "PaymentMethod", "Account", "Term"] as const;
const VENDOR_REVERSE_REFS = ["Vendor", "Account", "Item", "Customer", "Class", "Department"] as const;

const FULL = { upload: true, download: true, delete: true, modify: true };
const NO_DELETE = { upload: true, download: true, delete: false, modify: true };
const DOWNLOAD_ONLY = { upload: false, download: true, delete: false, modify: false };
const UNSUPPORTED = { upload: false, download: false, delete: false, modify: false };

export const ENTITIES: BatchEntity[] = [
  // ── Customer transactions ──────────────────────────────────────────────────
  {
    id: "invoice", label: "Invoices", group: "customer",
    qboEntity: "invoice", qboReadName: "Invoice", supports: FULL,
    docKey: "Invoice No", dateColumn: "Invoice Date", qboDateField: "TxnDate",
    refNumberColumn: "Invoice No", qboRefNumberField: "DocNumber",
    refs: ["Customer", "Item", "Class", "PaymentMethod", "Account"],
    columns: ["Invoice No","Customer ","Invoice Date","Due Date","Shipping Date","Ship Via","Tracking no","Terms","Billing Address Line 1","Billing Address Line 2","Billing Address Line 3","Billing Address City","Billing Address Postal Code","Billing Address Country","Billing Address State","Shipping Address Line 1","Shipping Address Line 2","Shipping Address Line 3","Shipping Address City","Shipping Address Postal Code","Shipping Address Country","Shipping Address State","Memo","Message displayed on invoice","Email","Shipping","Sales Tax Code","Sales Tax Amount","Discount Amount","Discount Percent","Discount Account ","Apply Tax After Discount","Service Date","Product/Service","Product/Service Description","Product/Service Quantity","Product/Service Rate","Product/Service Amount","Product/Service Taxable","Product/Service Class","Show Sub Total","Deposit","Location","Custom Field Value (1)","Custom Field Value (2)","Custom Field Value (3)","Currency Code","Exchange Rate","Print Status","Email Status"],
    build: makeSalesBuilder({ withDueDate: true }),
    reverseRefs: [...SALES_REVERSE_REFS],
    toRows: makeSalesRowMapper({ docNoCol: "Invoice No", customerCol: "Customer", dateCol: "Invoice Date", dueDateCol: "Due Date", messageCol: "Message displayed on invoice" }),
  },
  {
    id: "estimate", label: "Estimates", group: "customer",
    qboEntity: "estimate", qboReadName: "Estimate", supports: FULL,
    docKey: "Estimate No", dateColumn: "Estimate Date", qboDateField: "TxnDate",
    refNumberColumn: "Estimate No", qboRefNumberField: "DocNumber",
    refs: ["Customer", "Item", "Class"],
    columns: ["Estimate No","Customer","Estimate Date","Expiration Date","Estimate Status","Accepted By","Accepted Date","Ship Via","Ship Date","Tracking No","Billing Address Line 1","Billing Address Line 2","Billing Address Line 3","Billing Address City","Billing Address Postal Code","Billing Address Country","Billing Address State","Shipping Address Line 1","Shipping Address Line 2","Shipping Address Line 3","Shipping Address City","Shipping Address Postal Code","Shipping Address Country","Shipping Address State","Memo","Message displayed on estimate","Email","Shipping","Sales Tax Code","Sales Tax Amount","Discount Amount","Discount Percent","Discount Account","Service Date","Product/Service","Product/Service Description","Product/Service Quantity","Product/Service Rate","Product/Service Amount","Product/Service Taxable","Product/Service Class ","Show Sub Total","Apply Tax After Discount","Location","Custom Field Value (1)","Custom Field Value (2)","Custom Field Value (3)","Currency Code","Exchange Rate","Print Status","Email Status"],
    build: makeSalesBuilder({ withStatus: true }),
    reverseRefs: [...SALES_REVERSE_REFS],
    toRows: makeSalesRowMapper({ docNoCol: "Estimate No", customerCol: "Customer", dateCol: "Estimate Date", expiryCol: "Expiration Date", statusCol: "Estimate Status", messageCol: "Message displayed on estimate" }),
  },
  {
    id: "creditmemo", label: "Credit Memos", group: "customer",
    qboEntity: "creditmemo", qboReadName: "CreditMemo", supports: FULL,
    docKey: "Credit Memo No", dateColumn: "Credit Memo Date", qboDateField: "TxnDate",
    refNumberColumn: "Credit Memo No", qboRefNumberField: "DocNumber",
    refs: ["Customer", "Item", "Class"],
    columns: ["Credit Memo No","Customer","Credit Memo Date","Memo","Billing Address Line 1","Billing Address Line 2","Billing Address Line 3","Billing Address City","Billing Address Postal Code","Billing Address Country","Billing Address State","Shipping","Sales Tax Code","Sales Tax Amount","Discount Amount","Discount Percent","Discount Account","Service Date","Product/Service","Product/Service Description","Product/Service Quantity","Product/Service Rate","Product/Service Amount","Product/Service Taxable","Product/Service Class ","Message displayed on credit memo","Location","Email","Apply Tax After Discount","Custom Field Value (1)","Custom Field Value (2)","Custom Field Value (3)","Currency Code","Exchange Rate","Print Status","Email Status"],
    build: makeSalesBuilder({}),
    reverseRefs: [...SALES_REVERSE_REFS],
    toRows: makeSalesRowMapper({ docNoCol: "Credit Memo No", customerCol: "Customer", dateCol: "Credit Memo Date", messageCol: "Message displayed on credit memo" }),
  },
  {
    id: "salesreceipt", label: "Sales Receipts", group: "customer",
    qboEntity: "salesreceipt", qboReadName: "SalesReceipt", supports: FULL,
    docKey: "Sales Receipt No", dateColumn: "Sales Receipt Date", qboDateField: "TxnDate",
    refNumberColumn: "Sales Receipt No", qboRefNumberField: "DocNumber",
    refs: ["Customer", "Item", "Class", "PaymentMethod", "Account"],
    columns: ["Sales Receipt No","Customer ","Sales Receipt Date","Shipping Date","Tracking No","Ship Via","Deposit To","Payment Method","Reference No","Billing Address Line 1","Billing Address Line 2","Billing Address Line 3","Billing Address City","Billing Address Postal Code","Billing Address Country","Billing Address State","Shipping Address Line 1","Shipping Address Line 2","Shipping Address Line 3","Shipping Address City","Shipping Address Postal Code","Shipping Address Country","Shipping Address State","Memo","Message displayed on sales receipt","Email","Shipping","Sales Tax Code","Sales Tax Amount","Discount Amount","Discount Percent","Discount Account","Apply Tax After Discount","Service Date","Product/Service","Product/Service Description","Product/Service Quantity","Product/Service Rate","Product/Service Amount","Product/Service Taxable","Product/Service Class ","Location","Custom Field Value (1)","Custom Field Value (2)","Custom Field Value (3)","Currency Code","Exchange Rate","Print Status","Email Status"],
    build: makeSalesBuilder({ withDepositAccount: true, withPaymentMethod: true }),
    reverseRefs: [...SALES_REVERSE_REFS],
    toRows: makeSalesRowMapper({ docNoCol: "Sales Receipt No", customerCol: "Customer", dateCol: "Sales Receipt Date", messageCol: "Message displayed on sales receipt", depositToCol: "Deposit To", paymentMethodCol: "Payment Method" }),
  },
  {
    id: "refundreceipt", label: "Refund Receipts", group: "customer",
    qboEntity: "refundreceipt", qboReadName: "RefundReceipt", supports: FULL,
    docKey: "Refund Receipt No", dateColumn: "Refund Receipt date", qboDateField: "TxnDate",
    refNumberColumn: "Refund Receipt No", qboRefNumberField: "DocNumber",
    refs: ["Customer", "Item", "Class", "PaymentMethod", "Account"],
    columns: ["Refund Receipt No","Customer ","Refund Receipt date","Refunded From","Payment method","Billing Address Line 1","Billing Address Line 2","Billing Address Line 3","Billing Address City","Billing Address Postal Code","Billing Address Country","Billing Address State","Memo","Message displayed on refund receipt","Email","Shipping","Sales Tax Code","Sales Tax Amount","Discount Amount","Discount Percent","Discount Account ","Service Date","Product/Service","Product/Service Description","Product/Service Quantity","Product/Service Rate","Product/Service Amount","Product/Service Taxable","Product/Service Class ","Apply Tax After Discount","Location","Custom Field Value (1)","Custom Field Value (2)","Custom Field Value (3)","Currency Code","Exchange Rate"],
    build: makeSalesBuilder({ withDepositAccount: true, withPaymentMethod: true }),
    reverseRefs: [...SALES_REVERSE_REFS],
    toRows: makeSalesRowMapper({ docNoCol: "Refund Receipt No", customerCol: "Customer", dateCol: "Refund Receipt date", messageCol: "Message displayed on refund receipt", depositToCol: "Refunded From", paymentMethodCol: "Payment method" }),
  },
  {
    id: "receivepayment", label: "Received Payments", group: "customer",
    qboEntity: "payment", qboReadName: "Payment", supports: FULL,
    docKey: "Ref No",   // rows sharing a Ref No = one payment applied to many invoices
    dateColumn: "Payment Date", qboDateField: "TxnDate",
    refNumberColumn: "Reference No", qboRefNumberField: "PaymentRefNum",
    refs: ["Customer", "PaymentMethod", "Account"],
    columns: ["Ref No","Payment Date","Customer ","Payment method","Deposit To Account Name","Invoice No","Journal No","Amount","Reference No","Memo","Currency Code","Exchange Rate"],
    build: buildReceivePayment,
    reverseRefs: ["Customer", "PaymentMethod", "Account"],
    toRows: mapReceivePaymentRow,
  },
  {
    // Progress billing: download accepted estimate lines, fill Qty/Amount to
    // Invoice, upload to create invoices linked to each estimate. The template
    // download is special-cased to the estimate-lines export (see the template
    // route); the standard upload → preview → commit flow then creates invoices.
    id: "estimateinvoice", label: "Invoice from Estimates", group: "customer",
    qboEntity: "invoice",
    supports: { upload: true, download: false, delete: false, modify: false },
    docKey: "Estimate Id",
    refs: ["Customer", "Item", "Class", "Department", "TaxCode"],
    columns: PROGRESS_COLUMNS,
    build: async (doc, refs) => {
      const payload = await buildProgressInvoice(doc.key, doc.rows, refs);
      if (!payload) throw new Error("No lines marked to invoice on this estimate");
      return { payload };
    },
  },

  // ── Vendor transactions ────────────────────────────────────────────────────
  {
    id: "bill", label: "Bills", group: "vendor",
    qboEntity: "bill", qboReadName: "Bill", supports: FULL,
    docKey: "Bill No", dateColumn: "Bill Date", qboDateField: "TxnDate",
    refNumberColumn: "Bill No", qboRefNumberField: "DocNumber",
    refs: ["Vendor", "Account", "Item", "Customer", "Class"],
    columns: ["Bill No","Vendor","Bill Date","Due Date","Terms","Mailing Address Line 1","Mailing Address Line 2","Mailing Address Line 3","Mailing Address City","Mailing Address Postal Code","Mailing Address Country","Mailing Address State","Memo","Expense Account ","Expense Description","Expense Line Amount","Expense Billable Status","Expense Markup Percent","Expense Customer ","Expense Class","Expense Taxable","Product/Service","Product/Service Description","Product/Service Quantity","Product/Service Rate","Product/Service Amount","Product/Service Billable Status","Product/Service Taxable","Product/Service Markup Percent","Billable Customer:Product/Service ","Product/Service Class ","Location","Currency Code","Exchange Rate"],
    build: makeVendorTxnBuilder({ entity: "Bill" }),
    reverseRefs: [...VENDOR_REVERSE_REFS],
    toRows: makeVendorRowMapper({ docNoCol: "Bill No", dateCol: "Bill Date", dueDateCol: "Due Date", addrPrefix: "Mailing Address" }),
  },
  {
    id: "expense", label: "Expenses", group: "vendor",
    qboEntity: "purchase", qboReadName: "Purchase", supports: FULL,
    qboExtraWhere: "PaymentType = 'Cash'",
    docKey: "Ref No", dateColumn: "Payment Date", qboDateField: "TxnDate",
    refNumberColumn: "Ref No", qboRefNumberField: "DocNumber",
    refs: ["Account", "Vendor", "Customer", "Item", "Class"],
    columns: ["Ref No","Account","Payee","Memo","Payment Date","Payment Method","Expense Account ","Expense Description","Expense Line Amount","Expense Billable Status","Expense Markup Percent","Expense Customer ","Expense Class ","Expense Taxable","Product/Service","Product/Service Description","Product/Service Quantity","Product/Service Rate","Product/Service Amount","Product/Service Billable Status","Product/Service Taxable","Product/Service Markup Percent","Billable Customer:Product/Service ","Product/Service Class ","Location","Currency Code","Exchange Rate"],
    build: makePurchaseBuilder({ paymentType: "Cash" }),
    reverseRefs: [...VENDOR_REVERSE_REFS],
    toRows: makePurchaseRowMapper({ docNoCol: "Ref No", bankCol: "Account" }),
  },
  {
    id: "check", label: "Checks", group: "vendor",
    qboEntity: "purchase", qboReadName: "Purchase", supports: FULL,
    qboExtraWhere: "PaymentType = 'Check'",
    docKey: "Check no", dateColumn: "Payment Date", qboDateField: "TxnDate",
    refNumberColumn: "Check no", qboRefNumberField: "DocNumber",
    refs: ["Account", "Vendor", "Customer", "Item", "Class"],
    columns: ["Check no","Bank Account ","Payee","Payment Date","Mailing Address Line 1","Mailing Address Line 2","Mailing Address Line 3","Mailing Address City","Mailing Address Postal Code","Mailing Address Country","Mailing Address State","Memo","Expense Account ","Expense Description","Expense Line Amount","Expense Billable Status","Expense Markup Percent","Expense Customer ","Expense Class ","Expense Taxable","Product/Service","Product/Service Description","Product/Service Quantity","Product/Service Rate","Product/Service Amount","Product/Service Billable Status","Product/Service Taxable","Product/Service Markup Percent","Billable Customer:Product/Service ","Product/Service Class ","Location","Currency Code","Exchange Rate","Print Status"],
    build: makePurchaseBuilder({ paymentType: "Check" }),
    reverseRefs: [...VENDOR_REVERSE_REFS],
    toRows: makePurchaseRowMapper({ docNoCol: "Check no", bankCol: "Bank Account", addrPrefix: "Mailing Address" }),
  },
  {
    id: "purchaseorder", label: "Purchase Orders", group: "vendor",
    qboEntity: "purchaseorder", qboReadName: "PurchaseOrder", supports: FULL,
    docKey: "PO No", dateColumn: "Purchase Order Date", qboDateField: "TxnDate",
    refNumberColumn: "PO No", qboRefNumberField: "DocNumber",
    refs: ["Vendor", "Account", "Item", "Customer", "Class"],
    columns: ["PO No","Vendor","Purchase Order Status","Purchase Order Date","Due Date","Ship Via","Mailing Address Line 1","Mailing Address Line 2","Mailing Address Line 3","Mailing Address City","Mailing Address Postal Code","Mailing Address Country","Mailing Address State","Shipping Address Line 1","Shipping Address Line 2","Shipping Address Line 3","Shipping Address City","Shipping Address Postal Code","Shipping Address Country","Shipping Address State","Memo","Expense Account ","Expense Description","Expense Line Amount","Expense Billable Status","Expense Customer","Expense Class ","Product/Service","Product/Service Description","Product/Service Quantity","Product/Service Rate","Product/Service Amount","Product/Service Billable Status","Product/Service Taxable","Product/Service Markup Percent","Billable Customer:Product/Service ","Product/Service Class ","Custom Field Name (1)","Custom Field Value (1)","Custom Field Name (2)","Custom Field Value (2)","Custom Field Name (3)","Custom Field Value (3)","Currency Code","Exchange Rate"],
    build: makeVendorTxnBuilder({ entity: "PurchaseOrder", withStatus: true }),
    reverseRefs: [...VENDOR_REVERSE_REFS],
    toRows: makeVendorRowMapper({ docNoCol: "PO No", dateCol: "Purchase Order Date", dueDateCol: "Due Date", statusCol: "Purchase Order Status", addrPrefix: "Mailing Address" }),
  },
  {
    id: "vendorcredit", label: "Vendor Credits", group: "vendor",
    qboEntity: "vendorcredit", qboReadName: "VendorCredit", supports: FULL,
    docKey: "Ref No", dateColumn: "Payment Date", qboDateField: "TxnDate",
    refNumberColumn: "Ref No", qboRefNumberField: "DocNumber",
    refs: ["Vendor", "Account", "Item", "Customer", "Class"],
    columns: ["Ref No","Vendor","Mailing Address Line 1","Mailing Address Line 2","Mailing Address Line 3","Mailing Address City","Mailing Address Postal Code","Mailing Address Country","Mailing Address State","Accounts Payable Account Name","Payment Date","Memo","Expense Account ","Expense Description","Expense Line Amount","Expense Billable Status","Expense Markup Percent","Expense Customer","Expense Class","Expense Taxable","Line Item","Line Item Description","Line Item Quantity","Line Item Rate","Line Item Amount","Line Item Billable Status","Line Item Taxable","Line Item Markup Percent","Line Item Customer","Line Item Class","Location","Currency Code","Exchange Rate"],
    build: makeVendorTxnBuilder({ entity: "VendorCredit" }),
    reverseRefs: [...VENDOR_REVERSE_REFS],
    toRows: makeVendorRowMapper({ docNoCol: "Ref No", dateCol: "Payment Date", addrPrefix: "Mailing Address" }),
  },
  {
    id: "billpayment", label: "Bill Payments", group: "vendor",
    qboEntity: "billpayment", qboReadName: "BillPayment", supports: FULL,
    docKey: "Ref No",   // rows sharing a Ref No = one payment applied to many bills
    dateColumn: "Payment Date", qboDateField: "TxnDate",
    refNumberColumn: "Ref No", qboRefNumberField: "DocNumber",
    refs: ["Vendor", "Account"],
    columns: ["Ref No","Vendor","Payment Date","Bank or CC Account","Memo","Bill No"," Amount","Currency Code","Exchange Rate","Print Status"],
    build: buildBillPayment,
    reverseRefs: ["Vendor", "Account"],
    toRows: mapBillPaymentRow,
  },
  {
    id: "creditcardcredit", label: "Credit Card Credits", group: "vendor",
    qboEntity: "purchase", qboReadName: "Purchase", supports: FULL,
    qboExtraWhere: "PaymentType = 'CreditCard'",
    docKey: "Ref No", dateColumn: "Payment Date", qboDateField: "TxnDate",
    refNumberColumn: "Ref No", qboRefNumberField: "DocNumber",
    refs: ["Account", "Vendor", "Customer", "Item", "Class"],
    columns: ["Ref No","Account","Payee","Memo","Payment Date","Expense Account ","Expense Description","Expense Line Amount","Expense Billable Status","Expense Markup Percent","Expense Customer ","Expense Class ","Expense Taxable","Product/Service","Product/Service Description","Product/Service Quantity","Product/Service Rate","Product/Service Amount","Product/Service Billable Status","Product/Service Taxable","Product/Service Markup Percent","Billable Customer:Product/Service ","Product/Service Class ","Location","Currency Code","Exchange Rate"],
    build: makePurchaseBuilder({ paymentType: "CreditCard", credit: true }),
    reverseRefs: [...VENDOR_REVERSE_REFS],
    toRows: makePurchaseRowMapper({ docNoCol: "Ref No", bankCol: "Account" }),
  },
  {
    id: "paydowncreditcard", label: "Pay Down Credit Card", group: "vendor",
    supports: UNSUPPORTED,
    note: "QuickBooks does not expose a public API for credit-card payoff transactions. Record these directly in QuickBooks, or model them as an Expense/Transfer.",
    columns: ["Credit Card Account","Payee","Amount","Date","Bank Account","Memo","Check Number","Print Status"],
  },

  // ── Other transactions ─────────────────────────────────────────────────────
  {
    id: "journalentry", label: "Journal Entries", group: "other",
    qboEntity: "journalentry", qboReadName: "JournalEntry", supports: FULL,
    docKey: "Journal No", dateColumn: "Journal Date", qboDateField: "TxnDate",
    refNumberColumn: "Journal No", qboRefNumberField: "DocNumber",
    refs: ["Account", "Class", "Department"],
    columns: ["Journal No","Journal Date","Memo"," Account "," Amount"," Description","Name","Location","Class ","Currency Code","Exchange Rate","Is Adjustment"],
    build: buildJournalEntry,
    reverseRefs: ["Account", "Class", "Department", "Customer"],
    toRows: mapJournalEntryRows,
  },
  {
    id: "deposit", label: "Bank Deposits", group: "other",
    qboEntity: "deposit", qboReadName: "Deposit", supports: FULL,
    docKey: "Deposit No", dateColumn: "Date", qboDateField: "TxnDate",
    // Customer/Vendor/Employee are all here because a deposit line's
    // "Received From" can name any of the three; Department backs "Location".
    refs: ["Account", "Class", "PaymentMethod", "Customer", "Vendor", "Employee", "Department"],
    columns: ["Deposit No","Date","Deposit To Account","Received From","Line Account","Line Description","Line Payment Method","Line Ref No","Line Amount","Line Class","Memo","Cash back goes to","Cash back memo","Cash back amount","Location","Currency Code","Exchange Rate","Linked Transaction Type","Linked Transaction Number"],
    build: buildDeposit,
    reverseRefs: ["Account", "Class", "PaymentMethod", "Customer", "Vendor", "Employee", "Department"],
    toRows: mapDepositRows,
  },
  {
    id: "transfer", label: "Transfers", group: "other",
    qboEntity: "transfer", qboReadName: "Transfer", supports: FULL,
    dateColumn: "Date", qboDateField: "TxnDate",
    refs: ["Account"],
    columns: ["Transfer Funds From","Transfer Funds To","Transfer Amount","Memo","Currency Code","Exchange Rate","Date"],
    build: buildTransfer,
    reverseRefs: ["Account"],
    toRows: mapTransferRow,
  },
  {
    id: "timeactivity", label: "Time Activities", group: "other",
    qboEntity: "timeactivity", qboReadName: "TimeActivity", supports: NO_DELETE,
    dateColumn: "Date", qboDateField: "TxnDate",
    refs: ["Employee", "Vendor", "Customer", "Item", "Class"],
    columns: ["Name","Date","Hours","Minutes","Start Time","End Time","Break Hours","Break Minutes","Description","Billable Status","Customer","Service","Bill at $ per hour","Taxable","Class","Location"],
    build: buildTimeActivity,
    reverseRefs: ["Customer", "Item", "Class"],
    toRows: mapTimeActivityRow,
  },
  {
    id: "inventoryadjustment", label: "Inventory Adjustment", group: "other",
    supports: UNSUPPORTED,
    note: "QuickBooks Online does not expose inventory adjustments through its API. Enter these directly in QuickBooks.",
    columns: ["Reference No","Adjustment Date","Location","Adjustment Account","Product/Service","Change In Qty","Class","Memo"],
  },
  {
    id: "bankstatement", label: "Bank Statement", group: "other",
    supports: UNSUPPORTED,
    note: "Bank statement lines are imported through the QuickBooks banking feed, which has no public API. Use QuickBooks' bank-feed import for these.",
    columns: ["Date","Description","Payee","Account","Amount"],
  },
  {
    id: "creditcardstatement", label: "Credit Card Statement", group: "other",
    supports: UNSUPPORTED,
    note: "Credit card statement lines are imported through the QuickBooks banking feed, which has no public API.",
    columns: ["Date","Description","Payee","Amount","Category Account","Transaction Type","Bank Account","Credit Card Account"],
  },
  {
    id: "trialbalance", label: "Trial Balance", group: "other",
    qboReadName: "", supports: DOWNLOAD_ONLY,
    note: "Trial Balance is a report. It can be exported but not imported into QuickBooks.",
    columns: ["Trial Balance No","Date","Amount(credit or debit)","Description","Name","Account","Account Type","Account Subtype"],
  },
  {
    id: "generalledger", label: "General Ledger", group: "other",
    supports: DOWNLOAD_ONLY,
    note: "General Ledger is a report. It can be exported but not imported into QuickBooks.",
    columns: ["Transaction Number","Name","Date","Transaction Type","Memo","Product/Services","Description","Product/Service Quantity","Product/Service Rate","Amount","Credit Amount","Debit Amount","Expense Line Amount","Account","Expense Account","Sales Tax Code","Sales Tax Amount","Discount Amount","Discount Percent","Discount Account","Class","Location","Payment Method","Exchange Rate","Currency Code","Line Item Customer","Linked TransactionId","Linked Transaction Type","Invoice No","Bill No","Credit Memo No","Vendor Credit No","JournalEntry No","Credit Card Account"],
  },
  {
    id: "budget", label: "Budget", group: "other",
    qboReadName: "Budget", supports: DOWNLOAD_ONLY,
    note: "Budgets can be exported from QuickBooks but not created through its API.",
    columns: ["Budget Name","Budget Id","Start Date","End Date","Budget Type","Budget Entry Type","Budget Date","Amount","Account","Customer"],
  },

  // ── Master lists ───────────────────────────────────────────────────────────
  {
    id: "customer", label: "Customers", group: "list",
    qboEntity: "customer", qboReadName: "Customer", supports: NO_DELETE,
    refNumberColumn: "Display Name As", qboRefNumberField: "DisplayName",
    columns: ["Title","Company","First Name","Middle Name","Last Name","Suffix","Display Name As","Print On Check As","Billing Address Line 1","Billing Address Line 2","Billing Address Line 3","Billing Address City","Billing Address Postal Code","Billing Address Country","Billing Address State","Shipping Address Line 1","Shipping Address Line 2","Shipping Address Line 3","Shipping Address City","Shipping Address Postal Code","Shipping Address Country","Shipping Address State","Phone","Mobile","Fax","Other","Website","Email","Terms","Preferred Payment Method","Tax Resale No","Preferred Delivery Method","Bill With Parent","Parent Customer ","Opening Balance","Open Balance Date","Notes","Customer Taxable","Currency Code"],
    build: buildCustomer,
    toRows: mapCustomerRow,
  },
  {
    id: "vendor", label: "Vendors", group: "list",
    qboEntity: "vendor", qboReadName: "Vendor", supports: NO_DELETE,
    refNumberColumn: "Display Name As", qboRefNumberField: "DisplayName",
    columns: ["Display Name As","Title","First Name","Middle Name","Last Name","Suffix","Company","Print On Check As","Billing Address Line 1","Billing Address Line 2","Billing Address Line 3","Billing Address City","Billing Address Postal Code","Billing Address Country","Billing Address State","Notes","Email","Phone","Mobile","Fax","Other","Website","Terms","Opening Balance","Account no","Tax ID","Track payments for 1099","Currency Code"],
    build: buildVendor,
    toRows: mapVendorRow,
  },
  {
    id: "item", label: "Products / Services", group: "list",
    qboEntity: "item", qboReadName: "Item", supports: NO_DELETE,
    refNumberColumn: "Name", qboRefNumberField: "Name",
    refs: ["Account"],
    columns: ["Name","Type","SKU","Price/Rate","Sales Description","Taxable","Purchase Description","Cost","Income Account ","Expense Account ","Category","Inventory Asset Account","Initial Quantity On Hand","As Of Date","Sales Tax Included","Purchase Tax Included"],
    build: buildItem,
    reverseRefs: ["Account"],
    toRows: mapItemRow,
  },
  {
    id: "account", label: "Accounts", group: "list",
    qboEntity: "account", qboReadName: "Account", supports: NO_DELETE,
    refNumberColumn: "Name", qboRefNumberField: "Name",
    columns: ["Name","Account Type","Account Subtype","Account Number","Parent Account","Description","Opening Balance","Opening Balance Date","Currency Code"],
    build: buildAccount,
    toRows: mapAccountRow,
  },
  {
    id: "class", label: "Classes", group: "list",
    qboEntity: "class", qboReadName: "Class", supports: NO_DELETE,
    refNumberColumn: "Name", qboRefNumberField: "Name",
    columns: ["Name","Parent Class"],
    build: makeSimpleListBuilder("Name"),
    reverseRefs: ["Class"],
    toRows: makeSimpleListRowMapper(),
  },
  {
    id: "department", label: "Locations / Departments", group: "list",
    qboEntity: "department", qboReadName: "Department", supports: NO_DELETE,
    refNumberColumn: "Name", qboRefNumberField: "Name",
    columns: ["Name","Parent Location"],
    build: makeSimpleListBuilder("Name"),
    reverseRefs: ["Department"],
    toRows: makeSimpleListRowMapper(),
  },
  {
    id: "employee", label: "Employees", group: "list",
    qboEntity: "employee", qboReadName: "Employee", supports: NO_DELETE,
    refNumberColumn: "Display Name As", qboRefNumberField: "DisplayName",
    columns: ["Title","First Name","Middle Name","Last Name","Suffix","Display Name As","Print On Check As"," Address Line 1"," Address Line 2"," Address City"," Address Postal Code"," Address Country"," Address State","SSN","Employee No","Email","Phone","Mobile","Billable Time","Billing Rate","Gender","Hired Date","Released Date","Birth Date"],
    build: buildEmployee,
    toRows: mapEmployeeRow,
  },
];

// QBO sales transactions support a DOCUMENT-level Class (one class for the whole
// transaction), separate from per-line "Product/Service Class". The SaasAnt-style
// template only carried the line-level class; add a header "Class" column so orgs
// that tag the whole document (common in construction — per site/division, e.g.
// "GK Galway") can set it. Inserted just before the header "Location" field.
for (const e of ENTITIES) {
  if (e.group === "customer" && e.qboEntity !== "payment" && !e.columns.includes("Class")) {
    const at = e.columns.indexOf("Location");
    if (at >= 0) e.columns.splice(at, 0, "Class");
    else e.columns.push("Class");
  }
}

export const ENTITIES_BY_ID = new Map(ENTITIES.map((e) => [e.id, e]));

export function getEntity(id: string): BatchEntity | undefined {
  return ENTITIES_BY_ID.get(id);
}

/** Group entities for the UI picker, preserving order. */
export const ENTITY_GROUPS: { key: string; label: string }[] = [
  { key: "customer", label: "Customer Transactions" },
  { key: "vendor", label: "Vendor Transactions" },
  { key: "other", label: "Other Transactions" },
  { key: "list", label: "Lists" },
];
