/**
 * Estimate → Invoice conversion.
 *
 * QuickBooks links an invoice to an estimate through a LinkedTxn of type
 * "Estimate". We copy the estimate's sales lines and header context into a new
 * invoice and add that link, so QBO records the invoice against the estimate and
 * updates the estimate's invoiced status. Tax codes, class, location and the
 * tax mode carry over from the source line data untouched — so this is
 * region-safe (US automated tax and non-US VAT both just copy through).
 */

import type { RefResolver } from "./ref-resolver";
import { str, num, dateStr } from "./builders";

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Column layout for the progress-invoicing export / import. */
export const PROGRESS_COLUMNS = [
  "Estimate Id", "Estimate No", "Customer", "Invoice Date",
  "Class", "Location", "Currency",
  "Product/Service", "Description",
  "Estimated Qty", "Estimated Rate", "Estimated Amount", "Sales Tax Code",
  "Qty to Invoice", "Amount to Invoice",
];
/** The two columns the user fills in. */
export const PROGRESS_FILL_COLUMNS = ["Qty to Invoice", "Amount to Invoice"];

/**
 * Build an Invoice from progress-billing rows (all rows share one Estimate Id).
 * Only lines with a Qty/Amount to Invoice are billed; the invoice is linked to
 * the estimate. Returns null if nothing on the estimate was marked to invoice.
 */
export async function buildProgressInvoice(
  estimateId: string,
  rows: Record<string, any>[],
  refs: RefResolver
): Promise<any | null> {
  const company = await refs.company();
  const h = rows[0];
  const customer = await refs.resolve("Customer", h["Customer"]);
  if (!customer) throw new Error("Customer is required");

  const headerClass = await refs.tryResolve("Class", h["Class"]);
  const headerDept = await refs.tryResolve("Department", h["Location"]);
  const headerTaxCode = await refs.tryResolve("TaxCode", h["Sales Tax Code"]);
  let usedRealTax = false;

  const Line: any[] = [];
  for (const row of rows) {
    const qtyInv = num(row["Qty to Invoice"]);
    const amtInv = num(row["Amount to Invoice"]);
    if ((qtyInv == null || qtyInv === 0) && (amtInv == null || amtInv === 0)) continue;

    const item = await refs.tryResolve("Item", row["Product/Service"]);
    const rate = num(row["Estimated Rate"]);
    const amount = amtInv ?? (qtyInv != null && rate != null ? qtyInv * rate : 0);
    const cls = await refs.tryResolve("Class", row["Class"]);

    let taxRef: any;
    if (company.isUS) {
      taxRef = { value: "TAX" };
    } else {
      const tc = headerTaxCode ?? await refs.tryResolve("TaxCode", row["Sales Tax Code"]);
      if (tc) { taxRef = { value: tc.value }; usedRealTax = true; }
    }

    Line.push({
      DetailType: "SalesItemLineDetail",
      Amount: amount,
      Description: str(row["Description"]),
      SalesItemLineDetail: {
        ItemRef: item ? { value: item.value } : undefined,
        Qty: qtyInv,
        UnitPrice: rate,
        ClassRef: cls ? { value: cls.value } : undefined,
        TaxCodeRef: taxRef,
      },
    });
  }
  if (Line.length === 0) return null;

  const payload: any = {
    CustomerRef: { value: customer.value, name: customer.name },
    Line,
    LinkedTxn: [{ TxnId: estimateId, TxnType: "Estimate" }],
    TxnDate: dateStr(h["Invoice Date"]) || todayIso(),
  };
  if (headerClass) payload.ClassRef = { value: headerClass.value };
  if (headerDept) payload.DepartmentRef = { value: headerDept.value };
  if (str(h["Currency"])) payload.CurrencyRef = { value: str(h["Currency"]) };
  if (!company.isUS && usedRealTax) payload.GlobalTaxCalculation = "TaxExcluded";
  return payload;
}

export interface ConvertOpts {
  /** Invoice date; defaults to today. */
  invoiceDate?: string;
  /** Optional due date. */
  dueDate?: string;
}

/** Build an Invoice payload from a full QBO Estimate record. */
export function invoiceFromEstimate(est: any, opts: ConvertOpts = {}): any {
  const lines = (est.Line || [])
    .filter((l: any) => l.DetailType === "SalesItemLineDetail")
    .map((l: any) => ({
      DetailType: "SalesItemLineDetail",
      Amount: l.Amount,
      Description: l.Description,
      // Copy the detail wholesale (ItemRef, Qty, UnitPrice, TaxCodeRef, ClassRef,
      // ServiceDate) — but drop any line Id so QBO assigns fresh ones.
      SalesItemLineDetail: { ...l.SalesItemLineDetail },
    }));

  const payload: any = {
    CustomerRef: est.CustomerRef,
    Line: lines,
    LinkedTxn: [{ TxnId: est.Id, TxnType: "Estimate" }],
    TxnDate: opts.invoiceDate || todayIso(),
  };

  // Carry over header context when present.
  if (opts.dueDate) payload.DueDate = opts.dueDate;
  if (est.CurrencyRef) payload.CurrencyRef = est.CurrencyRef;
  if (est.ExchangeRate != null) payload.ExchangeRate = est.ExchangeRate;
  if (est.DepartmentRef) payload.DepartmentRef = est.DepartmentRef;
  if (est.ClassRef) payload.ClassRef = est.ClassRef;
  if (est.BillEmail) payload.BillEmail = est.BillEmail;
  if (est.CustomerMemo) payload.CustomerMemo = est.CustomerMemo;
  if (est.GlobalTaxCalculation) payload.GlobalTaxCalculation = est.GlobalTaxCalculation;
  if (est.BillAddr) payload.BillAddr = est.BillAddr;
  if (est.ShipAddr) payload.ShipAddr = est.ShipAddr;
  if (est.SalesTermRef) payload.SalesTermRef = est.SalesTermRef;

  return payload;
}
