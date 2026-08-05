/**
 * Xero entity registry for Data Studio (read + write).
 *
 * Xero's model differs from QBO: Contacts (not separate customers/vendors),
 * ACCREC/ACCPAY invoices, Tracking Categories (not Class), TaxType codes, and
 * no SyncToken (updates match by the record's Xero id). Xero also resolves
 * Contact/Account/Item/Tax references by name/code inline, so imports don't need
 * a separate ref-resolution pass.
 *
 * Delete semantics differ per entity: transactions are set to DELETED (drafts)
 * or VOIDED (authorised); contacts are ARCHIVED; items/accounts are HTTP-deleted.
 */

import { xeroDate } from "./client";
import { str, num, dateStr } from "../builders";

type Row = Record<string, any>;
export type XeroGroup = "customer" | "vendor" | "other" | "list";
export type XeroDeleteVia = "status" | "archive" | "http" | "none";

export interface XeroBuildResult { payload: any; xeroId?: string; }

export interface XeroEntity {
  id: string;
  label: string;
  group: XeroGroup;
  xeroEntity: string;                 // plural endpoint, e.g. "Invoices"
  where?: string;                     // base read filter
  supports: { upload: boolean; download: boolean; delete: boolean; modify: boolean };
  columns: string[];
  hasDateFilter: boolean;
  dateField?: string;
  note?: string;
  toRows: (r: any) => Row[];
  // write
  docKey?: string;                    // grouping column for import
  idColumn?: string;                  // template column holding the Xero id
  xeroIdKey?: string;                 // Xero JSON id property (e.g. "InvoiceID")
  deleteVia?: XeroDeleteVia;
  build?: (doc: { key: string; rows: Row[] }) => XeroBuildResult;
}

const DL = { upload: false, download: true, delete: false, modify: false };
const FULL = { upload: true, download: true, delete: true, modify: true };

const phone = (r: any) => (r.Phones || []).find((p: any) => p.PhoneNumber)?.PhoneNumber ?? "";
const addr = (r: any) => (r.Addresses || [])[0] || {};
const tracking = (li: any) => (li.Tracking || [])[0] || {};

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

// Build Xero LineItems from a document's rows.
function buildLines(rows: Row[]): any[] {
  const out: any[] = [];
  for (const row of rows) {
    const desc = str(row["Description"]);
    const acct = str(row["Account Code"]);
    const item = str(row["Item Code"]);
    const amount = num(row["Line Amount"]);
    const qty = num(row["Quantity"]);
    const unit = num(row["Unit Amount"]);
    if (!desc && !acct && amount == null && unit == null) continue;
    const line: any = {
      Description: desc,
      Quantity: qty,
      UnitAmount: unit,
      AccountCode: acct,
      ItemCode: item,
      TaxType: str(row["Tax Type"]),
      LineAmount: amount,
    };
    const tCat = str(row["Tracking Category"]);
    const tOpt = str(row["Tracking Option"]);
    if (tCat && tOpt) line.Tracking = [{ Name: tCat, Option: tOpt }];
    out.push(line);
  }
  return out;
}

// Factory for invoice-style builders (ACCREC / ACCPAY / credit notes / quotes).
function makeDocBuilder(opts: {
  numberCol: string; numberField: string; idColumn: string; idKey: string;
  type?: string; dueCol?: string; expiryCol?: string;
}) {
  return (doc: { key: string; rows: Row[] }): XeroBuildResult => {
    const h = doc.rows[0];
    const payload: any = {
      Contact: { Name: str(h["Contact"]) },
      LineItems: buildLines(doc.rows),
      Date: dateStr(h["Date"]),
    };
    if (str(h["Reference"])) payload.Reference = str(h["Reference"]);
    if (str(h["Currency"])) payload.CurrencyCode = str(h["Currency"]);
    if (opts.type) payload.Type = str(h["Type"]) || opts.type;
    if (opts.dueCol && dateStr(h[opts.dueCol])) payload.DueDate = dateStr(h[opts.dueCol]);
    if (opts.expiryCol && dateStr(h[opts.expiryCol])) payload.ExpiryDate = dateStr(h[opts.expiryCol]);
    if (str(h["Status"])) payload.Status = str(h["Status"]);
    if (str(h["Title"])) payload.Title = str(h["Title"]);
    const number = str(h[opts.numberCol]);
    if (number) payload[opts.numberField] = number;
    const id = str(h[opts.idColumn]);
    if (id) payload[opts.idKey] = id;
    if (!payload.Contact.Name) throw new Error("Contact is required");
    if (!payload.LineItems?.length) throw new Error("At least one line item is required");
    return { payload, xeroId: id };
  };
}

export const XERO_ENTITIES: XeroEntity[] = [
  {
    id: "contact", label: "Contacts", group: "list",
    xeroEntity: "Contacts", supports: FULL, hasDateFilter: false,
    idColumn: "Contact ID", xeroIdKey: "ContactID", deleteVia: "archive",
    columns: ["Contact ID", "Name", "First Name", "Last Name", "Email", "Phone", "Account Number", "Tax Number", "Is Customer", "Is Supplier", "Default Currency", "Address Line 1", "City", "Region", "Postal Code", "Country"],
    toRows: (r) => [{
      "Contact ID": r.ContactID, "Name": r.Name, "First Name": r.FirstName ?? "", "Last Name": r.LastName ?? "",
      "Email": r.EmailAddress ?? "", "Phone": phone(r), "Account Number": r.AccountNumber ?? "", "Tax Number": r.TaxNumber ?? "",
      "Is Customer": r.IsCustomer ? "Yes" : "", "Is Supplier": r.IsSupplier ? "Yes" : "", "Default Currency": r.DefaultCurrency ?? "",
      "Address Line 1": addr(r).AddressLine1 ?? "", "City": addr(r).City ?? "", "Region": addr(r).Region ?? "", "Postal Code": addr(r).PostalCode ?? "", "Country": addr(r).Country ?? "",
    }],
    build: (doc) => {
      const h = doc.rows[0];
      const payload: any = {
        Name: str(h["Name"]),
        FirstName: str(h["First Name"]),
        LastName: str(h["Last Name"]),
        EmailAddress: str(h["Email"]),
        AccountNumber: str(h["Account Number"]),
        TaxNumber: str(h["Tax Number"]),
      };
      if (str(h["Phone"])) payload.Phones = [{ PhoneType: "DEFAULT", PhoneNumber: str(h["Phone"]) }];
      const line1 = str(h["Address Line 1"]);
      if (line1 || str(h["City"])) payload.Addresses = [{ AddressType: "STREET", AddressLine1: line1, City: str(h["City"]), Region: str(h["Region"]), PostalCode: str(h["Postal Code"]), Country: str(h["Country"]) }];
      const id = str(h["Contact ID"]);
      if (id) payload.ContactID = id;
      if (!payload.Name) throw new Error("Contact Name is required");
      return { payload, xeroId: id };
    },
  },
  {
    id: "invoice", label: "Sales Invoices", group: "customer",
    xeroEntity: "Invoices", where: 'Type=="ACCREC"', supports: FULL, hasDateFilter: true, dateField: "Date",
    docKey: "Invoice Number", idColumn: "Invoice ID", xeroIdKey: "InvoiceID", deleteVia: "status",
    columns: ["Invoice ID", "Invoice Number", "Contact", "Date", "Due Date", "Status", "Reference", "Currency", ...LINE_COLS, "Total"],
    toRows: (r) => lineDocRows(r, {
      "Invoice ID": r.InvoiceID, "Invoice Number": r.InvoiceNumber ?? "", "Contact": r.Contact?.Name ?? "",
      "Date": xeroDate(r.Date) ?? "", "Due Date": xeroDate(r.DueDate) ?? "", "Status": r.Status ?? "",
      "Reference": r.Reference ?? "", "Currency": r.CurrencyCode ?? "", "Total": r.Total ?? "",
    }),
    build: makeDocBuilder({ numberCol: "Invoice Number", numberField: "InvoiceNumber", idColumn: "Invoice ID", idKey: "InvoiceID", type: "ACCREC", dueCol: "Due Date" }),
  },
  {
    id: "bill", label: "Bills", group: "vendor",
    xeroEntity: "Invoices", where: 'Type=="ACCPAY"', supports: FULL, hasDateFilter: true, dateField: "Date",
    docKey: "Bill Number", idColumn: "Invoice ID", xeroIdKey: "InvoiceID", deleteVia: "status",
    columns: ["Invoice ID", "Bill Number", "Contact", "Date", "Due Date", "Status", "Reference", "Currency", ...LINE_COLS, "Total"],
    toRows: (r) => lineDocRows(r, {
      "Invoice ID": r.InvoiceID, "Bill Number": r.InvoiceNumber ?? "", "Contact": r.Contact?.Name ?? "",
      "Date": xeroDate(r.Date) ?? "", "Due Date": xeroDate(r.DueDate) ?? "", "Status": r.Status ?? "",
      "Reference": r.Reference ?? "", "Currency": r.CurrencyCode ?? "", "Total": r.Total ?? "",
    }),
    build: makeDocBuilder({ numberCol: "Bill Number", numberField: "InvoiceNumber", idColumn: "Invoice ID", idKey: "InvoiceID", type: "ACCPAY", dueCol: "Due Date" }),
  },
  {
    id: "creditnote", label: "Credit Notes", group: "customer",
    xeroEntity: "CreditNotes", supports: FULL, hasDateFilter: true, dateField: "Date",
    docKey: "Credit Note Number", idColumn: "Credit Note ID", xeroIdKey: "CreditNoteID", deleteVia: "status",
    columns: ["Credit Note ID", "Credit Note Number", "Type", "Contact", "Date", "Status", "Currency", ...LINE_COLS, "Total"],
    toRows: (r) => lineDocRows(r, {
      "Credit Note ID": r.CreditNoteID, "Credit Note Number": r.CreditNoteNumber ?? "", "Type": r.Type ?? "",
      "Contact": r.Contact?.Name ?? "", "Date": xeroDate(r.Date) ?? "", "Status": r.Status ?? "", "Currency": r.CurrencyCode ?? "", "Total": r.Total ?? "",
    }),
    build: makeDocBuilder({ numberCol: "Credit Note Number", numberField: "CreditNoteNumber", idColumn: "Credit Note ID", idKey: "CreditNoteID", type: "ACCRECCREDIT" }),
  },
  {
    id: "quote", label: "Quotes", group: "customer",
    xeroEntity: "Quotes", supports: { upload: true, download: true, delete: false, modify: true }, hasDateFilter: true, dateField: "Date",
    docKey: "Quote Number", idColumn: "Quote ID", xeroIdKey: "QuoteID", deleteVia: "none",
    columns: ["Quote ID", "Quote Number", "Contact", "Date", "Expiry Date", "Status", "Title", "Reference", "Currency", ...LINE_COLS, "Total"],
    toRows: (r) => lineDocRows(r, {
      "Quote ID": r.QuoteID, "Quote Number": r.QuoteNumber ?? "", "Contact": r.Contact?.Name ?? "",
      "Date": xeroDate(r.Date) ?? "", "Expiry Date": xeroDate(r.ExpiryDate) ?? "", "Status": r.Status ?? "",
      "Title": r.Title ?? "", "Reference": r.Reference ?? "", "Currency": r.CurrencyCode ?? "", "Total": r.Total ?? "",
    }),
    build: makeDocBuilder({ numberCol: "Quote Number", numberField: "QuoteNumber", idColumn: "Quote ID", idKey: "QuoteID", expiryCol: "Expiry Date" }),
  },
  {
    id: "item", label: "Items", group: "list",
    xeroEntity: "Items", supports: FULL, hasDateFilter: false,
    idColumn: "Item ID", xeroIdKey: "ItemID", deleteVia: "http",
    columns: ["Item ID", "Code", "Name", "Description", "Sales Unit Price", "Sales Account", "Sales Tax Type", "Purchase Unit Price", "Purchase Account", "Tracked As Inventory"],
    toRows: (r) => [{
      "Item ID": r.ItemID, "Code": r.Code ?? "", "Name": r.Name ?? "", "Description": r.Description ?? "",
      "Sales Unit Price": r.SalesDetails?.UnitPrice ?? "", "Sales Account": r.SalesDetails?.AccountCode ?? "", "Sales Tax Type": r.SalesDetails?.TaxType ?? "",
      "Purchase Unit Price": r.PurchaseDetails?.UnitPrice ?? "", "Purchase Account": r.PurchaseDetails?.AccountCode ?? "",
      "Tracked As Inventory": r.IsTrackedAsInventory ? "Yes" : "",
    }],
    build: (doc) => {
      const h = doc.rows[0];
      const code = str(h["Code"]);
      if (!code) throw new Error("Item Code is required");
      const payload: any = { Code: code, Name: str(h["Name"]), Description: str(h["Description"]) };
      const sup = num(h["Sales Unit Price"]); const sacc = str(h["Sales Account"]); const stax = str(h["Sales Tax Type"]);
      if (sup != null || sacc || stax) payload.SalesDetails = { UnitPrice: sup, AccountCode: sacc, TaxType: stax };
      const pup = num(h["Purchase Unit Price"]); const pacc = str(h["Purchase Account"]);
      if (pup != null || pacc) payload.PurchaseDetails = { UnitPrice: pup, AccountCode: pacc };
      const id = str(h["Item ID"]);
      if (id) payload.ItemID = id;
      return { payload, xeroId: id };
    },
  },
  {
    id: "account", label: "Chart of Accounts", group: "list",
    xeroEntity: "Accounts", supports: FULL, hasDateFilter: false,
    idColumn: "Account ID", xeroIdKey: "AccountID", deleteVia: "http",
    columns: ["Account ID", "Code", "Name", "Type", "Tax Type", "Description", "Class", "Status"],
    toRows: (r) => [{
      "Account ID": r.AccountID, "Code": r.Code ?? "", "Name": r.Name ?? "", "Type": r.Type ?? "",
      "Tax Type": r.TaxType ?? "", "Description": r.Description ?? "", "Class": r.Class ?? "", "Status": r.Status ?? "",
    }],
    build: (doc) => {
      const h = doc.rows[0];
      const code = str(h["Code"]); const name = str(h["Name"]); const type = str(h["Type"]);
      if (!code || !name || !type) throw new Error("Account needs Code, Name and Type");
      const payload: any = { Code: code, Name: name, Type: type, TaxType: str(h["Tax Type"]), Description: str(h["Description"]) };
      const id = str(h["Account ID"]);
      if (id) payload.AccountID = id;
      return { payload, xeroId: id };
    },
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
