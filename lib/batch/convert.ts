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

const todayIso = () => new Date().toISOString().slice(0, 10);

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
