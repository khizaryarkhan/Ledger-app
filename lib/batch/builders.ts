/**
 * QBO payload builders — turn grouped spreadsheet rows into the nested JSON
 * that the QuickBooks v3 create/update API expects.
 *
 * One builder per document "shape"; the registry (entities.ts) wires each
 * entity to the right builder with entity-specific options.
 */

import type { RefResolver } from "./ref-resolver";
import type { GroupedDoc, BuildResult, SheetRow } from "./types";
import { excelSerialToISO } from "./dates";

// ── cell coercion ───────────────────────────────────────────────────────────

export function str(v: any): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

export function num(v: any): number | undefined {
  if (v == null || v === "") return undefined;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? undefined : n;
}

export function bool(v: any): boolean | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "y", "t"].includes(s)) return true;
  if (["0", "false", "no", "n", "f"].includes(s)) return false;
  return undefined;
}

/**
 * Coerce a cell to a YYYY-MM-DD string. Handles JS Date, Excel serial, and
 * strings. Date columns are normalised upstream (lib/batch/dates) using the
 * org's locale; this is the last-line safety net, so ambiguous d/m vs m/d is
 * resolved only when a part is > 12 (proof), else assumed day-first.
 */
export function dateStr(v: any): string | undefined {
  if (v == null || v === "") return undefined;
  const pad = (n: number) => String(n).padStart(2, "0");
  // Use UTC parts — the Date represents a calendar day; local getters could
  // shift it across a timezone boundary.
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  if (typeof v === "number") return excelSerialToISO(v) ?? undefined; // pure integer math, no tz
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${pad(+iso[2])}-${pad(+iso[3])}`;
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3];
    if (y < 100) y += y < 70 ? 2000 : 1900;
    let day: number, mon: number;
    if (a > 12 && b <= 12) { day = a; mon = b; }
    else if (b > 12 && a <= 12) { mon = a; day = b; }
    else { day = a; mon = b; } // ambiguous → day-first (upstream already resolves per-locale)
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) return `${y}-${pad(mon)}-${pad(day)}`;
  }
  return undefined;
}

const first = (doc: GroupedDoc, col: string) => doc.rows[0]?.[col];

/** Build a QBO physical address object from a row + column prefix. */
function address(row: SheetRow, prefix: string) {
  const line1 = str(row[`${prefix} Line 1`]);
  const line2 = str(row[`${prefix} Line 2`]);
  const line3 = str(row[`${prefix} Line 3`]);
  const city = str(row[`${prefix} City`]);
  const postal = str(row[`${prefix} Postal Code`]);
  const country = str(row[`${prefix} Country`]);
  const state = str(row[`${prefix} State`]);
  if (!line1 && !city && !postal) return undefined;
  return {
    Line1: line1,
    Line2: line2,
    Line3: line3,
    City: city,
    PostalCode: postal,
    Country: country,
    CountrySubDivisionCode: state,
  };
}

// ── sales transactions (Invoice / Estimate / CreditMemo / SalesReceipt / RefundReceipt) ──

export interface SalesOpts {
  /** entity-specific extras */
  withDueDate?: boolean;
  withStatus?: boolean;        // Estimate TxnStatus
  withDepositAccount?: boolean; // SalesReceipt / RefundReceipt
  withPaymentMethod?: boolean;
  idColumn?: string;
}

export function makeSalesBuilder(opts: SalesOpts) {
  return async function build(doc: GroupedDoc, refs: RefResolver): Promise<BuildResult> {
    const h = doc.rows[0];
    const customer = await refs.resolve("Customer", first(doc, "Customer") ?? first(doc, "Customer "));
    if (!customer) throw new Error("Customer is required");

    // Tax handling adapts to the connected company's region (read from QBO):
    //  - US            → automated sales tax, lines use the "TAX"/"NON" codes.
    //  - IE/UK/PK/etc. → every line must carry a REAL VAT/GST code id, resolved
    //                    from the "Sales Tax Code" column; the US pseudo-code
    //                    "TAX" is rejected ("…must have a sales tax rate").
    const company = await refs.company();
    const headerTaxCode = await refs.tryResolve("TaxCode", first(doc, "Sales Tax Code"));
    let usedRealTaxCode = false;

    const Line: any[] = [];
    for (const row of doc.rows) {
      const itemName = str(row["Product/Service"]);
      const amount = num(row["Product/Service Amount"]);
      const qty = num(row["Product/Service Quantity"]);
      const rate = num(row["Product/Service Rate"]);
      if (!itemName && amount == null) continue;
      const item = itemName ? await refs.resolve("Item", itemName) : null;
      const cls = await refs.tryResolve("Class", row["Product/Service Class"] ?? row["Product/Service Class "]);
      const computed = amount ?? (qty != null && rate != null ? qty * rate : undefined);

      let taxRef: any;
      if (company.isUS) {
        // US automated sales tax expects the TAX/NON pseudo-codes.
        taxRef = { value: bool(row["Product/Service Taxable"]) === false ? "NON" : "TAX" };
      } else {
        const lineTaxCode = headerTaxCode ?? await refs.tryResolve("TaxCode", row["Sales Tax Code"]);
        if (lineTaxCode) { taxRef = { value: lineTaxCode.value }; usedRealTaxCode = true; }
      }

      Line.push({
        DetailType: "SalesItemLineDetail",
        Amount: computed ?? 0,
        Description: str(row["Product/Service Description"]),
        SalesItemLineDetail: {
          ItemRef: item ? { value: item.value, name: item.name } : undefined,
          Qty: qty,
          UnitPrice: rate,
          ServiceDate: dateStr(row["Service Date"]),
          ClassRef: cls ? { value: cls.value } : undefined,
          TaxCodeRef: taxRef,
        },
      });
    }
    if (Line.length === 0) throw new Error("At least one line item is required");

    const payload: any = {
      CustomerRef: { value: customer.value, name: customer.name },
      Line,
      TxnDate: dateStr(first(doc, Object.keys(h).find((k) => /date$/i.test(k) && !/due|service|ship|expir/i.test(k)) || "")),
      PrivateNote: str(first(doc, "Memo")),
      BillEmail: str(first(doc, "Email")) ? { Address: str(first(doc, "Email")) } : undefined,
      CustomerMemo: (() => {
        const msg = Object.keys(h).find((k) => /^Message displayed/i.test(k));
        return msg && str(h[msg]) ? { value: str(h[msg]) } : undefined;
      })(),
      CurrencyRef: str(first(doc, "Currency Code")) ? { value: str(first(doc, "Currency Code")) } : undefined,
    };

    // DocNumber
    const docNoCol = Object.keys(h).find((k) => /No$/i.test(k.trim()) && /Invoice|Estimate|Credit Memo|Sales Receipt|Refund Receipt/i.test(k));
    if (docNoCol && str(h[docNoCol])) payload.DocNumber = str(h[docNoCol]);

    if (opts.withDueDate) payload.DueDate = dateStr(first(doc, "Due Date"));
    if (opts.withStatus) payload.TxnStatus = str(first(doc, "Estimate Status"));
    if (opts.withDepositAccount) {
      const acct = await refs.tryResolve("Account", first(doc, "Deposit To") ?? first(doc, "Refunded From"));
      if (acct) payload.DepositToAccountRef = { value: acct.value };
    }
    if (opts.withPaymentMethod) {
      const pm = await refs.tryResolve("PaymentMethod", first(doc, "Payment Method") ?? first(doc, "Payment method"));
      if (pm) payload.PaymentMethodRef = { value: pm.value };
    }

    // Document-level class (whole-transaction class, e.g. "GK Galway").
    const headerClass = await refs.tryResolve("Class", first(doc, "Class"));
    if (headerClass) payload.ClassRef = { value: headerClass.value, name: headerClass.name };

    // Document-level location/department.
    const headerDept = await refs.tryResolve("Department", first(doc, "Location"));
    if (headerDept) payload.DepartmentRef = { value: headerDept.value };

    // Non-US tax: real VAT/GST codes were applied to the lines, so declare the
    // document tax mode (amounts exclusive of tax, per the estimate form). QBO
    // then computes the tax from the line codes; without GlobalTaxCalculation it
    // rejects the save. Left unset for US companies (automated sales tax).
    if (!company.isUS && usedRealTaxCode) {
      payload.GlobalTaxCalculation = "TaxExcluded";
    }

    const qboId = opts.idColumn ? str(h[opts.idColumn]) : undefined;
    return { payload: qboId ? { ...payload, Id: qboId } : payload, qboId };
  };
}

// ── receive payment ──────────────────────────────────────────────────────────

export async function buildReceivePayment(doc: GroupedDoc, refs: RefResolver): Promise<BuildResult> {
  const customer = await refs.resolve("Customer", first(doc, "Customer") ?? first(doc, "Customer "));
  if (!customer) throw new Error("Customer is required");

  // One payment can be applied across MANY invoices — each row (grouped by Ref
  // No) that names an "Invoice No" becomes an application line with its own
  // Amount, linked to that invoice. Rows without an invoice are left as an
  // unapplied credit only when NO row names one.
  const Line: any[] = [];
  for (const row of doc.rows) {
    const invNo = str(row["Invoice No"]);
    if (!invNo) continue;
    const amt = num(row["Amount"]);
    if (amt == null) throw new Error(`Amount is required for the payment applied to invoice ${invNo}`);
    const invId = await refs.resolveInvoiceId(invNo, customer.value);
    if (!invId) throw new Error(`Invoice "${invNo}" not found for customer ${customer.name}`);
    Line.push({ Amount: amt, LinkedTxn: [{ TxnId: invId, TxnType: "Invoice" }] });
  }

  // Applied → total is the sum of the application lines; otherwise fall back to
  // the header Amount (an unapplied customer payment / credit on account).
  const total = Line.length
    ? Math.round(Line.reduce((s, l) => s + Number(l.Amount || 0), 0) * 100) / 100
    : num(first(doc, "Amount"));

  const payload: any = {
    CustomerRef: { value: customer.value, name: customer.name },
    TotalAmt: total,
    TxnDate: dateStr(first(doc, "Payment Date")),
    PaymentRefNum: str(first(doc, "Reference No")) ?? str(first(doc, "Ref No")),
    PrivateNote: str(first(doc, "Memo")),
  };
  if (Line.length) payload.Line = Line;
  const pm = await refs.tryResolve("PaymentMethod", first(doc, "Payment method"));
  if (pm) payload.PaymentMethodRef = { value: pm.value };
  const acct = await refs.tryResolve("Account", first(doc, "Deposit To Account Name"));
  if (acct) payload.DepositToAccountRef = { value: acct.value };
  if (str(first(doc, "Currency Code"))) payload.CurrencyRef = { value: str(first(doc, "Currency Code")) };
  return { payload };
}

// ── vendor account/item-based txns (Bill / VendorCredit / PurchaseOrder) ──────

export interface VendorTxnOpts {
  entity: "Bill" | "VendorCredit" | "PurchaseOrder";
  withStatus?: boolean; // PO status
  idColumn?: string;
}

export function makeVendorTxnBuilder(opts: VendorTxnOpts) {
  return async function build(doc: GroupedDoc, refs: RefResolver): Promise<BuildResult> {
    const h = doc.rows[0];
    const vendor = await refs.resolve("Vendor", first(doc, "Vendor"));
    if (!vendor) throw new Error("Vendor is required");

    const Line = await buildExpenseLines(doc, refs);
    if (Line.length === 0) throw new Error("At least one expense or item line is required");

    const payload: any = {
      VendorRef: { value: vendor.value, name: vendor.name },
      Line,
      PrivateNote: str(first(doc, "Memo")),
    };
    const dateCol = opts.entity === "PurchaseOrder" ? "Purchase Order Date" : opts.entity === "Bill" ? "Bill Date" : "Payment Date";
    payload.TxnDate = dateStr(first(doc, dateCol));

    const docNoCol = opts.entity === "PurchaseOrder" ? "PO No" : opts.entity === "Bill" ? "Bill No" : "Ref No";
    if (str(first(doc, docNoCol))) payload.DocNumber = str(first(doc, docNoCol));
    if (opts.entity === "Bill") payload.DueDate = dateStr(first(doc, "Due Date"));
    if (opts.withStatus) payload.POStatus = str(first(doc, "Purchase Order Status"));
    if (str(first(doc, "Currency Code"))) payload.CurrencyRef = { value: str(first(doc, "Currency Code")) };

    const qboId = opts.idColumn ? str(h[opts.idColumn]) : undefined;
    return { payload: qboId ? { ...payload, Id: qboId } : payload, qboId };
  };
}

/** Build AccountBasedExpenseLineDetail + ItemBasedExpenseLineDetail lines shared by vendor txns. */
async function buildExpenseLines(doc: GroupedDoc, refs: RefResolver): Promise<any[]> {
  // Only US automated sales tax uses the "TAX" pseudo-code on expense lines;
  // non-US companies leave it unset (they apply VAT/GST differently) so the
  // save isn't rejected by an unknown code.
  const company = await refs.company();
  const usTax = (row: any) => (company.isUS && bool(row["Expense Taxable"]) ? { value: "TAX" } : undefined);
  const Line: any[] = [];
  for (const row of doc.rows) {
    // Account-based (category) line
    const acctName = str(row["Expense Account"] ?? row["Expense Account "]);
    const acctAmt = num(row["Expense Line Amount"]);
    if (acctName && acctAmt != null) {
      const acct = await refs.resolve("Account", acctName);
      const cust = await refs.tryResolve("Customer", row["Expense Customer"] ?? row["Expense Customer "]);
      const cls = await refs.tryResolve("Class", row["Expense Class"] ?? row["Expense Class "]);
      Line.push({
        DetailType: "AccountBasedExpenseLineDetail",
        Amount: acctAmt,
        Description: str(row["Expense Description"]),
        AccountBasedExpenseLineDetail: {
          AccountRef: acct ? { value: acct.value } : undefined,
          CustomerRef: cust ? { value: cust.value } : undefined,
          ClassRef: cls ? { value: cls.value } : undefined,
          BillableStatus: str(row["Expense Billable Status"]),
          TaxCodeRef: usTax(row),
        },
      });
    }
    // Item-based line
    const itemName = str(row["Product/Service"]);
    const itemAmt = num(row["Product/Service Amount"]);
    const qty = num(row["Product/Service Quantity"]);
    const rate = num(row["Product/Service Rate"]);
    if (itemName && (itemAmt != null || (qty != null && rate != null))) {
      const item = await refs.resolve("Item", itemName);
      const cls = await refs.tryResolve("Class", row["Product/Service Class"] ?? row["Product/Service Class "]);
      Line.push({
        DetailType: "ItemBasedExpenseLineDetail",
        Amount: itemAmt ?? (qty! * rate!),
        Description: str(row["Product/Service Description"]),
        ItemBasedExpenseLineDetail: {
          ItemRef: item ? { value: item.value } : undefined,
          Qty: qty,
          UnitPrice: rate,
          ClassRef: cls ? { value: cls.value } : undefined,
        },
      });
    }
  }
  return Line;
}

// ── Purchase (Expense / Check / Credit Card Credit) ──────────────────────────

export interface PurchaseOpts {
  paymentType: "Cash" | "Check" | "CreditCard";
  credit?: boolean; // Credit Card Credit
  idColumn?: string;
}

export function makePurchaseBuilder(opts: PurchaseOpts) {
  return async function build(doc: GroupedDoc, refs: RefResolver): Promise<BuildResult> {
    const h = doc.rows[0];
    const bankName = str(first(doc, "Account") ?? first(doc, "Bank Account") ?? first(doc, "Bank Account "));
    const bank = bankName ? await refs.resolve("Account", bankName) : null;
    if (!bank) throw new Error("A bank/credit-card account is required");

    const Line = await buildExpenseLines(doc, refs);
    if (Line.length === 0) throw new Error("At least one expense or item line is required");

    const payload: any = {
      AccountRef: { value: bank.value },
      PaymentType: opts.paymentType,
      Line,
      TxnDate: dateStr(first(doc, "Payment Date")),
      PrivateNote: str(first(doc, "Memo")),
      DocNumber: str(first(doc, "Ref No") ?? first(doc, "Check no")),
    };
    if (opts.credit) payload.Credit = true;

    const payeeName = str(first(doc, "Payee"));
    if (payeeName) {
      const payee = (await refs.tryResolve("Vendor", payeeName)) || (await refs.tryResolve("Customer", payeeName));
      if (payee) payload.EntityRef = { value: payee.value };
    }
    if (str(first(doc, "Currency Code"))) payload.CurrencyRef = { value: str(first(doc, "Currency Code")) };

    const qboId = opts.idColumn ? str(h[opts.idColumn]) : undefined;
    return { payload: qboId ? { ...payload, Id: qboId } : payload, qboId };
  };
}

// ── Bill Payment ─────────────────────────────────────────────────────────────

export async function buildBillPayment(doc: GroupedDoc, refs: RefResolver): Promise<BuildResult> {
  const vendor = await refs.resolve("Vendor", first(doc, "Vendor"));
  if (!vendor) throw new Error("Vendor is required");
  const bank = await refs.resolve("Account", first(doc, "Bank or CC Account"));
  if (!bank) throw new Error("Bank or CC Account is required");

  // A bill payment can settle MANY bills — each row (grouped by Ref No) that
  // names a "Bill No" becomes an application line linked to that bill.
  const Line: any[] = [];
  for (const row of doc.rows) {
    const billNo = str(row["Bill No"]);
    if (!billNo) continue;
    const amt = num(row["Amount"] ?? row[" Amount"]);
    if (amt == null) throw new Error(`Amount is required for the payment applied to bill ${billNo}`);
    const billId = await refs.resolveBillId(billNo, vendor.value);
    if (!billId) throw new Error(`Bill "${billNo}" not found for vendor ${vendor.name}`);
    Line.push({ Amount: amt, LinkedTxn: [{ TxnId: billId, TxnType: "Bill" }] });
  }
  if (Line.length === 0) throw new Error("A bill payment must be applied to at least one bill (set Bill No)");

  const total = Math.round(Line.reduce((s, l) => s + Number(l.Amount || 0), 0) * 100) / 100;
  const payload: any = {
    VendorRef: { value: vendor.value, name: vendor.name },
    TotalAmt: total,
    TxnDate: dateStr(first(doc, "Payment Date")),
    PayType: "Check",
    CheckPayment: { BankAccountRef: { value: bank.value } },
    Line,
    PrivateNote: str(first(doc, "Memo")),
  };
  if (str(first(doc, "Currency Code"))) payload.CurrencyRef = { value: str(first(doc, "Currency Code")) };
  return { payload };
}

// ── Journal Entry ────────────────────────────────────────────────────────────

export async function buildJournalEntry(doc: GroupedDoc, refs: RefResolver): Promise<BuildResult> {
  const Line: any[] = [];
  for (const row of doc.rows) {
    const acctName = str(row["Account"] ?? row[" Account "]);
    const amount = num(row["Amount"] ?? row[" Amount"]);
    if (!acctName || amount == null) continue;
    const acct = await refs.resolve("Account", acctName);
    const cls = await refs.tryResolve("Class", row["Class"] ?? row["Class "]);
    const dept = await refs.tryResolve("Department", row["Location"]);
    Line.push({
      DetailType: "JournalEntryLineDetail",
      Amount: Math.abs(amount),
      Description: str(row["Description"] ?? row[" Description"]),
      JournalEntryLineDetail: {
        PostingType: amount >= 0 ? "Debit" : "Credit",
        AccountRef: { value: acct!.value },
        ClassRef: cls ? { value: cls.value } : undefined,
        DepartmentRef: dept ? { value: dept.value } : undefined,
      },
    });
  }
  if (Line.length < 2) throw new Error("A journal entry needs at least two lines (a debit and a credit)");
  const payload: any = {
    Line,
    TxnDate: dateStr(first(doc, "Journal Date")),
    DocNumber: str(first(doc, "Journal No")),
    PrivateNote: str(first(doc, "Memo")),
    Adjustment: bool(first(doc, "Is Adjustment")),
  };
  if (str(first(doc, "Currency Code"))) payload.CurrencyRef = { value: str(first(doc, "Currency Code")) };
  return { payload };
}

// ── Deposit ──────────────────────────────────────────────────────────────────

/**
 * Bank Deposit.
 *
 * Accepts every column the deposit template declares. It previously read only
 * five of them, so a user who filled in "Received From" (or a ref no, cash
 * back, or location) had that work silently discarded on import — the row
 * succeeded, the data just never arrived.
 */
export async function buildDeposit(doc: GroupedDoc, refs: RefResolver): Promise<BuildResult> {
  const depositTo = await refs.resolve("Account", first(doc, "Deposit To Account"));
  if (!depositTo) throw new Error("Deposit To Account is required");

  const Line: any[] = [];
  for (const row of doc.rows) {
    const lineAcctName = str(row["Line Account"]);
    const amount = num(row["Line Amount"]);
    if (!lineAcctName || amount == null) continue;
    const acct = await refs.resolve("Account", lineAcctName);
    const cls = await refs.tryResolve("Class", row["Line Class"]);
    const pm = await refs.tryResolve("PaymentMethod", row["Line Payment Method"]);

    // "Received From" is a QuickBooks Entity ref: customer, vendor or employee.
    // Try each in turn rather than assuming customer — a vendor refund banked
    // as a deposit is a normal thing and must not fail the row.
    const payerName = str(row["Received From"]);
    let Entity: any;
    if (payerName) {
      const cust = await refs.tryResolve("Customer", payerName);
      const vend = cust ? null : await refs.tryResolve("Vendor", payerName);
      const emp = cust || vend ? null : await refs.tryResolve("Employee", payerName);
      const hit = cust ?? vend ?? emp;
      if (!hit) {
        throw new Error(`Received From "${payerName}" was not found as a customer, vendor or employee`);
      }
      Entity = { value: hit.value, type: cust ? "Customer" : vend ? "Vendor" : "Employee" };
    }

    const detail: any = {
      AccountRef: { value: acct!.value },
      ClassRef: cls ? { value: cls.value } : undefined,
      PaymentMethodRef: pm ? { value: pm.value } : undefined,
      CheckNum: str(row["Line Ref No"]),
      Entity,
    };

    const lineId = str(row["Line Id"]);
    Line.push({
      // Carry the existing line's id on an Update so QuickBooks reconciles by
      // line (keeps the ids you send, deletes the rest) instead of appending.
      ...(lineId ? { Id: lineId } : {}),
      DetailType: "DepositLineDetail",
      Amount: amount,
      Description: str(row["Line Description"]),
      DepositLineDetail: detail,
    });
  }
  if (Line.length === 0) throw new Error("At least one deposit line is required");

  const payload: any = {
    DepositToAccountRef: { value: depositTo.value },
    Line,
    TxnDate: dateStr(first(doc, "Date")),
    PrivateNote: str(first(doc, "Memo")),
    // Every other doc-numbered entity sets this from its number column
    // (Invoice No, Bill No, Journal No, …) — Deposit was the one missing it.
    // On create it's optional (QBO auto-assigns if omitted); on update it's
    // required — commitOneDoc now does a FULL (non-sparse) update whenever a
    // Line array is present, and a full update with no DocNumber would blank
    // the deposit's number in QuickBooks.
    DocNumber: str(first(doc, "Deposit No")),
  };

  const currency = str(first(doc, "Currency Code"));
  if (currency) payload.CurrencyRef = { value: currency };
  const rate = num(first(doc, "Exchange Rate"));
  if (rate != null) payload.ExchangeRate = rate;

  const location = await refs.tryResolve("Department", first(doc, "Location"));
  if (location) payload.DepartmentRef = { value: location.value };

  // Cash back is only valid as a complete set — an account plus an amount.
  const cashBackAcctName = first(doc, "Cash back goes to");
  const cashBackAmount = num(first(doc, "Cash back amount"));
  if (cashBackAcctName && cashBackAmount != null) {
    const cbAcct = await refs.resolve("Account", cashBackAcctName);
    if (!cbAcct) throw new Error(`Cash back account "${cashBackAcctName}" was not found`);
    payload.CashBack = {
      AccountRef: { value: cbAcct.value },
      Amount: cashBackAmount,
      Memo: str(first(doc, "Cash back memo")),
    };
  }

  return { payload };
}

// ── Transfer ─────────────────────────────────────────────────────────────────

export async function buildTransfer(doc: GroupedDoc, refs: RefResolver): Promise<BuildResult> {
  const from = await refs.resolve("Account", first(doc, "Transfer Funds From"));
  const to = await refs.resolve("Account", first(doc, "Transfer Funds To"));
  if (!from || !to) throw new Error("Both from and to accounts are required");
  const payload: any = {
    FromAccountRef: { value: from.value },
    ToAccountRef: { value: to.value },
    Amount: num(first(doc, "Transfer Amount")),
    TxnDate: dateStr(first(doc, "Date")),
    PrivateNote: str(first(doc, "Memo")),
  };
  if (str(first(doc, "Currency Code"))) payload.CurrencyRef = { value: str(first(doc, "Currency Code")) };
  return { payload };
}

// ── Time Activity ────────────────────────────────────────────────────────────

export async function buildTimeActivity(doc: GroupedDoc, refs: RefResolver): Promise<BuildResult> {
  const name = first(doc, "Name");
  const emp = await refs.tryResolve("Employee", name);
  const vendor = emp ? null : await refs.tryResolve("Vendor", name);
  if (!emp && !vendor) throw new Error(`Name "${name}" not found as an employee or vendor`);
  const customer = await refs.tryResolve("Customer", first(doc, "Customer"));
  const item = await refs.tryResolve("Item", first(doc, "Service"));
  const cls = await refs.tryResolve("Class", first(doc, "Class"));
  const payload: any = {
    NameOf: emp ? "Employee" : "Vendor",
    TxnDate: dateStr(first(doc, "Date")),
    Hours: num(first(doc, "Hours")),
    Minutes: num(first(doc, "Minutes")),
    Description: str(first(doc, "Description")),
    BillableStatus: str(first(doc, "Billable Status")),
    HourlyRate: num(first(doc, "Bill at $ per hour")),
  };
  if (emp) payload.EmployeeRef = { value: emp.value };
  else if (vendor) payload.VendorRef = { value: vendor.value };
  if (customer) payload.CustomerRef = { value: customer.value };
  if (item) payload.ItemRef = { value: item.value };
  if (cls) payload.ClassRef = { value: cls.value };
  return { payload };
}

// ── Master list entities ─────────────────────────────────────────────────────

export async function buildCustomer(doc: GroupedDoc): Promise<BuildResult> {
  const h = doc.rows[0];
  const payload: any = {
    DisplayName: str(h["Display Name As"]) || str(h["Company"]) || [str(h["First Name"]), str(h["Last Name"])].filter(Boolean).join(" "),
    Title: str(h["Title"]),
    GivenName: str(h["First Name"]),
    MiddleName: str(h["Middle Name"]),
    FamilyName: str(h["Last Name"]),
    Suffix: str(h["Suffix"]),
    CompanyName: str(h["Company"]),
    PrimaryEmailAddr: str(h["Email"]) ? { Address: str(h["Email"]) } : undefined,
    PrimaryPhone: str(h["Phone"]) ? { FreeFormNumber: str(h["Phone"]) } : undefined,
    Mobile: str(h["Mobile"]) ? { FreeFormNumber: str(h["Mobile"]) } : undefined,
    Fax: str(h["Fax"]) ? { FreeFormNumber: str(h["Fax"]) } : undefined,
    WebAddr: str(h["Website"]) ? { URI: str(h["Website"]) } : undefined,
    BillAddr: address(h, "Billing Address"),
    ShipAddr: address(h, "Shipping Address"),
    Notes: str(h["Notes"]),
  };
  if (!payload.DisplayName) throw new Error("A display name (or company/first/last name) is required");
  return { payload };
}

export async function buildVendor(doc: GroupedDoc): Promise<BuildResult> {
  const h = doc.rows[0];
  const payload: any = {
    DisplayName: str(h["Display Name As"]) || str(h["Company"]) || [str(h["First Name"]), str(h["Last Name"])].filter(Boolean).join(" "),
    Title: str(h["Title"]),
    GivenName: str(h["First Name"]),
    MiddleName: str(h["Middle Name"]),
    FamilyName: str(h["Last Name"]),
    Suffix: str(h["Suffix"]),
    CompanyName: str(h["Company"]),
    PrimaryEmailAddr: str(h["Email"]) ? { Address: str(h["Email"]) } : undefined,
    PrimaryPhone: str(h["Phone"]) ? { FreeFormNumber: str(h["Phone"]) } : undefined,
    Mobile: str(h["Mobile"]) ? { FreeFormNumber: str(h["Mobile"]) } : undefined,
    WebAddr: str(h["Website"]) ? { URI: str(h["Website"]) } : undefined,
    BillAddr: address(h, "Billing Address"),
    AcctNum: str(h["Account no"]),
    TaxIdentifier: str(h["Tax ID"]),
    Vendor1099: bool(h["Track payments for 1099"]),
  };
  if (!payload.DisplayName) throw new Error("A display name (or company/first/last name) is required");
  return { payload };
}

export async function buildItem(doc: GroupedDoc, refs: RefResolver): Promise<BuildResult> {
  const h = doc.rows[0];
  const name = str(h["Name"]);
  if (!name) throw new Error("Item name is required");
  const rawType = (str(h["Type"]) || "Service").replace(/\s+/g, "");
  const type = /inventory/i.test(rawType) && !/non/i.test(rawType) ? "Inventory" : /noninventory/i.test(rawType) ? "NonInventory" : "Service";
  const income = await refs.tryResolve("Account", h["Income Account"] ?? h["Income Account "]);
  const expense = await refs.tryResolve("Account", h["Expense Account"] ?? h["Expense Account "]);
  const payload: any = {
    Name: name,
    Type: type,
    Sku: str(h["SKU"]),
    UnitPrice: num(h["Price/Rate"]),
    PurchaseCost: num(h["Cost"]),
    Description: str(h["Sales Description"]),
    PurchaseDesc: str(h["Purchase Description"]),
    Taxable: bool(h["Taxable"]),
    IncomeAccountRef: income ? { value: income.value } : undefined,
    ExpenseAccountRef: expense ? { value: expense.value } : undefined,
  };
  if (type === "Inventory") {
    const asset = await refs.tryResolve("Account", h["Inventory Asset Account"]);
    payload.TrackQtyOnHand = true;
    payload.QtyOnHand = num(h["Initial Quantity On Hand"]) ?? 0;
    payload.InvStartDate = dateStr(h["As Of Date"]) ?? new Date().toISOString().slice(0, 10);
    if (asset) payload.AssetAccountRef = { value: asset.value };
  }
  return { payload };
}

export async function buildAccount(doc: GroupedDoc): Promise<BuildResult> {
  const h = doc.rows[0];
  const name = str(h["Name"]);
  if (!name) throw new Error("Account name is required");
  const payload: any = {
    Name: name,
    AccountType: str(h["Account Type"]),
    AccountSubType: str(h["Account Subtype"]),
    AcctNum: str(h["Account Number"]),
    Description: str(h["Description"]),
  };
  return { payload };
}

export function makeSimpleListBuilder(nameCol: string) {
  return async function build(doc: GroupedDoc): Promise<BuildResult> {
    const name = str(doc.rows[0][nameCol]);
    if (!name) throw new Error(`${nameCol} is required`);
    return { payload: { Name: name } };
  };
}

export async function buildEmployee(doc: GroupedDoc): Promise<BuildResult> {
  const h = doc.rows[0];
  const payload: any = {
    GivenName: str(h["First Name"]),
    MiddleName: str(h["Middle Name"]),
    FamilyName: str(h["Last Name"]),
    DisplayName: str(h["Display Name As"]) || [str(h["First Name"]), str(h["Last Name"])].filter(Boolean).join(" "),
    PrimaryEmailAddr: str(h["Email"]) ? { Address: str(h["Email"]) } : undefined,
    PrimaryPhone: str(h["Phone"]) ? { FreeFormNumber: str(h["Phone"]) } : undefined,
    Mobile: str(h["Mobile"]) ? { FreeFormNumber: str(h["Mobile"]) } : undefined,
    EmployeeNumber: str(h["Employee No"]),
    SSN: str(h["SSN"]),
  };
  if (!payload.DisplayName && !payload.GivenName) throw new Error("An employee name is required");
  return { payload };
}
