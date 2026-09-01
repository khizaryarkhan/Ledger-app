/**
 * Reverse mappers: QBO record → template rows (the inverse of builders.ts).
 *
 * Used by Download and by the "Sample (Your QuickBooks)" sheet in templates.
 * Each mapper returns an ARRAY of rows — one per line item — so multi-line
 * documents are fully represented, with the header fields repeated on each row.
 * Names for Class / Location / Tax code / Item etc. are resolved id → name via
 * the RefResolver so nested refs are captured, not left blank.
 */

import type { RefResolver } from "./ref-resolver";
import { refDisplayName } from "./ref-resolver";
import type { SheetRow } from "./types";

type Row = SheetRow;

function putAddress(row: Row, prefix: string, addr: any) {
  if (!addr) return;
  const set = (k: string, v: any) => { if (v != null && v !== "") row[`${prefix} ${k}`] = v; };
  set("Line 1", addr.Line1);
  set("Line 2", addr.Line2);
  set("Line 3", addr.Line3);
  set("City", addr.City);
  set("Postal Code", addr.PostalCode);
  set("Country", addr.Country);
  set("State", addr.CountrySubDivisionCode);
}

/**
 * Resolve a QuickBooks Entity ref that may point at a customer, vendor or
 * employee (deposit lines, some expense lines). QBO normally inlines `name`;
 * the fallback walks the three lists in order of likelihood.
 */
async function entityRefName(ref: any, refs: RefResolver): Promise<string | undefined> {
  if (!ref) return undefined;
  if (ref.name) return ref.name;
  const kinds = ref.type === "Vendor" ? (["Vendor", "Customer", "Employee"] as const)
    : ref.type === "Employee" ? (["Employee", "Vendor", "Customer"] as const)
    : (["Customer", "Vendor", "Employee"] as const);
  for (const kind of kinds) {
    const name = await refs.nameFor(kind, ref.value);
    if (name) return name;
  }
  return undefined;
}

const taxable = (ref: any): number | undefined =>
  ref?.value == null ? undefined : (ref.value === "NON" || ref.value === "0" ? 0 : 1);

// ── Sales transactions (Invoice / Estimate / CreditMemo / SalesReceipt / RefundReceipt) ──

export interface SalesRowOpts {
  docNoCol: string;
  customerCol: string;
  dateCol: string;
  dueDateCol?: string;        // Invoice
  expiryCol?: string;         // Estimate
  statusCol?: string;         // Estimate
  messageCol: string;         // "Message displayed on X"
  depositToCol?: string;      // SalesReceipt "Deposit To" / RefundReceipt "Refunded From"
  paymentMethodCol?: string;
}

export function makeSalesRowMapper(opts: SalesRowOpts) {
  return async function toRows(r: any, refs: RefResolver): Promise<Row[]> {
    const header: Row = {};
    const set = (k: string, v: any) => { if (v != null && v !== "") header[k] = v; };

    set("Id", r.Id);
    set("SyncToken", r.SyncToken);
    set(opts.docNoCol, r.DocNumber);
    set(opts.customerCol, await refDisplayName(r.CustomerRef, "Customer", refs));
    set(opts.dateCol, r.TxnDate);
    if (opts.dueDateCol) set(opts.dueDateCol, r.DueDate);
    if (opts.expiryCol) set(opts.expiryCol, r.ExpirationDate);
    if (opts.statusCol) set(opts.statusCol, r.TxnStatus);
    set("Memo", r.PrivateNote);
    set(opts.messageCol, r.CustomerMemo?.value);
    set("Email", r.BillEmail?.Address);
    set("Currency Code", r.CurrencyRef?.value);
    set("Exchange Rate", r.ExchangeRate);
    set("Location", await refDisplayName(r.DepartmentRef, "Department", refs));
    set("Class", await refDisplayName(r.ClassRef, "Class", refs));
    set("Ship Via", r.ShipMethodRef?.name ?? r.ShipMethodRef?.value);
    set("Terms", await refDisplayName(r.SalesTermRef, "Term", refs));
    set("Sales Tax Amount", r.TxnTaxDetail?.TotalTax);
    const headerTaxName = await refDisplayName(r.TxnTaxDetail?.TxnTaxCodeRef, "TaxCode", refs);
    if (headerTaxName) set("Sales Tax Code", headerTaxName);
    putAddress(header, "Billing Address", r.BillAddr);
    putAddress(header, "Shipping Address", r.ShipAddr);
    if (opts.depositToCol) set(opts.depositToCol, await refDisplayName(r.DepositToAccountRef, "Account", refs));
    if (opts.paymentMethodCol) set(opts.paymentMethodCol, await refDisplayName(r.PaymentMethodRef, "PaymentMethod", refs));

    // Discount line (if any) → header discount columns.
    const discountLine = (r.Line || []).find((l: any) => l.DetailType === "DiscountLineDetail");
    if (discountLine) {
      const d = discountLine.DiscountLineDetail || {};
      if (d.PercentBased) set("Discount Percent", d.DiscountPercent);
      else set("Discount Amount", discountLine.Amount);
    }

    // One row per sales line.
    const lines = (r.Line || []).filter((l: any) => l.DetailType === "SalesItemLineDetail");
    const rows: Row[] = [];
    for (const line of lines) {
      const d = line.SalesItemLineDetail || {};
      const row: Row = { ...header };
      row["Product/Service"] = await refDisplayName(d.ItemRef, "Item", refs);
      if (line.Description != null) row["Product/Service Description"] = line.Description;
      if (d.Qty != null) row["Product/Service Quantity"] = d.Qty;
      if (d.UnitPrice != null) row["Product/Service Rate"] = d.UnitPrice;
      if (line.Amount != null) row["Product/Service Amount"] = line.Amount;
      if (d.ServiceDate) row["Service Date"] = d.ServiceDate;
      const cls = await refDisplayName(d.ClassRef, "Class", refs);
      if (cls) row["Product/Service Class"] = cls;
      const t = taxable(d.TaxCodeRef);
      if (t != null) row["Product/Service Taxable"] = t;
      // Line-level VAT/tax code name → surface into Sales Tax Code when no header code.
      if (!row["Sales Tax Code"]) {
        const lineTax = await refDisplayName(d.TaxCodeRef, "TaxCode", refs);
        if (lineTax) row["Sales Tax Code"] = lineTax;
      }
      rows.push(row);
    }
    return rows.length ? rows : [header];
  };
}

// ── Vendor account/item txns (Bill / VendorCredit / PurchaseOrder) ────────────

export interface VendorRowOpts {
  docNoCol: string;
  dateCol: string;
  dueDateCol?: string;
  statusCol?: string;
  addrPrefix?: string; // "Mailing Address"
}

export function makeVendorRowMapper(opts: VendorRowOpts) {
  return async function toRows(r: any, refs: RefResolver): Promise<Row[]> {
    const header: Row = {};
    const set = (k: string, v: any) => { if (v != null && v !== "") header[k] = v; };
    set("Id", r.Id);
    set("SyncToken", r.SyncToken);
    set(opts.docNoCol, r.DocNumber);
    set("Vendor", await refDisplayName(r.VendorRef, "Vendor", refs));
    set(opts.dateCol, r.TxnDate);
    if (opts.dueDateCol) set(opts.dueDateCol, r.DueDate);
    if (opts.statusCol) set(opts.statusCol, r.POStatus);
    set("Memo", r.PrivateNote);
    set("Currency Code", r.CurrencyRef?.value);
    set("Location", await refDisplayName(r.DepartmentRef, "Department", refs));
    if (opts.addrPrefix) putAddress(header, opts.addrPrefix, r.VendorAddr);

    return expenseLinesToRows(r, header, refs);
  };
}

// ── Purchase (Expense / Check / CreditCardCredit) ─────────────────────────────

export interface PurchaseRowOpts {
  docNoCol: string;
  bankCol: string;     // "Account" / "Bank Account"
  addrPrefix?: string;
}

export function makePurchaseRowMapper(opts: PurchaseRowOpts) {
  return async function toRows(r: any, refs: RefResolver): Promise<Row[]> {
    const header: Row = {};
    const set = (k: string, v: any) => { if (v != null && v !== "") header[k] = v; };
    set("Id", r.Id);
    set("SyncToken", r.SyncToken);
    set(opts.docNoCol, r.DocNumber);
    set(opts.bankCol, await refDisplayName(r.AccountRef, "Account", refs));
    set("Payee", r.EntityRef?.name ?? (await refDisplayName(r.EntityRef, "Vendor", refs)));
    set("Payment Date", r.TxnDate);
    set("Memo", r.PrivateNote);
    set("Currency Code", r.CurrencyRef?.value);
    set("Location", await refDisplayName(r.DepartmentRef, "Department", refs));
    if (opts.addrPrefix) putAddress(header, opts.addrPrefix, r.VendorAddr);
    return expenseLinesToRows(r, header, refs);
  };
}

/** Shared: expand AccountBased + ItemBased expense lines into template rows. */
async function expenseLinesToRows(r: any, header: Row, refs: RefResolver): Promise<Row[]> {
  const rows: Row[] = [];
  for (const line of r.Line || []) {
    if (line.DetailType === "AccountBasedExpenseLineDetail") {
      const d = line.AccountBasedExpenseLineDetail || {};
      const row: Row = { ...header };
      row["Expense Account"] = await refDisplayName(d.AccountRef, "Account", refs);
      if (line.Description != null) row["Expense Description"] = line.Description;
      if (line.Amount != null) row["Expense Line Amount"] = line.Amount;
      if (d.BillableStatus) row["Expense Billable Status"] = d.BillableStatus;
      const cust = await refDisplayName(d.CustomerRef, "Customer", refs);
      if (cust) row["Expense Customer"] = cust;
      const cls = await refDisplayName(d.ClassRef, "Class", refs);
      if (cls) row["Expense Class"] = cls;
      const t = taxable(d.TaxCodeRef);
      if (t != null) row["Expense Taxable"] = t;
      rows.push(row);
    } else if (line.DetailType === "ItemBasedExpenseLineDetail") {
      const d = line.ItemBasedExpenseLineDetail || {};
      const row: Row = { ...header };
      row["Product/Service"] = await refDisplayName(d.ItemRef, "Item", refs);
      if (line.Description != null) row["Product/Service Description"] = line.Description;
      if (d.Qty != null) row["Product/Service Quantity"] = d.Qty;
      if (d.UnitPrice != null) row["Product/Service Rate"] = d.UnitPrice;
      if (line.Amount != null) row["Product/Service Amount"] = line.Amount;
      const cls = await refDisplayName(d.ClassRef, "Class", refs);
      if (cls) row["Product/Service Class"] = cls;
      rows.push(row);
    }
  }
  return rows.length ? rows : [header];
}

// ── Single-row transaction mappers ────────────────────────────────────────────

export async function mapReceivePaymentRow(r: any, refs: RefResolver): Promise<Row[]> {
  const header: Row = {};
  const set = (row: Row, k: string, v: any) => { if (v != null && v !== "") row[k] = v; };
  set(header, "Id", r.Id); set(header, "SyncToken", r.SyncToken);
  set(header, "Ref No", r.PaymentRefNum);
  set(header, "Reference No", r.PaymentRefNum);
  set(header, "Payment Date", r.TxnDate);
  set(header, "Customer", await refDisplayName(r.CustomerRef, "Customer", refs));
  set(header, "Payment method", await refDisplayName(r.PaymentMethodRef, "PaymentMethod", refs));
  set(header, "Deposit To Account Name", await refDisplayName(r.DepositToAccountRef, "Account", refs));
  set(header, "Memo", r.PrivateNote);
  set(header, "Currency Code", r.CurrencyRef?.value);

  // One row per applied invoice (a payment can settle many). Emit the invoice
  // NUMBER (resolved from the linked internal Id) and the amount applied to it,
  // so the file re-uploads and re-applies correctly.
  const applied = (r.Line || []).filter((l: any) => (l.LinkedTxn || []).some((x: any) => x.TxnType === "Invoice"));
  if (applied.length === 0) {
    const row = { ...header }; set(row, "Amount", r.TotalAmt); return [row];
  }
  const rows: Row[] = [];
  for (const l of applied) {
    const link = (l.LinkedTxn || []).find((x: any) => x.TxnType === "Invoice");
    const row: Row = { ...header };
    set(row, "Amount", l.Amount);
    set(row, "Invoice No", (await refs.invoiceNumberFor(link?.TxnId)) ?? link?.TxnId);
    rows.push(row);
  }
  return rows;
}

export async function mapBillPaymentRow(r: any, refs: RefResolver): Promise<Row[]> {
  const header: Row = {};
  const set = (row: Row, k: string, v: any) => { if (v != null && v !== "") row[k] = v; };
  set(header, "Id", r.Id); set(header, "SyncToken", r.SyncToken);
  set(header, "Ref No", r.DocNumber);
  set(header, "Vendor", await refDisplayName(r.VendorRef, "Vendor", refs));
  set(header, "Payment Date", r.TxnDate);
  set(header, "Bank or CC Account", await refDisplayName(r.CheckPayment?.BankAccountRef ?? r.CreditCardPayment?.CCAccountRef, "Account", refs));
  set(header, "Memo", r.PrivateNote);
  set(header, "Currency Code", r.CurrencyRef?.value);

  // One row per applied bill (a bill payment can settle many).
  const applied = (r.Line || []).filter((l: any) => (l.LinkedTxn || []).some((x: any) => x.TxnType === "Bill"));
  if (applied.length === 0) {
    const row = { ...header }; set(row, "Amount", r.TotalAmt); return [row];
  }
  const rows: Row[] = [];
  for (const l of applied) {
    const link = (l.LinkedTxn || []).find((x: any) => x.TxnType === "Bill");
    const row: Row = { ...header };
    set(row, "Amount", l.Amount);
    set(row, "Bill No", (await refs.billNumberFor(link?.TxnId)) ?? link?.TxnId);
    rows.push(row);
  }
  return rows;
}

export async function mapJournalEntryRows(r: any, refs: RefResolver): Promise<Row[]> {
  const header: Row = {};
  header["Id"] = r.Id; header["SyncToken"] = r.SyncToken;
  if (r.DocNumber) header["Journal No"] = r.DocNumber;
  if (r.TxnDate) header["Journal Date"] = r.TxnDate;
  if (r.PrivateNote) header["Memo"] = r.PrivateNote;
  if (r.CurrencyRef?.value) header["Currency Code"] = r.CurrencyRef.value;
  const rows: Row[] = [];
  for (const line of r.Line || []) {
    const d = line.JournalEntryLineDetail;
    if (!d) continue;
    const row: Row = { ...header };
    row["Account"] = await refDisplayName(d.AccountRef, "Account", refs);
    // Debit positive, Credit negative — matches the builder's convention.
    row["Amount"] = d.PostingType === "Credit" ? -Math.abs(line.Amount ?? 0) : Math.abs(line.Amount ?? 0);
    if (line.Description) row["Description"] = line.Description;
    const name = await refDisplayName(d.Entity?.EntityRef, "Customer", refs);
    if (name) row["Name"] = name;
    const cls = await refDisplayName(d.ClassRef, "Class", refs);
    if (cls) row["Class"] = cls;
    const dept = await refDisplayName(d.DepartmentRef, "Department", refs);
    if (dept) row["Location"] = dept;
    rows.push(row);
  }
  return rows.length ? rows : [header];
}

/**
 * Bank Deposit → rows.
 *
 * Every column the entity declares is populated here. Nine of them previously
 * weren't — most visibly "Received From", which left the payer column blank on
 * every exported deposit and made the file useless for reclassifying, since the
 * one thing you need to recognise a deposit line is who paid.
 *
 * "Received From" is a QuickBooks Entity ref that may name a customer, a vendor
 * or an employee, so it's resolved against all three (QBO usually inlines the
 * name, in which case no lookup is needed at all).
 */
export async function mapDepositRows(r: any, refs: RefResolver): Promise<Row[]> {
  const header: Row = {};
  const set = (k: string, v: any) => { if (v != null && v !== "") header[k] = v; };

  set("Id", r.Id);
  set("SyncToken", r.SyncToken);
  set("Deposit No", r.DocNumber);
  set("Date", r.TxnDate);
  header["Deposit To Account"] = await refDisplayName(r.DepositToAccountRef, "Account", refs);
  set("Memo", r.PrivateNote);
  set("Currency Code", r.CurrencyRef?.value);
  set("Exchange Rate", r.ExchangeRate);
  set("Location", await refDisplayName(r.DepartmentRef, "Department", refs));

  // Cash back — a deposit can hold back part of the total as cash.
  if (r.CashBack) {
    set("Cash back goes to", await refDisplayName(r.CashBack.AccountRef, "Account", refs));
    set("Cash back memo", r.CashBack.Memo);
    set("Cash back amount", r.CashBack.Amount);
  }

  const rows: Row[] = [];
  for (const line of r.Line || []) {
    const d = line.DepositLineDetail;
    if (!d) continue;
    const row: Row = { ...header };
    const put = (k: string, v: any) => { if (v != null && v !== "") row[k] = v; };

    // The line's own QuickBooks id — an Update sends it back so QBO keeps the
    // lines you kept and deletes the ones you removed, instead of appending.
    put("Line Id", line.Id);
    put("Line Account", await refDisplayName(d.AccountRef, "Account", refs));
    put("Line Amount", line.Amount);
    put("Line Description", line.Description);
    put("Line Payment Method", await refDisplayName(d.PaymentMethodRef, "PaymentMethod", refs));
    put("Line Class", await refDisplayName(d.ClassRef, "Class", refs));
    put("Line Ref No", d.CheckNum);
    put("Received From", await entityRefName(d.Entity, refs));

    // A deposit line can instead be an existing payment being deposited. The
    // id is what re-linking needs, so that's what's exported — QBO's LinkedTxn
    // carries no document number.
    const linked = (line.LinkedTxn || [])[0];
    if (linked) {
      put("Linked Transaction Type", linked.TxnType);
      put("Linked Transaction Number", linked.TxnId);
    }

    rows.push(row);
  }
  return rows.length ? rows : [header];
}

export async function mapTransferRow(r: any, refs: RefResolver): Promise<Row[]> {
  const row: Row = {};
  row["Id"] = r.Id; row["SyncToken"] = r.SyncToken;
  row["Transfer Funds From"] = await refDisplayName(r.FromAccountRef, "Account", refs);
  row["Transfer Funds To"] = await refDisplayName(r.ToAccountRef, "Account", refs);
  if (r.Amount != null) row["Transfer Amount"] = r.Amount;
  if (r.TxnDate) row["Date"] = r.TxnDate;
  if (r.PrivateNote) row["Memo"] = r.PrivateNote;
  return [row];
}

export async function mapTimeActivityRow(r: any, refs: RefResolver): Promise<Row[]> {
  const row: Row = {};
  const set = (k: string, v: any) => { if (v != null && v !== "") row[k] = v; };
  set("Id", r.Id); set("SyncToken", r.SyncToken);
  set("Name", r.EmployeeRef?.name ?? r.VendorRef?.name);
  set("Date", r.TxnDate);
  set("Hours", r.Hours);
  set("Minutes", r.Minutes);
  set("Description", r.Description);
  set("Billable Status", r.BillableStatus);
  set("Bill at $ per hour", r.HourlyRate);
  set("Customer", await refDisplayName(r.CustomerRef, "Customer", refs));
  set("Service", await refDisplayName(r.ItemRef, "Item", refs));
  set("Class", await refDisplayName(r.ClassRef, "Class", refs));
  return [row];
}

// ── Master lists ──────────────────────────────────────────────────────────────

export async function mapCustomerRow(r: any, refs?: RefResolver): Promise<Row[]> {
  const row: Row = {};
  const set = (k: string, v: any) => { if (v != null && v !== "") row[k] = v; };
  set("Id", r.Id); set("SyncToken", r.SyncToken);
  set("Title", r.Title); set("First Name", r.GivenName); set("Middle Name", r.MiddleName);
  set("Last Name", r.FamilyName); set("Suffix", r.Suffix); set("Company", r.CompanyName);
  set("Display Name As", r.DisplayName);
  set("Print On Check As", r.PrintOnCheckName);
  set("Email", r.PrimaryEmailAddr?.Address);
  set("Phone", r.PrimaryPhone?.FreeFormNumber);
  set("Mobile", r.Mobile?.FreeFormNumber);
  set("Fax", r.Fax?.FreeFormNumber);
  set("Website", r.WebAddr?.URI);
  set("Notes", r.Notes);
  set("Tax Resale No", r.ResaleNumber);
  set("Preferred Delivery Method", r.PreferredDeliveryMethod);
  set("Bill With Parent", r.BillWithParent ? 1 : 0);
  set("Customer Taxable", r.Taxable ? 1 : 0);
  set("Currency Code", r.CurrencyRef?.value);
  if (refs) {
    set("Terms", await refDisplayName(r.SalesTermRef, "Term", refs));
    set("Preferred Payment Method", await refDisplayName(r.PaymentMethodRef, "PaymentMethod", refs));
    set("Parent Customer", await refDisplayName(r.ParentRef, "Customer", refs));
  }
  putAddress(row, "Billing Address", r.BillAddr);
  putAddress(row, "Shipping Address", r.ShipAddr);
  return [row];
}

export async function mapVendorRow(r: any): Promise<Row[]> {
  const row: Row = {};
  const set = (k: string, v: any) => { if (v != null && v !== "") row[k] = v; };
  set("Id", r.Id); set("SyncToken", r.SyncToken);
  set("Display Name As", r.DisplayName); set("Title", r.Title);
  set("First Name", r.GivenName); set("Middle Name", r.MiddleName); set("Last Name", r.FamilyName);
  set("Suffix", r.Suffix); set("Company", r.CompanyName);
  set("Email", r.PrimaryEmailAddr?.Address);
  set("Phone", r.PrimaryPhone?.FreeFormNumber);
  set("Mobile", r.Mobile?.FreeFormNumber);
  set("Website", r.WebAddr?.URI);
  set("Account no", r.AcctNum);
  set("Tax ID", r.TaxIdentifier);
  set("Track payments for 1099", r.Vendor1099 ? 1 : 0);
  set("Currency Code", r.CurrencyRef?.value);
  putAddress(row, "Billing Address", r.BillAddr);
  return [row];
}

export async function mapItemRow(r: any, refs: RefResolver): Promise<Row[]> {
  const row: Row = {};
  const set = (k: string, v: any) => { if (v != null && v !== "") row[k] = v; };
  set("Id", r.Id); set("SyncToken", r.SyncToken);
  set("Name", r.Name); set("Type", r.Type); set("SKU", r.Sku);
  set("Price/Rate", r.UnitPrice); set("Cost", r.PurchaseCost);
  set("Sales Description", r.Description); set("Purchase Description", r.PurchaseDesc);
  set("Taxable", r.Taxable ? 1 : 0);
  set("Income Account", await refDisplayName(r.IncomeAccountRef, "Account", refs));
  set("Expense Account", await refDisplayName(r.ExpenseAccountRef, "Account", refs));
  set("Initial Quantity On Hand", r.QtyOnHand);
  return [row];
}

export async function mapAccountRow(r: any): Promise<Row[]> {
  const row: Row = {};
  const set = (k: string, v: any) => { if (v != null && v !== "") row[k] = v; };
  set("Id", r.Id); set("SyncToken", r.SyncToken);
  set("Name", r.Name); set("Account Type", r.AccountType); set("Account Subtype", r.AccountSubType);
  set("Account Number", r.AcctNum); set("Description", r.Description);
  set("Currency Code", r.CurrencyRef?.value);
  return [row];
}

export async function mapEmployeeRow(r: any): Promise<Row[]> {
  const row: Row = {};
  const set = (k: string, v: any) => { if (v != null && v !== "") row[k] = v; };
  set("Id", r.Id); set("SyncToken", r.SyncToken);
  set("Title", r.Title); set("First Name", r.GivenName); set("Middle Name", r.MiddleName);
  set("Last Name", r.FamilyName); set("Suffix", r.Suffix); set("Display Name As", r.DisplayName);
  set("Email", r.PrimaryEmailAddr?.Address);
  set("Phone", r.PrimaryPhone?.FreeFormNumber);
  set("Mobile", r.Mobile?.FreeFormNumber);
  set("Employee No", r.EmployeeNumber);
  set("SSN", r.SSN);
  return [row];
}

export function makeSimpleListRowMapper() {
  return async function toRows(r: any, refs: RefResolver): Promise<Row[]> {
    const row: Row = { Id: r.Id, SyncToken: r.SyncToken, Name: r.Name };
    const parent = await refDisplayName(r.ParentRef, r.ParentRef ? "Class" : "Class", refs);
    if (parent) { row["Parent Class"] = parent; row["Parent Location"] = parent; }
    return [row];
  };
}
