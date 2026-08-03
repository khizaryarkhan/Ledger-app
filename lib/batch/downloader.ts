/**
 * Maps QBO records back into flat template rows for Download / Modify.
 *
 * Every row is prefixed with Id + SyncToken so a downloaded file can be edited
 * and re-imported through Modify. Header-level fields are mapped generically;
 * the first line item's key fields are surfaced where the template expects them.
 */

import type { BatchEntity, SheetRow } from "./types";

export const MODIFY_KEY_COLS = ["Id", "SyncToken"];

function refName(ref: any): string | undefined {
  return ref?.name ?? undefined;
}

function firstLine(record: any): any {
  const lines = Array.isArray(record?.Line) ? record.Line : [];
  return lines.find((l: any) => l.DetailType && l.DetailType !== "SubTotalLineDetail") ?? lines[0];
}

/** Produce the full ordered column list for a download (Id/SyncToken first). */
export function downloadColumns(entity: BatchEntity): string[] {
  return [...MODIFY_KEY_COLS, ...entity.columns.map((c) => c.trim())];
}

/** Map one QBO record to a flat row keyed by the download columns. */
export function recordToRow(entity: BatchEntity, r: any): SheetRow {
  const row: SheetRow = {};
  const set = (col: string, val: any) => { if (val != null && val !== "") row[col.trim()] = val; };

  set("Id", r.Id);
  set("SyncToken", r.SyncToken);

  // Reference number → e.g. "Invoice No", "Bill No", "Name", "Display Name As"
  if (entity.refNumberColumn) {
    if (entity.group === "list") {
      set(entity.refNumberColumn, r.DisplayName ?? r.Name);
    } else {
      set(entity.refNumberColumn, r.DocNumber ?? r.PaymentRefNum);
    }
  }
  // Date
  if (entity.dateColumn) set(entity.dateColumn, r.TxnDate);

  // Party name
  const party = refName(r.CustomerRef) ?? refName(r.VendorRef) ?? refName(r.EntityRef);
  for (const col of entity.columns) {
    const c = col.trim();
    if (/^Customer/.test(c) && r.CustomerRef) { set(c, refName(r.CustomerRef)); break; }
    if (/^Vendor/.test(c) && r.VendorRef) { set(c, refName(r.VendorRef)); break; }
    if (/^Payee/.test(c) && party) { set(c, party); break; }
  }

  // Memo / notes
  for (const col of entity.columns) {
    if (/^Memo$/i.test(col.trim())) { set(col, r.PrivateNote); break; }
  }

  // Amounts + first line
  const ln = firstLine(r);
  if (ln) {
    const d = ln.SalesItemLineDetail || ln.ItemBasedExpenseLineDetail || ln.AccountBasedExpenseLineDetail || {};
    set("Product/Service", refName(d.ItemRef));
    set("Product/Service Description", ln.Description);
    set("Product/Service Quantity", d.Qty);
    set("Product/Service Rate", d.UnitPrice);
    set("Product/Service Amount", ln.Amount);
    set("Expense Account", refName(d.AccountRef));
    set("Expense Line Amount", d.AccountRef ? ln.Amount : undefined);
  }

  // Total-ish fields for payments
  if (r.TotalAmt != null) {
    for (const col of entity.columns) {
      if (/^Amount$/i.test(col.trim())) { set(col, r.TotalAmt); break; }
    }
  }

  // Currency
  if (r.CurrencyRef?.value) set("Currency Code", r.CurrencyRef.value);

  // List-entity extras
  if (entity.group === "list") {
    set("Email", r.PrimaryEmailAddr?.Address);
    set("Phone", r.PrimaryPhone?.FreeFormNumber);
    set("Company", r.CompanyName);
    set("First Name", r.GivenName);
    set("Last Name", r.FamilyName);
    set("Account Type", r.AccountType);
    set("Account Subtype", r.AccountSubType);
    set("Price/Rate", r.UnitPrice);
    set("Cost", r.PurchaseCost);
    set("Type", r.Type);
  }

  return row;
}
