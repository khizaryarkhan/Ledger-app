/**
 * Xero entity registry for Data Studio — read/export side.
 *
 * Xero's model differs from QBO: Contacts (not separate customers/vendors),
 * ACCREC/ACCPAY invoices, Tracking Categories (not Class), TaxType codes.
 * Only download is supported for now; import/update/delete are future phases.
 */

import { xeroDate } from "./client";

type Row = Record<string, any>;
export type XeroGroup = "customer" | "vendor" | "other" | "list";

export interface XeroEntity {
  id: string;
  label: string;
  group: XeroGroup;
  xeroEntity: string;            // plural endpoint, e.g. "Invoices"
  where?: string;                // base filter
  supports: { upload: boolean; download: boolean; delete: boolean; modify: boolean };
  columns: string[];
  hasDateFilter: boolean;
  dateField?: string;            // Xero where date field
  note?: string;
  toRows: (r: any) => Row[];
}

const DL = { upload: false, download: true, delete: false, modify: false };

const phone = (r: any) => (r.Phones || []).find((p: any) => p.PhoneNumber)?.PhoneNumber ?? "";
const addr = (r: any) => (r.Addresses || [])[0] || {};
const tracking = (li: any) => (li.Tracking || [])[0] || {};

// One row per invoice-style line item, with the header repeated.
function lineDocRows(r: any, header: Row): Row[] {
  const lines = r.LineItems || [];
  if (lines.length === 0) return [header];
  return lines.map((li: any) => ({
    ...header,
    "Description": li.Description ?? "",
    "Item Code": li.ItemCode ?? "",
    "Quantity": li.Quantity ?? "",
    "Unit Amount": li.UnitAmount ?? "",
    "Account Code": li.AccountCode ?? "",
    "Tax Type": li.TaxType ?? "",
    "Tracking Category": tracking(li).Name ?? "",
    "Tracking Option": tracking(li).Option ?? "",
    "Line Amount": li.LineAmount ?? "",
  }));
}

const LINE_COLS = ["Description", "Item Code", "Quantity", "Unit Amount", "Account Code", "Tax Type", "Tracking Category", "Tracking Option", "Line Amount"];

export const XERO_ENTITIES: XeroEntity[] = [
  {
    id: "contact", label: "Contacts", group: "list",
    xeroEntity: "Contacts", supports: DL, hasDateFilter: false,
    columns: ["Contact ID", "Name", "First Name", "Last Name", "Email", "Phone", "Account Number", "Tax Number", "Is Customer", "Is Supplier", "Default Currency", "Address Line 1", "City", "Region", "Postal Code", "Country"],
    toRows: (r) => [{
      "Contact ID": r.ContactID, "Name": r.Name, "First Name": r.FirstName ?? "", "Last Name": r.LastName ?? "",
      "Email": r.EmailAddress ?? "", "Phone": phone(r), "Account Number": r.AccountNumber ?? "", "Tax Number": r.TaxNumber ?? "",
      "Is Customer": r.IsCustomer ? "Yes" : "", "Is Supplier": r.IsSupplier ? "Yes" : "", "Default Currency": r.DefaultCurrency ?? "",
      "Address Line 1": addr(r).AddressLine1 ?? "", "City": addr(r).City ?? "", "Region": addr(r).Region ?? "", "Postal Code": addr(r).PostalCode ?? "", "Country": addr(r).Country ?? "",
    }],
  },
  {
    id: "invoice", label: "Sales Invoices", group: "customer",
    xeroEntity: "Invoices", where: 'Type=="ACCREC"', supports: DL, hasDateFilter: true, dateField: "Date",
    columns: ["Invoice ID", "Invoice Number", "Contact", "Date", "Due Date", "Status", "Reference", "Currency", ...LINE_COLS, "Total"],
    toRows: (r) => lineDocRows(r, {
      "Invoice ID": r.InvoiceID, "Invoice Number": r.InvoiceNumber ?? "", "Contact": r.Contact?.Name ?? "",
      "Date": xeroDate(r.Date) ?? "", "Due Date": xeroDate(r.DueDate) ?? "", "Status": r.Status ?? "",
      "Reference": r.Reference ?? "", "Currency": r.CurrencyCode ?? "", "Total": r.Total ?? "",
    }),
  },
  {
    id: "bill", label: "Bills", group: "vendor",
    xeroEntity: "Invoices", where: 'Type=="ACCPAY"', supports: DL, hasDateFilter: true, dateField: "Date",
    columns: ["Invoice ID", "Bill Number", "Contact", "Date", "Due Date", "Status", "Reference", "Currency", ...LINE_COLS, "Total"],
    toRows: (r) => lineDocRows(r, {
      "Invoice ID": r.InvoiceID, "Bill Number": r.InvoiceNumber ?? "", "Contact": r.Contact?.Name ?? "",
      "Date": xeroDate(r.Date) ?? "", "Due Date": xeroDate(r.DueDate) ?? "", "Status": r.Status ?? "",
      "Reference": r.Reference ?? "", "Currency": r.CurrencyCode ?? "", "Total": r.Total ?? "",
    }),
  },
  {
    id: "creditnote", label: "Credit Notes", group: "customer",
    xeroEntity: "CreditNotes", supports: DL, hasDateFilter: true, dateField: "Date",
    columns: ["Credit Note ID", "Credit Note Number", "Type", "Contact", "Date", "Status", "Currency", ...LINE_COLS, "Total"],
    toRows: (r) => lineDocRows(r, {
      "Credit Note ID": r.CreditNoteID, "Credit Note Number": r.CreditNoteNumber ?? "", "Type": r.Type ?? "",
      "Contact": r.Contact?.Name ?? "", "Date": xeroDate(r.Date) ?? "", "Status": r.Status ?? "", "Currency": r.CurrencyCode ?? "", "Total": r.Total ?? "",
    }),
  },
  {
    id: "quote", label: "Quotes", group: "customer",
    xeroEntity: "Quotes", supports: DL, hasDateFilter: true, dateField: "Date",
    columns: ["Quote ID", "Quote Number", "Contact", "Date", "Expiry Date", "Status", "Title", "Reference", "Currency", ...LINE_COLS, "Total"],
    toRows: (r) => lineDocRows(r, {
      "Quote ID": r.QuoteID, "Quote Number": r.QuoteNumber ?? "", "Contact": r.Contact?.Name ?? "",
      "Date": xeroDate(r.Date) ?? "", "Expiry Date": xeroDate(r.ExpiryDate) ?? "", "Status": r.Status ?? "",
      "Title": r.Title ?? "", "Reference": r.Reference ?? "", "Currency": r.CurrencyCode ?? "", "Total": r.Total ?? "",
    }),
  },
  {
    id: "item", label: "Items", group: "list",
    xeroEntity: "Items", supports: DL, hasDateFilter: false,
    columns: ["Item ID", "Code", "Name", "Description", "Sales Unit Price", "Sales Account", "Sales Tax Type", "Purchase Unit Price", "Purchase Account", "Tracked As Inventory"],
    toRows: (r) => [{
      "Item ID": r.ItemID, "Code": r.Code ?? "", "Name": r.Name ?? "", "Description": r.Description ?? "",
      "Sales Unit Price": r.SalesDetails?.UnitPrice ?? "", "Sales Account": r.SalesDetails?.AccountCode ?? "", "Sales Tax Type": r.SalesDetails?.TaxType ?? "",
      "Purchase Unit Price": r.PurchaseDetails?.UnitPrice ?? "", "Purchase Account": r.PurchaseDetails?.AccountCode ?? "",
      "Tracked As Inventory": r.IsTrackedAsInventory ? "Yes" : "",
    }],
  },
  {
    id: "account", label: "Chart of Accounts", group: "list",
    xeroEntity: "Accounts", supports: DL, hasDateFilter: false,
    columns: ["Account ID", "Code", "Name", "Type", "Tax Type", "Description", "Class", "Status"],
    toRows: (r) => [{
      "Account ID": r.AccountID, "Code": r.Code ?? "", "Name": r.Name ?? "", "Type": r.Type ?? "",
      "Tax Type": r.TaxType ?? "", "Description": r.Description ?? "", "Class": r.Class ?? "", "Status": r.Status ?? "",
    }],
  },
  {
    id: "payment", label: "Payments", group: "other",
    xeroEntity: "Payments", supports: DL, hasDateFilter: true, dateField: "Date",
    columns: ["Payment ID", "Date", "Amount", "Reference", "Payment Type", "Status", "Invoice Number", "Account Code", "Currency Rate"],
    toRows: (r) => [{
      "Payment ID": r.PaymentID, "Date": xeroDate(r.Date) ?? "", "Amount": r.Amount ?? "", "Reference": r.Reference ?? "",
      "Payment Type": r.PaymentType ?? "", "Status": r.Status ?? "", "Invoice Number": r.Invoice?.InvoiceNumber ?? "",
      "Account Code": r.Account?.Code ?? "", "Currency Rate": r.CurrencyRate ?? "",
    }],
  },
];

export const XERO_ENTITIES_BY_ID = new Map(XERO_ENTITIES.map((e) => [e.id, e]));
export const getXeroEntity = (id: string) => XERO_ENTITIES_BY_ID.get(id);

export const XERO_GROUPS = [
  { key: "customer", label: "Sales" },
  { key: "vendor", label: "Purchases" },
  { key: "other", label: "Banking & Other" },
  { key: "list", label: "Lists" },
];
