/**
 * QBO → SourceLine extraction for the reporting engine.
 *
 * Pulls a period's P&L-relevant transactions and flattens every line into a
 * SourceLine (the source-attribute surface the rule engine reads), resolving
 * account / class / location / customer(+parent) / item / vendor names.
 *
 * MVP scope + sign convention (documented, because it's accounting-sensitive):
 *   - Income lines (Invoice, SalesReceipt) → +amount; CreditMemo → −amount.
 *   - Expense lines (Bill, Purchase, VendorCredit→−) → +amount.
 *   - JournalEntry lines → signed by posting type relative to the account's
 *     P&L section (income: Credit +, Debit −; expense: Debit +, Credit −).
 * Amounts are the ex-tax line amounts QBO stores. This gives a management P&L
 * that reconciles to the SUM OF EXTRACTED LINES (nothing is dropped). Matching
 * QBO's *official* P&L exactly (cash basis, COGS/inventory, tax, retained
 * earnings) is the Reports-API reconciliation refinement — see report route.
 */

import type { OrgQboToken } from "@/lib/qbo-token";
import { qboQueryAll } from "@/lib/batch/qbo-client";
import type { SourceLine } from "./types";

export interface AccountMeta { id: string; name?: string; number?: string; type?: string; subType?: string; parentId?: string; }

export interface ExtractResult {
  lines: SourceLine[];
  accountsById: Record<string, AccountMeta>;
  counts: Record<string, number>;   // entity → row count pulled (diagnostics)
}

const isIncomeType = (t?: string) => /income|revenue/i.test(t || "");

export async function extractSourceLines(token: OrgQboToken, from: string, to: string): Promise<ExtractResult> {
  const where = `TxnDate >= '${from}' AND TxnDate <= '${to}'`;

  // ── reference maps (one query each) ──
  const [accounts, items, customers, classes, depts, vendors] = await Promise.all([
    qboQueryAll(token, "Account").catch(() => []),
    qboQueryAll(token, "Item").catch(() => []),
    qboQueryAll(token, "Customer").catch(() => []),
    qboQueryAll(token, "Class").catch(() => []),
    qboQueryAll(token, "Department").catch(() => []),
    qboQueryAll(token, "Vendor").catch(() => []),
  ]);
  const acctById = new Map<string, AccountMeta>();
  for (const a of accounts) acctById.set(String(a.Id), { id: String(a.Id), name: a.Name, number: a.AcctNum, type: a.AccountType, subType: a.AccountSubType, parentId: a.ParentRef?.value });
  const itemById = new Map<string, any>(); for (const it of items) itemById.set(String(it.Id), it);
  const custById = new Map<string, any>(); for (const c of customers) custById.set(String(c.Id), c);
  const classById = new Map<string, string>(); for (const c of classes) classById.set(String(c.Id), c.FullyQualifiedName || c.Name);
  const deptById = new Map<string, string>(); for (const d of depts) deptById.set(String(d.Id), d.FullyQualifiedName || d.Name);
  const vendById = new Map<string, any>(); for (const v of vendors) vendById.set(String(v.Id), v);

  const acct = (id?: string): AccountMeta | undefined => (id ? acctById.get(String(id)) : undefined);
  const custFields = (ref: any): Partial<SourceLine> => {
    if (!ref?.value) return {};
    const c = custById.get(String(ref.value));
    const parentId = c?.ParentRef?.value;
    const parent = parentId ? custById.get(String(parentId)) : undefined;
    return { customerId: String(ref.value), customerName: ref.name || c?.DisplayName, customerParentId: parentId ? String(parentId) : undefined, customerParentName: parent?.DisplayName || parent?.FullyQualifiedName };
  };
  const acctFields = (id?: string): Partial<SourceLine> => {
    const a = acct(id);
    return a ? { accountId: a.id, accountName: a.name, accountNumber: a.number, accountType: a.type, accountSubType: a.subType, parentAccountId: a.parentId } : {};
  };

  const lines: SourceLine[] = [];
  const counts: Record<string, number> = {};

  // ── sales (income) ──
  const salesEntities: { name: string; readName: string; sign: number }[] = [
    { name: "Invoice", readName: "Invoice", sign: 1 },
    { name: "SalesReceipt", readName: "SalesReceipt", sign: 1 },
    { name: "CreditMemo", readName: "CreditMemo", sign: -1 },
  ];
  for (const e of salesEntities) {
    const recs = await qboQueryAll(token, e.readName, where).catch(() => []);
    counts[e.readName] = recs.length;
    for (const r of recs) {
      const cust = custFields(r.CustomerRef);
      for (const l of (r.Line || [])) {
        if (l.DetailType !== "SalesItemLineDetail") continue;
        const d = l.SalesItemLineDetail || {};
        const item = d.ItemRef?.value ? itemById.get(String(d.ItemRef.value)) : undefined;
        const incomeAcctId = item?.IncomeAccountRef?.value;
        lines.push({
          txnType: e.name, txnId: String(r.Id), lineId: String(l.Id ?? lines.length), docNumber: r.DocNumber, txnDate: r.TxnDate,
          amount: (Number(l.Amount) || 0) * e.sign, currency: r.CurrencyRef?.value,
          ...acctFields(incomeAcctId),
          classId: d.ClassRef?.value, className: d.ClassRef?.value ? classById.get(String(d.ClassRef.value)) : undefined,
          locationId: r.DepartmentRef?.value, locationName: r.DepartmentRef?.value ? deptById.get(String(r.DepartmentRef.value)) : undefined,
          ...cust,
          itemId: d.ItemRef?.value, itemName: d.ItemRef?.name || item?.Name,
          memo: l.Description, taxCodeId: d.TaxCodeRef?.value, raw: l,
        });
      }
    }
  }

  // ── purchases (expense) ──
  const purchaseEntities: { name: string; readName: string; sign: number }[] = [
    { name: "Bill", readName: "Bill", sign: 1 },
    { name: "Purchase", readName: "Purchase", sign: 1 },
    { name: "VendorCredit", readName: "VendorCredit", sign: -1 },
  ];
  for (const e of purchaseEntities) {
    const recs = await qboQueryAll(token, e.readName, where).catch(() => []);
    counts[e.readName] = recs.length;
    for (const r of recs) {
      const vendorId = r.VendorRef?.value ? String(r.VendorRef.value) : undefined;
      const vendorName = r.VendorRef?.name || (vendorId ? vendById.get(vendorId)?.DisplayName : undefined);
      for (const l of (r.Line || [])) {
        let accountId: string | undefined;
        let classRef: any, custRef: any, deptFromLine: any;
        if (l.DetailType === "AccountBasedExpenseLineDetail") {
          const d = l.AccountBasedExpenseLineDetail || {};
          accountId = d.AccountRef?.value; classRef = d.ClassRef; custRef = d.CustomerRef;
        } else if (l.DetailType === "ItemBasedExpenseLineDetail") {
          const d = l.ItemBasedExpenseLineDetail || {};
          const item = d.ItemRef?.value ? itemById.get(String(d.ItemRef.value)) : undefined;
          accountId = item?.ExpenseAccountRef?.value; classRef = d.ClassRef; custRef = d.CustomerRef;
        } else continue;
        lines.push({
          txnType: e.name, txnId: String(r.Id), lineId: String(l.Id ?? lines.length), docNumber: r.DocNumber, txnDate: r.TxnDate,
          amount: (Number(l.Amount) || 0) * e.sign, currency: r.CurrencyRef?.value,
          ...acctFields(accountId),
          classId: classRef?.value, className: classRef?.value ? classById.get(String(classRef.value)) : undefined,
          locationId: r.DepartmentRef?.value, locationName: r.DepartmentRef?.value ? deptById.get(String(r.DepartmentRef.value)) : undefined,
          ...custFields(custRef),
          vendorId, vendorName,
          memo: l.Description, raw: l,
        });
      }
    }
  }

  // ── journal entries ──
  const jes = await qboQueryAll(token, "JournalEntry", where).catch(() => []);
  counts["JournalEntry"] = jes.length;
  for (const r of jes) {
    for (const l of (r.Line || [])) {
      if (l.DetailType !== "JournalEntryLineDetail") continue;
      const d = l.JournalEntryLineDetail || {};
      const a = acct(d.AccountRef?.value);
      // Only P&L accounts matter for a P&L; skip balance-sheet lines.
      if (a && !/income|revenue|expense|cost of goods sold|other income|other expense/i.test(a.type || "")) continue;
      const amt = Number(l.Amount) || 0;
      const debit = d.PostingType === "Debit";
      const signed = isIncomeType(a?.type) ? (debit ? -amt : amt) : (debit ? amt : -amt);
      const cust = custFields(d.Entity?.Type === "Customer" ? d.Entity?.EntityRef : undefined);
      lines.push({
        txnType: "JournalEntry", txnId: String(r.Id), lineId: String(l.Id ?? lines.length), docNumber: r.DocNumber, txnDate: r.TxnDate,
        amount: signed, postingType: d.PostingType, currency: r.CurrencyRef?.value,
        ...acctFields(d.AccountRef?.value),
        classId: d.ClassRef?.value, className: d.ClassRef?.value ? classById.get(String(d.ClassRef.value)) : undefined,
        locationId: d.DepartmentRef?.value, locationName: d.DepartmentRef?.value ? deptById.get(String(d.DepartmentRef.value)) : undefined,
        ...cust,
        memo: l.Description, raw: l,
      });
    }
  }

  const accountsById: Record<string, AccountMeta> = {};
  for (const [id, m] of acctById) accountsById[id] = m;
  return { lines, accountsById, counts };
}
