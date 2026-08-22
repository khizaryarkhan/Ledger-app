/**
 * Global search — one query across every org entity, powering the ⌘K palette.
 *
 * Matches names, emails, codes, tax numbers, document numbers, references,
 * memos, and the backend Transaction ID (TXN-000123 / bare number). Each hit is
 * normalised to { type, id, title, subtitle, href, group } so the palette can
 * render grouped, deep-linkable results. All queries are org-scoped and run in
 * parallel, each capped, so it stays fast.
 */

import { db } from "@/db";
import {
  customers, apSuppliers, employees, accounts, apItems, journalEntries, tradeDocuments, invoices,
} from "@/db/schema";
import { and, or, eq, ilike, inArray, sql } from "drizzle-orm";

export type SearchHit = {
  group: string;      // "Customers", "Transactions", …
  type: string;       // machine type
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
};

const PER = 6;

export async function globalSearch(orgIds: string[], qRaw: string): Promise<{ groups: { group: string; hits: SearchHit[] }[]; total: number }> {
  const q = qRaw.trim();
  if (orgIds.length === 0 || q.length < 2) return { groups: [], total: 0 };
  const like = `%${q}%`;
  const inOrg = (col: any) => inArray(col, orgIds);
  // Backend Transaction ID: "TXN-000123", "TXN 123", or a bare number.
  const txnNo = (() => { const m = q.match(/(\d{1,9})/); return m ? Number(m[1]) : null; })();

  const runs = await Promise.allSettled([
    // Customers
    db.select({ id: customers.id, name: customers.name, email: customers.email, code: customers.code, company: customers.companyName })
      .from(customers)
      .where(and(inOrg(customers.orgId), or(ilike(customers.name, like), ilike(customers.email, like), ilike(customers.code, like), ilike(customers.companyName, like), ilike(customers.taxNumber, like), ilike(customers.phone, like))))
      .limit(PER),
    // Suppliers
    db.select({ id: apSuppliers.id, name: apSuppliers.name, display: apSuppliers.displayName, email: apSuppliers.email })
      .from(apSuppliers)
      .where(and(inOrg(apSuppliers.orgId), or(ilike(apSuppliers.name, like), ilike(apSuppliers.displayName, like), ilike(apSuppliers.email, like), ilike(apSuppliers.taxNumber, like), ilike(apSuppliers.code, like))))
      .limit(PER),
    // Employees
    db.select({ id: employees.id, name: employees.name, email: employees.email })
      .from(employees)
      .where(and(inOrg(employees.orgId), or(ilike(employees.name, like), ilike(employees.email, like))))
      .limit(PER),
    // Chart of accounts
    db.select({ id: accounts.id, name: accounts.name, code: accounts.code, type: accounts.type })
      .from(accounts)
      .where(and(inOrg(accounts.orgId), or(ilike(accounts.name, like), ilike(accounts.code, like))))
      .limit(PER),
    // Products & services
    db.select({ id: apItems.id, name: apItems.name, code: apItems.code })
      .from(apItems)
      .where(and(inOrg(apItems.orgId), or(ilike(apItems.name, like), ilike(apItems.code, like))))
      .limit(PER),
    // Transactions (GL) — doc number, reference, memo, TXN id
    db.select({ id: journalEntries.id, docNumber: journalEntries.docNumber, entryNumber: journalEntries.entryNumber, txnNo: journalEntries.txnNo, sourceType: journalEntries.sourceType, date: journalEntries.entryDate, ref: journalEntries.reference })
      .from(journalEntries)
      .where(and(inOrg(journalEntries.orgId), or(
        ilike(journalEntries.docNumber, like), ilike(journalEntries.reference, like), ilike(journalEntries.memo, like),
        ...(txnNo != null ? [eq(journalEntries.txnNo, txnNo)] : []),
      )))
      .limit(PER),
    // Estimates & Purchase Orders
    db.select({ id: tradeDocuments.id, docNumber: tradeDocuments.docNumber, kind: tradeDocuments.kind, party: tradeDocuments.partyLabel, total: tradeDocuments.total })
      .from(tradeDocuments)
      .where(and(inOrg(tradeDocuments.orgId), or(ilike(tradeDocuments.docNumber, like), ilike(tradeDocuments.partyLabel, like))))
      .limit(PER),
    // Collections invoices (AR)
    db.select({ id: invoices.id, number: invoices.invoiceNumber, po: invoices.poNumber, date: invoices.invoiceDate })
      .from(invoices)
      .where(and(inOrg(invoices.orgId), or(ilike(invoices.invoiceNumber, like), ilike(invoices.poNumber, like))))
      .limit(PER),
  ]);

  const val = <T,>(i: number): T[] => (runs[i].status === "fulfilled" ? (runs[i] as any).value : []);

  const groups: { group: string; hits: SearchHit[] }[] = [];
  const add = (group: string, hits: SearchHit[]) => { if (hits.length) groups.push({ group, hits }); };
  const fmtTxn = (n: number | null) => (n == null ? "" : `TXN-${String(n).padStart(6, "0")}`);

  add("Customers", val<any>(0).map(r => ({ group: "Customers", type: "customer", id: r.id, title: r.name, subtitle: r.company || r.email || r.code, href: "/accounting/parties/customers" })));
  add("Suppliers", val<any>(1).map(r => ({ group: "Suppliers", type: "supplier", id: r.id, title: r.display || r.name, subtitle: r.email, href: "/accounting/parties/suppliers" })));
  add("Employees", val<any>(2).map(r => ({ group: "Employees", type: "employee", id: r.id, title: r.name, subtitle: r.email, href: "/accounting/parties/employees" })));
  add("Chart of Accounts", val<any>(3).map(r => ({ group: "Chart of Accounts", type: "account", id: r.id, title: r.code ? `${r.code} · ${r.name}` : r.name, subtitle: r.type, href: "/accounting/accounts" })));
  add("Products & Services", val<any>(4).map(r => ({ group: "Products & Services", type: "item", id: r.id, title: r.name, subtitle: r.code, href: "/accounting/items" })));
  add("Transactions", val<any>(5).map(r => ({ group: "Transactions", type: "transaction", id: r.id, title: r.docNumber || `JE-${r.entryNumber}`, subtitle: [r.sourceType, fmtTxn(r.txnNo), r.date, r.ref].filter(Boolean).join(" · "), href: "/accounting/journal" })));
  add("Estimates & POs", val<any>(6).map(r => ({ group: "Estimates & POs", type: "trade", id: r.id, title: r.docNumber || (r.kind === "Estimate" ? "Estimate" : "Purchase Order"), subtitle: r.party, href: r.kind === "Estimate" ? "/accounting/trade/estimates" : "/accounting/trade/purchase-orders" })));
  add("Invoices (AR)", val<any>(7).map(r => ({ group: "Invoices (AR)", type: "invoice", id: r.id, title: r.number, subtitle: [r.po, r.date].filter(Boolean).join(" · "), href: "/board" })));

  const total = groups.reduce((s, g) => s + g.hits.length, 0);
  return { groups, total };
}
