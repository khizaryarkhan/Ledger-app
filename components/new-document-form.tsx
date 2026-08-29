"use client";

/**
 * One form for every native transaction under "New". Its behaviour is driven by
 * CFG[type]: line-item documents (Invoice/Bill/Credit note/…), money movements
 * (Receive payment/Pay bill), transfers and deposits. All double-entry rules
 * live server-side in lib/accounting/documents — this just collects the fields.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Check, Loader, AlertTriangle, X, FileText } from "lucide-react";
import { CURRENCIES } from "@/lib/accounting/currencies";
import { QuickAdd, type QuickAddKind } from "@/components/quick-add";
import { uom } from "@/lib/inventory/uom";
import { isTracked, kindOf } from "@/lib/inventory/item-kinds";

// Finished Product / Work in Progress lots are always system-generated at
// commit time — never a user-editable field here (see the "Receive to lot"
// row below and lib/inventory/valuation.ts's resolveLotNo).
const isFPWIP = (it: any) => ["FinishedProduct", "WorkInProgress"].includes(kindOf(it?.productType).kind);
import { Field, Section, SelectField, CellSelect, control, fieldLabel, cell, th as thCls } from "@/components/form-kit";

type DocType =
  | "Invoice" | "SalesReceipt" | "CreditNote" | "RefundReceipt"
  | "Bill" | "Expense" | "VendorCredit"
  | "Payment" | "BillPayment" | "Deposit" | "Transfer"
  | "Estimate" | "PurchaseOrder" | "SalesOrder";

type Cfg = {
  title: string;
  mode: "lineItems" | "payment" | "transfer" | "deposit";
  side?: "sales" | "purchase";
  party?: "Customer" | "Vendor";
  partyLabel?: string;
  tax?: boolean;
  // Line entry model: sales use items, purchases use both a category account and
  // items, deposits use accounts. (Journal has its own dedicated form.)
  lineMode?: "item" | "account" | "both";
  bank?: string;            // label for the bank field (present = show it)
  trade?: "estimates" | "purchase-orders" | "sales-orders"; // non-posting: save to /api/trade-documents
  dateLabel2?: string;      // second date field label (expiry / delivery)
  terms?: boolean;          // show payment terms + due date (Invoice/Bill)
  refLabel?: string;        // show a reference field with this label
  submit: string;
  blurb: string;
};

const TERMS: { key: string; label: string; days: number | null }[] = [
  { key: "receipt", label: "Due on receipt", days: 0 },
  { key: "net7", label: "Net 7", days: 7 },
  { key: "net15", label: "Net 15", days: 15 },
  { key: "net30", label: "Net 30", days: 30 },
  { key: "net60", label: "Net 60", days: 60 },
  { key: "custom", label: "Custom", days: null },
];
function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const CFG: Record<DocType, Cfg> = {
  Invoice:       { title: "Invoice",         mode: "lineItems", side: "sales",     party: "Customer", partyLabel: "Customer", tax: true, lineMode: "both", terms: true, refLabel: "Customer PO", submit: "Save invoice",        blurb: "Bill a customer. Posts Dr Accounts Receivable, Cr Income and Sales Tax." },
  SalesReceipt:  { title: "Sales receipt",   mode: "lineItems", side: "sales",     party: "Customer", partyLabel: "Customer", tax: true, lineMode: "both", bank: "Deposit to",  submit: "Save sales receipt",  blurb: "A sale paid at the point of sale. Posts Dr Bank, Cr Income and Sales Tax." },
  CreditNote:    { title: "Credit note",     mode: "lineItems", side: "sales",     party: "Customer", partyLabel: "Customer", tax: true, lineMode: "both", submit: "Save credit note",    blurb: "Reduce what a customer owes. Posts Dr Income and Sales Tax, Cr Accounts Receivable." },
  RefundReceipt: { title: "Refund receipt",  mode: "lineItems", side: "sales",     party: "Customer", partyLabel: "Customer", tax: true, lineMode: "both", bank: "Refund from", submit: "Save refund",         blurb: "Refund a customer in cash. Posts Dr Income and Sales Tax, Cr Bank." },
  Bill:          { title: "Bill",            mode: "lineItems", side: "purchase",  party: "Vendor",   partyLabel: "Supplier", tax: true, lineMode: "both", terms: true, refLabel: "Supplier ref", submit: "Save bill",           blurb: "A supplier bill to pay later. Posts Dr Expense and Input Tax, Cr Accounts Payable." },
  Expense:       { title: "Expense",         mode: "lineItems", side: "purchase",  party: "Vendor",   partyLabel: "Supplier", tax: true, lineMode: "both", bank: "Paid from", refLabel: "Reference",  submit: "Save expense",        blurb: "A cost paid directly. Posts Dr Expense and Input Tax, Cr Bank." },
  VendorCredit:  { title: "Supplier credit", mode: "lineItems", side: "purchase",  party: "Vendor",   partyLabel: "Supplier", tax: true, lineMode: "both", submit: "Save supplier credit", blurb: "A credit from a supplier. Posts Dr Accounts Payable, Cr Expense and Input Tax." },
  Payment:       { title: "Receive payment", mode: "payment",   party: "Customer", partyLabel: "Customer", bank: "Deposit to", refLabel: "Reference no.", submit: "Save payment",        blurb: "Record money received from a customer. Posts Dr Bank, Cr Accounts Receivable." },
  BillPayment:   { title: "Pay bill",        mode: "payment",   party: "Vendor",   partyLabel: "Supplier", bank: "Paid from",  refLabel: "Reference no.", submit: "Save payment",        blurb: "Pay a supplier. Posts Dr Accounts Payable, Cr Bank." },
  Deposit:       { title: "Bank deposit",    mode: "deposit",   lineMode: "account", bank: "Deposit to", submit: "Save deposit",        blurb: "Money into a bank account. Posts Dr Bank, Cr the source accounts." },
  Transfer:      { title: "Transfer",        mode: "transfer",  submit: "Save transfer",       blurb: "Move money between two accounts. Posts Dr the destination, Cr the source." },
  Estimate:      { title: "Estimate",        mode: "lineItems", side: "sales",    party: "Customer", partyLabel: "Customer", tax: true, lineMode: "both", trade: "estimates",       dateLabel2: "Valid until",  submit: "Save estimate",       blurb: "A quote for a customer — no ledger impact until you convert it to an invoice." },
  PurchaseOrder: { title: "Purchase order",  mode: "lineItems", side: "purchase", party: "Vendor",   partyLabel: "Supplier", tax: true, lineMode: "both", trade: "purchase-orders", dateLabel2: "Delivery date", submit: "Save purchase order", blurb: "An order to a supplier — no ledger impact until you convert it to a bill." },
  SalesOrder:    { title: "Sales order",     mode: "lineItems", side: "sales",    party: "Customer", partyLabel: "Customer", tax: true, lineMode: "both", trade: "sales-orders",    dateLabel2: "Delivery date", submit: "Save sales order",    blurb: "A confirmed customer order — no ledger impact until you ship & invoice it." },
};

type Line = { itemId: string; accountId: string; accountOverride?: boolean; description: string; qty: string; rate: string; amount: string; taxRateId: string; classId: string; locationId: string; lotNo?: string; expiryDate?: string; orderUom?: string; packLevel?: string; unitsPerOrderUnit?: number; supplierSkuId?: string; skuId?: string };

type OrderOption = { label: string; packLevel: string; orderUom: string; unitsPerOrderUnit: number; supplierSkuId: string | null };
// Base units per one supplier UoM: same dimension → automatic ratio, else the
// SKU's manual conversion factor.
function perSupplierUnit(supplierUom: string | null, baseUom: string | null, factor: any): number | null {
  const a = uom(supplierUom), b = uom(baseUom);
  if (a && b && a.dimension === b.dimension) return a.toBase / b.toBase;
  const f = Number(factor); return f > 0 ? f : null;
}
/** Build the "order by" choices for a PO line from the item's base UoM + supplier SKUs. */
function orderOptions(baseUom: string | null, supplierSkus: any[]): OrderOption[] {
  const opts: OrderOption[] = [{ label: `${baseUom || "unit"} — base`, packLevel: "base", orderUom: baseUom || "", unitsPerOrderUnit: 1, supplierSkuId: null }];
  for (const s of supplierSkus || []) {
    const per = perSupplierUnit(s.supplierUom, baseUom, s.conversionFactor);
    if (!per) continue;
    if (s.supplierUom && s.supplierUom !== baseUom) opts.push({ label: `${s.supplierUom} — supplier UoM`, packLevel: "supplier", orderUom: s.supplierUom, unitsPerOrderUnit: per, supplierSkuId: s.id });
    const inner = Number(s.innerUnitPackSize) || 0;
    if (inner > 0) opts.push({ label: `${s.innerPackType || "inner pack"} (${inner} ${s.supplierUom || ""})`, packLevel: "inner", orderUom: s.innerPackType || "inner", unitsPerOrderUnit: inner * per, supplierSkuId: s.id });
    const outer = Number(s.unitsInOuterPack) || 0;
    if (inner > 0 && outer > 0) opts.push({ label: `${s.outerPackType || "outer pack"} (${outer} × ${s.innerPackType || "inner"})`, packLevel: "outer", orderUom: s.outerPackType || "outer", unitsPerOrderUnit: outer * inner * per, supplierSkuId: s.id });
  }
  return opts;
}
/** Sales pack choices from finished-product SKUs (pack sizes already in base UoM). */
function salesOrderOptions(baseUom: string | null, itemSkus: any[]): OrderOption[] {
  const opts: OrderOption[] = [{ label: `${baseUom || "unit"} — base`, packLevel: "base", orderUom: baseUom || "", unitsPerOrderUnit: 1, supplierSkuId: null }];
  for (const s of itemSkus || []) {
    const inner = Number(s.innerUnitPackSize) || 0;
    if (inner <= 0) continue;
    opts.push({ label: `${s.innerPackType || "inner pack"} (${inner} ${baseUom || ""})`, packLevel: "inner", orderUom: s.innerPackType || "inner", unitsPerOrderUnit: inner, supplierSkuId: s.id });
    const addl = Number(s.unitsInAddlInnerPack) || 0;
    const perAddl = addl > 0 ? inner * addl : inner;
    if (addl > 0) opts.push({ label: `${s.addlInnerPackType || "pack"} (${addl} × ${s.innerPackType || "inner"})`, packLevel: "addl", orderUom: s.addlInnerPackType || "pack", unitsPerOrderUnit: perAddl, supplierSkuId: s.id });
    const outer = Number(s.unitsInOuterPack) || 0;
    if (outer > 0) opts.push({ label: `${s.outerPackType || "outer pack"} (${outer} × ${addl > 0 ? (s.addlInnerPackType || "pack") : (s.innerPackType || "inner")})`, packLevel: "outer", orderUom: s.outerPackType || "outer", unitsPerOrderUnit: perAddl * outer, supplierSkuId: s.id });
  }
  return opts;
}
const emptyLine = (): Line => ({ itemId: "", accountId: "", description: "", qty: "", rate: "", amount: "", taxRateId: "", classId: "", locationId: "" });
const todayStr = () => new Date().toISOString().slice(0, 10);
const num = (s: string) => Number(s) || 0;
const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function NewDocumentForm({ type }: { type: DocType }) {
  const cfg = CFG[type];
  const router = useRouter();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [itemPacks, setItemPacks] = useState<Record<string, { baseUom: string | null; supplierSkus: any[]; skus: any[] }>>({});
  const [taxes, setTaxes] = useState<any[]>([]);
  const [dims, setDims] = useState<any[]>([]);
  const [parties, setParties] = useState<any[]>([]);
  const [home, setHome] = useState("");
  const [mcEnabled, setMcEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  const [date, setDate] = useState(todayStr());
  const [expiryDate, setExpiryDate] = useState("");
  const [termsKey, setTermsKey] = useState("net30");
  const [dueDate, setDueDate] = useState(addDays(todayStr(), 30));
  const [reference, setReference] = useState("");
  const [docNumber, setDocNumber] = useState("");
  const [memo, setMemo] = useState("");
  const [partyId, setPartyId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [toBankAccountId, setToBankAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [openDocs, setOpenDocs] = useState<any[] | null>(null);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [credits, setCredits] = useState<any[] | null>(null);
  const [creditAlloc, setCreditAlloc] = useState<Record<string, string>>({});
  const [paymentMethod, setPaymentMethod] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [currency, setCurrency] = useState("");
  const [rate, setRate] = useState("1");
  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine()]);
  const [availablePayments, setAvailablePayments] = useState<any[]>([]);
  const [sweptPaymentIds, setSweptPaymentIds] = useState<string[]>([]);

  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ docNumber?: string; txnNo?: number } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  // Inline "+ Add new" from a dropdown → quick-create drawer.
  const [quickAdd, setQuickAdd] = useState<{ kind: QuickAddKind; lineIndex?: number; field?: "bank" | "toBank" } | null>(null);

  // Reopen-to-edit: /accounting/new/<Type>?edit=<entryId> loads the stored form
  // payload and switches Save to an in-place update.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const eid = new URLSearchParams(window.location.search).get("edit");
    if (!eid) return;
    setEditId(eid);
    fetch(`/api/documents/${type}/${eid}`).then(r => r.json()).then(d => {
      const p = d?.payload; if (!p) return;
      setDate(p.date ?? todayStr());
      setDocNumber(p.docNumber ?? "");
      setMemo(p.memo ?? "");
      setPartyId(p.partyId ?? "");
      setBankAccountId(p.bankAccountId ?? "");
      if (p.currency) setCurrency(p.currency);
      if (p.exchangeRate) setRate(String(p.exchangeRate));
      if (p.dueDate) { setDueDate(p.dueDate); setTermsKey("custom"); }
      setReference(p.reference ?? "");
      if (cfg.mode === "payment") {
        // Payment edit: reallocate / correct amount. Load the party's open items
        // and credits AS IF this payment weren't applied (excludeContext), then
        // prefill the current allocations so they can be adjusted.
        setAmount(p.amount != null ? String(p.amount) : "");
        setAmountTouched(true);
        if (p.paymentMethod) setPaymentMethod(p.paymentMethod);
        const a: Record<string, string> = {}; (p.allocations || []).forEach((x: any) => { a[x.targetId] = String(x.amount); }); setAlloc(a);
        const ca: Record<string, string> = {}; (p.creditApplications || []).forEach((x: any) => { ca[x.sourceId] = String(x.amount); }); setCreditAlloc(ca);
        const sideq = cfg.party === "Vendor" ? "vendor" : "customer";
        if (p.partyId) {
          fetch(`/api/transactions/open?side=${sideq}&partyId=${p.partyId}&excludeContext=${eid}`).then(r => r.json()).then(x => setOpenDocs(Array.isArray(x) ? x : [])).catch(() => setOpenDocs([]));
          fetch(`/api/transactions/credits?side=${sideq}&partyId=${p.partyId}&excludeContext=${eid}`).then(r => r.json()).then(x => setCredits(Array.isArray(x) ? x : [])).catch(() => setCredits([]));
        }
      } else if (Array.isArray(p.lines) && p.lines.length) {
        setLines(p.lines.map((l: any) => ({
          itemId: l.itemId ?? "", accountId: l.accountId ?? "", accountOverride: !!l.accountOverride, description: l.description ?? "",
          qty: l.qty != null ? String(l.qty) : "", rate: l.rate != null ? String(l.rate) : "",
          amount: l.amount != null ? String(l.amount) : "", taxRateId: l.taxRateId ?? "", classId: l.classId ?? "", locationId: l.locationId ?? "",
          lotNo: l.lotNo ?? undefined, expiryDate: l.expiryDate ?? undefined,
        })));
      }
    }).catch(() => {});
  }, [type]);

  useEffect(() => {
    if (cfg.mode !== "deposit") return;
    fetch("/api/documents/payments/available-for-deposit").then(r => r.json())
      .then(d => setAvailablePayments(Array.isArray(d?.payments) ? d.payments : [])).catch(() => setAvailablePayments([]));
  }, [cfg.mode]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const partyUrl = cfg.party === "Vendor" ? "/api/parties/suppliers?native=1" : "/api/parties/customers?native=1";
        const [a, i, t, dm, p, num] = await Promise.all([
          fetch("/api/accounting/accounts").then(r => r.json()).catch(() => []),
          fetch("/api/accounting/items").then(r => r.json()).catch(() => []),
          fetch("/api/accounting/tax-rates").then(r => r.json()).catch(() => []),
          fetch("/api/accounting/dimensions").then(r => r.json()).catch(() => []),
          cfg.party ? fetch(partyUrl).then(r => r.json()).catch(() => []) : Promise.resolve([]),
          fetch(`/api/numbering?peek=${type}`).then(r => r.json()).catch(() => null),
        ]);
        setAccounts(Array.isArray(a) ? a.filter((x: any) => x.status !== "Inactive") : []);
        setItems(Array.isArray(i) ? i.filter((x: any) => x.status !== "Inactive") : []);
        setTaxes(Array.isArray(t) ? t.filter((x: any) => x.status !== "Inactive") : []);
        setDims(Array.isArray(dm) ? dm.filter((x: any) => x.status !== "Inactive") : []);
        setParties(Array.isArray(p) ? p : []);
        const editing = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("edit");
        if (num?.docNumber && !editing) setDocNumber(num.docNumber);
        fetch("/api/org/settings").then(r => r.json()).then(o => {
          const h = o?.currency || ""; setHome(h); setMcEnabled(!!o?.multicurrencyEnabled);
          setCurrency(c => c || h);
        }).catch(() => {});
      } finally { setLoading(false); }
    })();
    // eslint-disable-next-line
  }, [type]);

  // Keep due date in sync with terms + issue date (unless Custom).
  function applyTerms(key: string, baseDate: string) {
    setTermsKey(key);
    const t = TERMS.find(x => x.key === key);
    if (t && t.days != null) setDueDate(addDays(baseDate, t.days));
  }
  const classes = useMemo(() => dims.filter(d => d.dimensionType === "Class"), [dims]);
  const locations = useMemo(() => dims.filter(d => d.dimensionType === "Location"), [dims]);
  const showDims = (cfg.mode === "lineItems") && (classes.length > 0 || locations.length > 0);

  // Account partitions
  const isControl = (a: any) => a.type === "Accounts Receivable" || a.type === "Accounts Payable" || a.subtype === "SalesTaxPayable";
  const banks = useMemo(() => accounts.filter(a => a.type === "Bank" || a.type === "Credit Card"), [accounts]);
  const lineAccounts = useMemo(() => {
    if (cfg.side === "sales") {
      const inc = accounts.filter(a => a.classification === "Revenue" || a.type === "Income" || a.type === "Other Income");
      return inc.length ? inc : accounts.filter(a => !isControl(a) && a.type !== "Bank");
    }
    if (cfg.side === "purchase") {
      const exp = accounts.filter(a => a.classification === "Expense" || ["Expense", "Cost of Goods Sold", "Other Expense", "Fixed Asset", "Other Current Asset", "Other Asset"].includes(a.type));
      return exp.length ? exp : accounts.filter(a => !isControl(a) && a.type !== "Bank");
    }
    // deposit: any non-control, non-bank source (income/other)
    return accounts.filter(a => !isControl(a));
  }, [accounts, cfg.side]);

  function onParty(id: string) {
    if (id === "__add__") { setQuickAdd({ kind: cfg.party === "Vendor" ? "supplier" : "customer" }); return; }
    setPartyId(id);
    if (mcEnabled) {
      const p = parties.find(x => x.id === id);
      // A party with a currency already set is LOCKED to it — the field below
      // renders read-only in that case, so this is the only place it changes.
      // A party with none yet just gets the home currency as an editable
      // starting point; posting a transaction in a different currency is what
      // actually assigns the party's currency (server-side, see documents.ts).
      const c = (p?.currency || home);
      setCurrency(c);
      if (c === home) setRate("1");
    }
    if (cfg.mode === "payment" && id) {
      setOpenDocs(null); setAlloc({}); setCredits(null); setCreditAlloc({});
      const side = cfg.party === "Vendor" ? "vendor" : "customer";
      fetch(`/api/transactions/open?side=${side}&partyId=${id}`).then(r => r.json())
        .then(d => setOpenDocs(Array.isArray(d) ? d : [])).catch(() => setOpenDocs([]));
      fetch(`/api/transactions/credits?side=${side}&partyId=${id}`).then(r => r.json())
        .then(d => setCredits(Array.isArray(d) ? d : [])).catch(() => setCredits([]));
    } else { setOpenDocs(null); setAlloc({}); setCredits(null); setCreditAlloc({}); }
  }
  const sumVals = (o: Record<string, string>) => Math.round(Object.values(o).reduce((s, v) => s + num(v), 0) * 100) / 100;
  const allocApplied = sumVals(alloc);
  const creditApplied = sumVals(creditAlloc);
  const customerBalance = Math.round((openDocs ?? []).reduce((s, d) => s + d.openFx, 0) * 100) / 100;
  const availableCredit = Math.round((credits ?? []).reduce((s, d) => s + d.open, 0) * 100) / 100;
  const allSelected = !!openDocs && openDocs.length > 0 && openDocs.every(d => num(alloc[d.id]) > 0);
  const round2 = (n: number) => Math.round(n * 100) / 100;

  // Keep "Amount received" (cash) synced to invoices − credits, unless the user
  // typed their own figure. Cash needed = what's applied minus credits used.
  function syncCash(invSum: number, credSum: number) {
    if (amountTouched) return;
    const cash = round2(invSum - credSum);
    setAmount(cash > 0 ? String(cash) : "");
  }
  function setAllocSynced(next: Record<string, string>) { setAlloc(next); syncCash(sumVals(next), creditApplied); }
  function setCreditSynced(next: Record<string, string>) { setCreditAlloc(next); syncCash(allocApplied, sumVals(next)); }
  function toggleRow(d: any) { setAllocSynced({ ...alloc, [d.id]: num(alloc[d.id]) > 0 ? "" : String(d.openFx) }); }
  function toggleAll() { const next: Record<string, string> = {}; for (const d of openDocs ?? []) next[d.id] = allSelected ? "" : String(d.openFx); setAllocSynced(next); }
  function toggleCredit(c: any) {
    if (num(creditAlloc[c.id]) > 0) { setCreditSynced({ ...creditAlloc, [c.id]: "" }); return; }
    // Fill only up to what's still being settled after other credits — never
    // apply more credit than the invoices being paid.
    const remainingToSettle = round2(allocApplied - creditApplied);
    const fill = round2(Math.min(c.open, Math.max(0, remainingToSettle)));
    setCreditSynced({ ...creditAlloc, [c.id]: fill > 0 ? String(fill) : "" });
  }
  function clearPayment() { setAmountTouched(false); setAlloc({}); setCreditAlloc({}); setAmount(""); }

  const foreign = mcEnabled && currency !== "" && currency !== home;
  // Once a party has a currency, every transaction for them is locked to it
  // (matches QBO — a customer/supplier's currency is set once, from its first
  // transaction, and can't be overridden document-by-document after that).
  const selectedParty = useMemo(() => parties.find(p => p.id === partyId), [parties, partyId]);
  const partyLockedCurrency: string | null = mcEnabled && selectedParty?.currency ? selectedParty.currency : null;

  // A Bank/Credit Card account can carry its own currency (Chart of Accounts
  // setting) purely as a default — picking it pre-fills the transaction
  // currency, but never overrides an already-locked party currency.
  function onBankAccount(id: string) {
    setBankAccountId(id);
    if (mcEnabled && !partyLockedCurrency) {
      const acct = accounts.find(a => a.id === id);
      if (acct?.currency) { setCurrency(acct.currency); if (acct.currency === home) setRate("1"); }
    }
  }

  function setLine(i: number, patch: Partial<Line>) {
    setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  }
  // The account an item posts through. Mirrors the authoritative rule in
  // lib/accounting/documents.ts (accountFor) — the server derives this from the
  // item and ignores whatever account we send, so the form must show the same
  // answer rather than letting the user pick a different one.
  function itemAccountId(it: any): string {
    if (!it) return "";
    if (cfg.side === "purchase") {
      return (isTracked(it.productType) ? it.assetAccountId : it.expenseAccountId) || "";
    }
    return it.incomeAccountId || "";
  }
  function applyItem(i: number, it: any) {
    const acct = itemAccountId(it);
    const rate = cfg.side === "purchase" ? (it.unitCost ?? "") : (it.unitPrice ?? "");
    setLine(i, { itemId: it.id, accountId: acct || lines[i].accountId, rate: rate === null ? "" : String(rate ?? ""), taxRateId: it.taxRateId || lines[i].taxRateId, description: it.name || lines[i].description, orderUom: it.baseUom || "", packLevel: "base", unitsPerOrderUnit: 1, supplierSkuId: "", lotNo: "" });
    recompute(i, { rate: String(rate ?? "") });
    // Pre-fill a suggested lot code for Stock Item / Raw Material purchases —
    // FP/WIP items never get an editable suggestion (see isFPWIP above).
    if (cfg.side === "purchase" && it.lotTracked && !isFPWIP(it)) {
      fetch(`/api/inventory/lot-suggestion`).then(r => r.json()).then(s => { if (s?.code) setLine(i, { lotNo: s.code }); }).catch(() => {});
    }
  }
  // On a purchase order, load the item's packaging so the line can be ordered
  // by base / supplier UoM / inner / outer pack.
  async function loadPacks(itemId: string) {
    if (itemPacks[itemId]) return;
    const d = await fetch(`/api/inventory/items/${itemId}`).then(r => r.json()).catch(() => null);
    if (d?.item) setItemPacks(p => ({ ...p, [itemId]: { baseUom: d.item.baseUom ?? null, supplierSkus: d.supplierSkus ?? [], skus: d.skus ?? [] } }));
  }
  function onItem(i: number, itemId: string) {
    if (itemId === "__add__") { setQuickAdd({ kind: "item", lineIndex: i }); return; }
    const it = items.find(x => x.id === itemId);
    if (!it) { setLine(i, { itemId: "" }); return; }
    applyItem(i, it);
    if (cfg.trade === "purchase-orders" || cfg.trade === "sales-orders") loadPacks(itemId);
  }
  function onOrderLevel(i: number, opt: OrderOption) {
    // On a sales order the pack option is a finished-product SKU (item_skus) —
    // that IS the stock SKU. On a purchase order it's a supplier SKU (ordering
    // communication only); SI stock stays base UoM (skuId null).
    const stockSkuId = cfg.side === "sales" ? (opt.supplierSkuId ?? "") : "";
    setLine(i, { orderUom: opt.orderUom, packLevel: opt.packLevel, unitsPerOrderUnit: opt.unitsPerOrderUnit, supplierSkuId: opt.supplierSkuId ?? "", skuId: stockSkuId });
  }

  // Resolve a completed quick-add into the right list + selection.
  function onQuickCreated(row: any) {
    const q = quickAdd; if (!q) return;
    if (q.kind === "customer" || q.kind === "supplier") {
      setParties(p => [row, ...p]); setPartyId(row.id);
      if (mcEnabled) { const c = row.currency || home; setCurrency(c); if (c === home) setRate("1"); }
      if (cfg.mode === "payment") {
        const sideq = cfg.party === "Vendor" ? "vendor" : "customer";
        fetch(`/api/transactions/open?side=${sideq}&partyId=${row.id}`).then(r => r.json()).then(d => setOpenDocs(Array.isArray(d) ? d : [])).catch(() => setOpenDocs([]));
        fetch(`/api/transactions/credits?side=${sideq}&partyId=${row.id}`).then(r => r.json()).then(d => setCredits(Array.isArray(d) ? d : [])).catch(() => setCredits([]));
      }
    } else if (q.kind === "item") {
      setItems(i => [row, ...i]); if (q.lineIndex != null) applyItem(q.lineIndex, row);
    } else if (q.kind.startsWith("account")) {
      setAccounts(a => [row, ...a]);
      if (q.field === "bank") setBankAccountId(row.id);
      else if (q.field === "toBank") setToBankAccountId(row.id);
      else if (q.lineIndex != null) setLine(q.lineIndex, { accountId: row.id });
    } else if (q.kind === "tax") {
      setTaxes(t => [row, ...t]); if (q.lineIndex != null) setLine(q.lineIndex, { taxRateId: row.id });
    } else if (q.kind === "class") {
      setDims(d => [row, ...d]); if (q.lineIndex != null) setLine(q.lineIndex, { classId: row.id });
    } else if (q.kind === "location") {
      setDims(d => [row, ...d]); if (q.lineIndex != null) setLine(q.lineIndex, { locationId: row.id });
    }
    setQuickAdd(null);
  }
  const ADD = "__add__";
  function recompute(i: number, patch: Partial<Line>) {
    setLines(ls => ls.map((l, idx) => {
      if (idx !== i) return l;
      const merged = { ...l, ...patch };
      const q = num(merged.qty), r = num(merged.rate);
      if (q && r) merged.amount = (Math.round(q * r * 100) / 100).toString();
      return merged;
    }));
  }

  const taxPct = (id: string) => Number(taxes.find(t => t.id === id)?.rate) || 0;
  const totals = useMemo(() => {
    if (cfg.mode === "lineItems") {
      const net = lines.reduce((s, l) => s + num(l.amount), 0);
      const tax = lines.reduce((s, l) => s + num(l.amount) * taxPct(l.taxRateId) / 100, 0);
      return { net: Math.round(net * 100) / 100, tax: Math.round(tax * 100) / 100, total: Math.round((net + tax) * 100) / 100 };
    }
    if (cfg.mode === "deposit") {
      const net = lines.reduce((s, l) => s + num(l.amount), 0);
      return { net: Math.round(net * 100) / 100, tax: 0, total: Math.round(net * 100) / 100 };
    }
    const a = num(amount);
    return { net: a, tax: 0, total: a };
  }, [lines, amount, cfg.mode, taxes]);

  async function submit() {
    setPosting(true); setErr("");
    try {
      const party = parties.find(p => p.id === partyId);
      const payload: any = { date, docNumber: docNumber.trim() || undefined, memo: memo.trim() || undefined };
      if (foreign) { payload.currency = currency; payload.exchangeRate = num(rate); }
      if (cfg.party) { payload.partyType = cfg.party; payload.partyId = partyId || undefined; payload.partyLabel = party?.name || undefined; }
      if (cfg.bank) payload.bankAccountId = bankAccountId || undefined;
      if (cfg.mode === "transfer") { payload.bankAccountId = bankAccountId || undefined; payload.toBankAccountId = toBankAccountId || undefined; payload.amount = num(amount); }
      if (cfg.mode === "payment") {
        payload.amount = num(amount);
        const allocations = Object.entries(alloc).map(([targetId, v]) => ({ targetId, amount: num(v) })).filter(a => a.amount > 0);
        if (allocations.length) payload.allocations = allocations;
        const creditApplications = Object.entries(creditAlloc)
          .map(([sourceId, v]) => ({ sourceId, sourceType: (credits ?? []).find(c => c.id === sourceId)?.sourceType, amount: num(v) }))
          .filter(a => a.amount > 0);
        if (creditApplications.length) payload.creditApplications = creditApplications;
        if (paymentMethod) payload.paymentMethod = paymentMethod;   // structured, not folded into memo
      }
      if (cfg.mode === "lineItems") {
        // Item lines need Qty × Rate; account (COA) lines just need an amount.
        for (const l of lines) {
          const used = l.itemId || l.accountId || num(l.amount);
          if (!used) continue;
          if (l.itemId) {
            if (!num(l.qty) || l.rate.trim() === "") { setErr("Product/service lines need a quantity and a rate."); setPosting(false); return; }
            // The line posts to the item's default income/expense account; without
            // one it would be silently dropped by the filter below — surface it.
            if (!l.accountId) {
              const nm = items.find(x => x.id === l.itemId)?.name || "This item";
              setErr(`${nm} has no ${cfg.side === "sales" ? "income" : "expense"} account set — add one in Products & Services before using it here.`);
              setPosting(false); return;
            }
          } else if (!l.accountId || num(l.amount) === 0) {
            setErr("Each line needs an account (or a product/service) and an amount."); setPosting(false); return;
          }
        }
      }
      if (cfg.terms) payload.dueDate = dueDate || undefined;
      if (cfg.refLabel && reference.trim()) payload.reference = reference.trim();
      if (cfg.mode === "deposit" && sweptPaymentIds.length) payload.sweptPaymentIds = sweptPaymentIds;
      if (cfg.mode === "lineItems" || cfg.mode === "deposit") {
        payload.lines = lines
          .filter(l => l.accountId && num(l.amount) !== 0)
          .map(l => ({ accountId: l.accountId, accountOverride: !!l.accountOverride, itemId: l.itemId || null, description: l.description.trim() || null, qty: num(l.qty) || null, rate: num(l.rate) || null, amount: num(l.amount), taxRateId: l.taxRateId || null, classId: l.classId || null, locationId: l.locationId || null, lotNo: l.lotNo || null, expiryDate: l.expiryDate || null, orderUom: l.orderUom || null, packLevel: l.packLevel || null, unitsPerOrderUnit: l.unitsPerOrderUnit ?? 1, supplierSkuId: l.supplierSkuId || null, skuId: l.skuId || null }));
      }

      let url = `/api/documents/${type}`;
      let method = "POST";
      if (editId) { url = `/api/documents/${type}/${editId}`; method = "PUT"; }
      else if (cfg.trade) { url = `/api/trade-documents/${cfg.trade}`; payload.issueDate = date; payload.expiryDate = expiryDate || undefined; }

      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || "Failed to save"); return; }
      setDone({ docNumber: d.docNumber, txnNo: d.txnNo });
    } finally { setPosting(false); }
  }

  function reset() {
    setDone(null); setErr(""); setMemo(""); setPartyId(""); setBankAccountId(""); setToBankAccountId(""); setAmount(""); setOpenDocs(null); setAlloc({}); setCredits(null); setCreditAlloc({}); setPaymentMethod(""); setAmountTouched(false);
    setLines([emptyLine(), emptyLine()]); setDate(todayStr()); setExpiryDate(""); setCurrency(home); setRate("1");
    setReference(""); setTermsKey("net30"); setDueDate(addDays(todayStr(), 30));
    fetch(`/api/numbering?peek=${type}`).then(r => r.json()).then(n => n?.docNumber && setDocNumber(n.docNumber)).catch(() => {});
  }

  const input = control;        // boxed field control (form-kit)
  const label = fieldLabel;     // micro uppercase label (form-kit)

  if (done) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="rounded-2xl bg-stone-900 border border-stone-800 p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-4"><Check size={24} className="text-emerald-400" /></div>
          <h2 className="text-lg font-semibold text-white">{cfg.title} posted</h2>
          <p className="text-sm text-stone-400 mt-1">
            {done.docNumber && <span className="font-mono">{done.docNumber}</span>}
            {done.txnNo != null && <span className="text-stone-600"> · TXN-{String(done.txnNo).padStart(6, "0")}</span>}
            {" "}for <span className="text-stone-200 font-medium">{money(totals.total)}</span> {currency || home}
          </p>
          <div className="flex items-center justify-center gap-3 mt-6">
            <button onClick={reset} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium">New {cfg.title.toLowerCase()}</button>
            <Link href={cfg.trade ? `/accounting/trade/${cfg.trade}` : "/accounting/journal"} className="px-4 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-sm">{cfg.trade ? `View ${cfg.title.toLowerCase()}s` : "View in ledger"}</Link>
          </div>
        </div>
      </div>
    );
  }

  const partyRequired = !!cfg.party && cfg.mode !== "deposit";
  const close = () => router.back();
  const cur = currency || home;
  // Which line columns to show (see the item/account model in CFG).
  const showItemCol = (cfg.lineMode === "item" || cfg.lineMode === "both") && items.length > 0;
  // A Purchase Order is item-based and non-accounting → one row per item, no
  // account column (the posting account is resolved when it becomes a Bill).
  const isOrderDoc = (cfg.trade === "purchase-orders" || cfg.trade === "sales-orders") && items.length > 0;
  const showAccountCol = isOrderDoc ? false : ((cfg.lineMode === "account" || cfg.lineMode === "both") || (cfg.lineMode === "item" && items.length === 0));
  const accountHeader = cfg.side === "sales" ? "Income account" : cfg.side === "purchase" ? "Category / account" : "Account";

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />
      <div className="relative h-full w-full sm:w-[95vw] max-w-[1320px] bg-stone-950 border-l border-stone-800 shadow-2xl ring-1 ring-black/40 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-6 py-3.5 border-b border-stone-800 bg-gradient-to-b from-stone-900 to-stone-900/70 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/20 flex items-center justify-center shrink-0"><FileText size={17} className="text-emerald-400" /></div>
            <div className="min-w-0">
              <h1 className="text-[17px] font-semibold text-stone-100 leading-tight truncate">{editId ? "Edit" : "New"} {cfg.title.toLowerCase()}</h1>
              <p className="text-[11px] text-stone-500 truncate">{cfg.blurb}</p>
            </div>
          </div>
          <div className="flex items-center gap-5 shrink-0">
            <div className="text-right hidden sm:block">
              <div className="text-[10px] uppercase tracking-wider text-stone-500">Total</div>
              <div className="text-lg font-semibold text-white tabular-nums leading-tight">{money(totals.total)} <span className="text-[12px] text-stone-500 font-normal">{cur}</span></div>
            </div>
            <button onClick={close} className="text-stone-500 hover:text-stone-200 hover:bg-stone-800 p-1.5 rounded-lg transition" title="Close"><X size={20} /></button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <div className="py-10 text-center text-stone-500 text-sm inline-flex items-center gap-2"><Loader size={14} className="animate-spin" /> Loading…</div>
        ) : (
          <div className="space-y-6 max-w-[1200px]">
            {err && <div className="text-[12px] text-rose-400 bg-rose-950/40 border border-rose-900 rounded-lg px-3 py-2 inline-flex items-center gap-2"><AlertTriangle size={13} /> {err}</div>}

          {/* Document header — aligned grid, grouped by who / details */}
          <div className="rounded-xl border border-stone-800/80 bg-stone-900/40 p-4 sm:p-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-4">
              {cfg.party && (
                <Field label={cfg.partyLabel} required={partyRequired} className="col-span-2">
                  <SelectField value={partyId} onChange={e => onParty(e.target.value)}>
                    <option value="">Select {cfg.partyLabel?.toLowerCase()}…</option>
                    {parties.map(p => <option key={p.id} value={p.id}>{p.name}{p.currency && p.currency !== home ? ` · ${p.currency}` : ""}</option>)}
                    <option value={ADD}>+ Add new {cfg.partyLabel?.toLowerCase()}…</option>
                  </SelectField>
                </Field>
              )}
              {cfg.bank && (
                <Field label={cfg.bank} required className="col-span-2">
                  <SelectField value={bankAccountId} onChange={e => e.target.value === ADD ? setQuickAdd({ kind: "account-bank", field: "bank" }) : onBankAccount(e.target.value)}>
                    <option value="">Select account…</option>
                    {banks.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    <option value={ADD}>+ Add new bank account…</option>
                  </SelectField>
                </Field>
              )}
              {cfg.mode === "transfer" && (
                <>
                  <Field label="From" required className="col-span-2">
                    <SelectField value={bankAccountId} onChange={e => e.target.value === ADD ? setQuickAdd({ kind: "account-bank", field: "bank" }) : setBankAccountId(e.target.value)}>
                      <option value="">Select account…</option>
                      {banks.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      <option value={ADD}>+ Add new bank account…</option>
                    </SelectField>
                  </Field>
                  <Field label="To" required className="col-span-2">
                    <SelectField value={toBankAccountId} onChange={e => e.target.value === ADD ? setQuickAdd({ kind: "account-bank", field: "toBank" }) : setToBankAccountId(e.target.value)}>
                      <option value="">Select account…</option>
                      {banks.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      <option value={ADD}>+ Add new bank account…</option>
                    </SelectField>
                  </Field>
                </>
              )}
              <Field label={`${cfg.title} no.`}>
                <input value={docNumber} onChange={e => setDocNumber(e.target.value)} placeholder="Auto" className={`${input} font-mono`} />
              </Field>
              <Field label="Date" required>
                <input type="date" value={date} onChange={e => { setDate(e.target.value); if (cfg.terms) applyTerms(termsKey, e.target.value); }} className={input} />
              </Field>
              {cfg.terms && (
                <>
                  <Field label="Terms">
                    <SelectField value={termsKey} onChange={e => applyTerms(e.target.value, date)}>
                      {TERMS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                    </SelectField>
                  </Field>
                  <Field label="Due date">
                    <input type="date" value={dueDate} onChange={e => { setDueDate(e.target.value); setTermsKey("custom"); }} className={input} />
                  </Field>
                </>
              )}
              {cfg.refLabel && (
                <Field label={cfg.refLabel}>
                  <input value={reference} onChange={e => setReference(e.target.value)} placeholder="Optional" className={input} />
                </Field>
              )}
              {cfg.dateLabel2 && (
                <Field label={cfg.dateLabel2}>
                  <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} className={input} />
                </Field>
              )}
              {mcEnabled && (
                <Field label="Currency" hint={partyLockedCurrency ? "Fixed by this party's currency" : undefined}>
                  {partyLockedCurrency ? (
                    <div className={`${input} bg-stone-800/60 text-stone-300 cursor-not-allowed`}>{partyLockedCurrency}{partyLockedCurrency === home ? " (home)" : ""}</div>
                  ) : (
                    <SelectField value={currency} onChange={e => { setCurrency(e.target.value); if (e.target.value === home) setRate("1"); }}>
                      {home && !CURRENCIES.some(c => c.code === home) && <option value={home}>{home} (home)</option>}
                      {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code}{c.code === home ? " (home)" : ""}</option>)}
                    </SelectField>
                  )}
                </Field>
              )}
              {foreign && (
                <Field label="Exchange rate" required hint={`1 ${currency} = ${rate || "?"} ${home}`}>
                  <input type="number" step="0.000001" min="0" value={rate} onChange={e => setRate(e.target.value)} className={input} />
                </Field>
              )}
            </div>
          </div>

          {/* Amount (transfer) */}
          {cfg.mode === "transfer" && (
            <div className="w-52">
              <label className={label}>Amount *</label>
              <input type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} className={`${input} w-full text-right tabular-nums`} />
            </div>
          )}

          {/* Receive payment / Pay bill — QBO-style */}
          {cfg.mode === "payment" && (() => {
            const noun = cfg.party === "Vendor" ? "bill" : "invoice";
            const amountToApply = allocApplied;                                  // total applied to invoices/bills
            const amountToCredit = round2(num(amount) - (allocApplied - creditApplied)); // leftover cash → new credit
            return (
              <div className="space-y-4">
                <div className="flex flex-wrap items-end gap-4">
                  <div className="w-48">
                    <label className={label}>Payment method</label>
                    <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} className={`${input} w-full`}>
                      <option value="">Choose…</option>
                      {["Cash", "Bank transfer", "Cheque", "Card", "Direct debit", "Online", "Other"].map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="w-52">
                    <label className={label}>Amount received *</label>
                    <input type="number" step="0.01" min="0" value={amount} onChange={e => { setAmount(e.target.value); setAmountTouched(true); }} className={`${input} w-full text-right tabular-nums text-base`} />
                  </div>
                  {partyId && openDocs && (
                    <div className="ml-auto text-right">
                      <div className="text-[10px] uppercase tracking-wider text-stone-500">{cfg.party === "Vendor" ? "Supplier" : "Customer"} balance</div>
                      <div className="text-lg font-semibold text-stone-200 tabular-nums">{money(customerBalance)} <span className="text-[12px] text-stone-500 font-normal">{cur}</span></div>
                    </div>
                  )}
                </div>

                {!partyId ? (
                  <div className="text-[12px] text-stone-500">Select a {cfg.partyLabel?.toLowerCase()} to see their outstanding {noun}s.</div>
                ) : openDocs === null ? (
                  <div className="text-[12px] text-stone-500 inline-flex items-center gap-1"><Loader size={12} className="animate-spin" /> Loading outstanding {noun}s…</div>
                ) : openDocs.length === 0 ? (
                  <div className="text-[12px] text-stone-500">No outstanding {noun}s — this records as an unapplied {cfg.party === "Vendor" ? "payment" : "credit"} on account.</div>
                ) : (
                  <div className="rounded-xl border border-stone-800 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-stone-800 bg-stone-950/40">
                      <span className="text-[12px] font-semibold text-stone-300">Outstanding transactions</span>
                      <button type="button" onClick={clearPayment} className="text-[11px] text-stone-500 hover:text-stone-300">Clear payment</button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[13px] min-w-[640px]">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                            <th className="px-3 py-2 w-8"><input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-emerald-600" /></th>
                            <th className="text-left px-3 py-2">Description</th>
                            <th className="text-left px-3 py-2">Due date</th>
                            <th className="text-right px-3 py-2">Original amount</th>
                            <th className="text-right px-3 py-2">Open balance</th>
                            <th className="text-right px-3 py-2 w-32">Payment</th>
                          </tr>
                        </thead>
                        <tbody>
                          {openDocs.map(d => {
                            const overdue = d.dueDate && d.dueDate < todayStr();
                            const checked = num(alloc[d.id]) > 0;
                            return (
                              <tr key={d.id} className="border-b border-stone-800/50">
                                <td className="px-3 py-2"><input type="checkbox" checked={checked} onChange={() => toggleRow(d)} className="accent-emerald-600" /></td>
                                <td className="px-3 py-2"><span className="text-stone-200 font-medium">{d.docNumber}</span> <span className="text-[11px] text-stone-500">({d.date})</span></td>
                                <td className={`px-3 py-2 ${overdue ? "text-rose-400" : "text-stone-400"}`}>{d.dueDate || "—"}{overdue ? " ⚠" : ""}</td>
                                <td className="px-3 py-2 text-right tabular-nums text-stone-400">{money(d.totalFx)}</td>
                                <td className="px-3 py-2 text-right tabular-nums text-stone-300">{money(d.openFx)}</td>
                                <td className="px-3 py-2 text-right">
                                  <input type="number" step="0.01" min="0" max={d.openFx} value={alloc[d.id] ?? ""} onChange={e => setAllocSynced({ ...alloc, [d.id]: e.target.value })} className={`${input} w-28 text-right tabular-nums py-1.5`} />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Credits — draw down the party's unapplied payments / credit notes */}
                {partyId && credits && credits.length > 0 && (
                  <div className="rounded-xl border border-stone-800 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-stone-800 bg-stone-950/40">
                      <span className="text-[12px] font-semibold text-stone-300">Credits</span>
                      <span className="text-[11px] text-stone-500">{money(availableCredit)} {cur} available</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[13px] min-w-[640px]">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                            <th className="px-3 py-2 w-8"></th>
                            <th className="text-left px-3 py-2">Description</th>
                            <th className="text-left px-3 py-2">Date</th>
                            <th className="text-right px-3 py-2">Original amount</th>
                            <th className="text-right px-3 py-2">Open balance</th>
                            <th className="text-right px-3 py-2 w-32">Applied</th>
                          </tr>
                        </thead>
                        <tbody>
                          {credits.map(c => (
                            <tr key={c.id} className="border-b border-stone-800/50">
                              <td className="px-3 py-2"><input type="checkbox" checked={num(creditAlloc[c.id]) > 0} onChange={() => toggleCredit(c)} className="accent-emerald-600" /></td>
                              <td className="px-3 py-2"><span className="text-stone-200">{c.label}</span> <span className="text-[11px] text-stone-500 font-mono">{c.docNumber}</span></td>
                              <td className="px-3 py-2 text-stone-400">{c.date}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-stone-400">{money(c.total)}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-stone-300">{money(c.open)}</td>
                              <td className="px-3 py-2 text-right">
                                <input type="number" step="0.01" min="0" max={c.open} value={creditAlloc[c.id] ?? ""} onChange={e => setCreditSynced({ ...creditAlloc, [c.id]: e.target.value })} className={`${input} w-28 text-right tabular-nums py-1.5`} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Totals */}
                {partyId && (openDocs?.length || (credits?.length ?? 0)) ? (
                  <div className="flex flex-col items-end gap-1 text-[13px]">
                    <div className="flex justify-between gap-10 w-72"><span className="text-stone-400">Amount to apply</span><span className="tabular-nums text-stone-200">{money(amountToApply)}</span></div>
                    {creditApplied > 0 && <div className="flex justify-between gap-10 w-72"><span className="text-stone-400">…funded by credits</span><span className="tabular-nums text-stone-400">{money(creditApplied)}</span></div>}
                    <div className="flex justify-between gap-10 w-72"><span className="text-stone-400">Amount to credit</span><span className={`tabular-nums ${amountToCredit < -0.005 ? "text-rose-400" : "text-stone-200"}`}>{money(amountToCredit)}</span></div>
                    {amountToCredit < -0.005 && <div className="text-[11px] text-rose-400">Applied more than received — increase amount received or reduce the payments.</div>}
                    {amountToCredit > 0.005 && <div className="text-[11px] text-stone-500">The unapplied {money(amountToCredit)} will be kept as a {cfg.party === "Vendor" ? "supplier" : "customer"} credit on account.</div>}
                  </div>
                ) : null}
              </div>
            );
          })()}

          {/* Line items / deposit lines */}
          {(cfg.mode === "lineItems" || cfg.mode === "deposit") && (
            <Section title={cfg.mode === "deposit" ? "Sources" : "Line items"}>
              {(cfg.lineMode === "item" || cfg.lineMode === "both") && items.length === 0 && (
                <p className="text-[11px] text-stone-500">
                  Enter lines by income account below. To invoice by <b className="text-stone-400">Product/Service</b> (with Qty × Rate), add items in{" "}
                  <Link href="/accounting/items" className="text-emerald-400 hover:underline">Products &amp; Services</Link> — an Item column then appears here.
                </p>
              )}
              <div className="rounded-xl border border-stone-800/80 bg-stone-900/40 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px] min-w-[720px]">
                    <thead>
                      <tr className="border-b border-stone-800 bg-stone-900/60">
                        <th className={`${thCls} w-8 !text-center`}>#</th>
                        {showItemCol && <th className={thCls}>Product / Service</th>}
                        {showAccountCol && <th className={thCls}>{accountHeader}</th>}
                        <th className={thCls}>Description</th>
                        {cfg.mode === "lineItems" && <th className={`${thCls} !text-right w-16`}>Qty</th>}
                        {cfg.mode === "lineItems" && <th className={`${thCls} !text-right w-24`}>Rate</th>}
                        <th className={`${thCls} !text-right w-28`}>Amount</th>
                        {cfg.tax && <th className={`${thCls} w-32`}>Tax</th>}
                        {showDims && classes.length > 0 && <th className={`${thCls} w-32`}>Class</th>}
                        {showDims && locations.length > 0 && <th className={`${thCls} w-32`}>Location</th>}
                        <th className="w-9"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, i) => {
                        const lineItem = l.itemId ? items.find(x => x.id === l.itemId) : null;
                        // Lot/batch is captured at Receiving (or on a direct Bill/Expense),
                        // never on a Purchase Order — a PO is a non-accounting order.
                        const showLot = cfg.side === "purchase" && !cfg.trade && !!lineItem?.lotTracked;
                        return (
                        <Fragment key={i}>
                        <tr className={`group transition-colors hover:bg-stone-900/50 ${showLot ? "" : "border-b border-stone-800/50"}`}>
                          <td className="px-2 py-1 text-center text-stone-600 text-[11px] tabular-nums">{i + 1}</td>
                          {showItemCol && (
                            <td className="px-1.5 py-1">
                              <CellSelect value={l.itemId} onChange={e => onItem(i, e.target.value)}>
                                <option value="">—</option>
                                {items.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
                                <option value={ADD}>+ Add new item…</option>
                              </CellSelect>
                              {isOrderDoc && l.itemId && (() => {
                                const packs = itemPacks[l.itemId];
                                const baseU = packs?.baseUom ?? lineItem?.baseUom ?? null;
                                const opts = cfg.side === "purchase" ? orderOptions(baseU, packs?.supplierSkus ?? []) : salesOrderOptions(baseU, packs?.skus ?? []);
                                const cur = `${l.packLevel ?? "base"}|${l.supplierSkuId ?? ""}`;
                                return (
                                  <div className="mt-1">
                                    <CellSelect value={cur} onChange={e => { const o = opts.find(x => `${x.packLevel}|${x.supplierSkuId ?? ""}` === e.target.value); if (o) onOrderLevel(i, o); }} className="!h-7 !text-[11px] text-stone-400" title="Order by">
                                      {opts.map(o => <option key={`${o.packLevel}|${o.supplierSkuId ?? ""}`} value={`${o.packLevel}|${o.supplierSkuId ?? ""}`}>Order by: {o.label}</option>)}
                                    </CellSelect>
                                  </div>
                                );
                              })()}
                            </td>
                          )}
                          {showAccountCol && (() => {
                            // An item defines the account it posts through, so
                            // the account defaults to the item's and is shown
                            // locked — but it stays reviewable and can be
                            // deliberately overridden for this one line.
                            const itemAcctId = itemAccountId(lineItem);
                            // Buying a stock-tracked item MUST capitalise to its
                            // inventory asset (a FIFO lot is created against it),
                            // so that one is not overridable — the server
                            // enforces it regardless of what we send.
                            const hardLocked = !!lineItem && cfg.side === "purchase" && isTracked(lineItem.productType);
                            const showLocked = !!lineItem && !!itemAcctId && (hardLocked || !l.accountOverride);
                            if (showLocked) {
                              const acct = accounts.find((a: any) => a.id === itemAcctId);
                              return (
                                <td className="px-1.5 py-1">
                                  <div className="flex items-center gap-1">
                                    <div
                                      className={`${cell} text-stone-400 truncate cursor-default flex-1`}
                                      title={hardLocked
                                        ? `Stock item — must post to its inventory asset account, so it can't be changed here. Set it on the item "${lineItem.name}".`
                                        : `Set by the item "${lineItem.name}". Change it on the item, or override it for this line.`}
                                    >
                                      {acct ? `${acct.code ? `${acct.code} · ` : ""}${acct.name}` : "From item"}
                                    </div>
                                    {!hardLocked && (
                                      <button type="button" onClick={() => setLine(i, { accountOverride: true, accountId: l.accountId || itemAcctId })}
                                        title="Post this line to a different account"
                                        className="shrink-0 text-[10px] uppercase tracking-wide text-stone-500 hover:text-stone-300 px-1 py-0.5">
                                        Change
                                      </button>
                                    )}
                                  </div>
                                </td>
                              );
                            }
                            const overriding = !!lineItem && !!l.accountOverride;
                            return (
                              <td className="px-1.5 py-1">
                                <div className="flex items-center gap-1">
                                  <div className="flex-1 min-w-0">
                                    <CellSelect value={l.accountId} onChange={e => e.target.value === ADD ? setQuickAdd({ kind: cfg.side === "sales" ? "account-income" : "account-expense", lineIndex: i }) : setLine(i, { accountId: e.target.value })}>
                                      <option value="">Select…</option>
                                      {lineAccounts.map(a => <option key={a.id} value={a.id}>{a.code ? `${a.code} · ` : ""}{a.name}</option>)}
                                      <option value={ADD}>+ Add new account…</option>
                                    </CellSelect>
                                  </div>
                                  {overriding && (
                                    <button type="button" onClick={() => setLine(i, { accountOverride: false, accountId: itemAcctId })}
                                      title={`Overriding the item's account. Revert to "${lineItem.name}" default.`}
                                      className="shrink-0 text-[10px] uppercase tracking-wide text-amber-500 hover:text-amber-400 px-1 py-0.5">
                                      Reset
                                    </button>
                                  )}
                                </div>
                              </td>
                            );
                          })()}
                          <td className="px-1.5 py-1"><input value={l.description} onChange={e => setLine(i, { description: e.target.value })} placeholder="—" className={cell} /></td>
                          {cfg.mode === "lineItems" && <td className="px-1.5 py-1"><input type="number" step="0.01" value={l.qty} onChange={e => recompute(i, { qty: e.target.value })} className={`${cell} text-right tabular-nums`} /></td>}
                          {cfg.mode === "lineItems" && <td className="px-1.5 py-1"><input type="number" step="0.01" value={l.rate} onChange={e => recompute(i, { rate: e.target.value })} className={`${cell} text-right tabular-nums`} /></td>}
                          <td className="px-1.5 py-1"><input type="number" step="0.01" value={l.amount} onChange={e => setLine(i, { amount: e.target.value })} className={`${cell} text-right tabular-nums font-medium`} /></td>
                          {cfg.tax && (
                            <td className="px-1.5 py-1">
                              <CellSelect value={l.taxRateId} onChange={e => e.target.value === ADD ? setQuickAdd({ kind: "tax", lineIndex: i }) : setLine(i, { taxRateId: e.target.value })}>
                                <option value="">No tax</option>
                                {taxes.map(t => <option key={t.id} value={t.id}>{t.name} ({Number(t.rate)}%)</option>)}
                                <option value={ADD}>+ Add new tax rate…</option>
                              </CellSelect>
                            </td>
                          )}
                          {showDims && classes.length > 0 && (
                            <td className="px-1.5 py-1">
                              <CellSelect value={l.classId} onChange={e => e.target.value === ADD ? setQuickAdd({ kind: "class", lineIndex: i }) : setLine(i, { classId: e.target.value })}>
                                <option value="">—</option>
                                {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                <option value={ADD}>+ Add new class…</option>
                              </CellSelect>
                            </td>
                          )}
                          {showDims && locations.length > 0 && (
                            <td className="px-1.5 py-1">
                              <CellSelect value={l.locationId} onChange={e => e.target.value === ADD ? setQuickAdd({ kind: "location", lineIndex: i }) : setLine(i, { locationId: e.target.value })}>
                                <option value="">—</option>
                                {locations.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                <option value={ADD}>+ Add new location…</option>
                              </CellSelect>
                            </td>
                          )}
                          <td className="px-1 py-1 text-center">
                            {lines.length > 1 && <button onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))} title="Remove line" className="p-1 rounded-md text-stone-600 opacity-0 group-hover:opacity-100 hover:bg-stone-800 hover:text-rose-400 transition"><Trash2 size={14} /></button>}
                          </td>
                        </tr>
                        {showLot && (
                          <tr className="border-b border-stone-800/50">
                            <td></td>
                            <td colSpan={20} className="px-2 pb-2 pt-0">
                              <div className="flex items-center gap-2 flex-wrap text-[11px] text-stone-500">
                                <span className="uppercase tracking-wide text-emerald-500/70 font-medium">Receive to lot</span>
                                {isFPWIP(lineItem) ? (
                                  <input value="assigned automatically" disabled className={`${cell} !w-40 opacity-60`} />
                                ) : (
                                  <input value={l.lotNo ?? ""} onChange={e => setLine(i, { lotNo: e.target.value })} placeholder="Lot / batch no." className={`${cell} !w-40`} />
                                )}
                                <span className="text-stone-600">expiry</span>
                                <input type="date" value={l.expiryDate ?? ""} onChange={e => setLine(i, { expiryDate: e.target.value })} className={`${cell} !w-40`} />
                                <span className="text-stone-600">— creates a FIFO cost lot for {lineItem?.name}</span>
                              </div>
                            </td>
                          </tr>
                        )}
                        </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="border-t border-stone-800/70 px-2 py-1.5">
                  <button onClick={() => setLines(ls => [...ls, emptyLine()])} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-stone-400 hover:text-emerald-400 px-2 py-1 rounded-md hover:bg-stone-800/60 transition">
                    <Plus size={13} /> Add line
                  </button>
                </div>
              </div>
            </Section>
          )}
          {cfg.mode === "deposit" && availablePayments.length > 0 && (
            <Section title="Swept payments (optional)">
              <p className="text-[11px] text-stone-500 -mt-1 mb-1">
                Link this deposit to payments it physically bundles — for traceability only, it doesn&rsquo;t change either posting.
              </p>
              <div className="rounded-xl border border-stone-800/80 bg-stone-900/40 max-h-48 overflow-y-auto divide-y divide-stone-800/50">
                {availablePayments.map(p => {
                  const checked = sweptPaymentIds.includes(p.id);
                  return (
                    <label key={p.id} className="flex items-center gap-2.5 px-3 py-2 text-[12.5px] hover:bg-stone-900/60 cursor-pointer">
                      <input type="checkbox" checked={checked}
                        onChange={() => setSweptPaymentIds(ids => checked ? ids.filter(x => x !== p.id) : [...ids, p.id])}
                        className="rounded border-stone-700 bg-stone-800 text-emerald-500 focus:ring-emerald-500/40" />
                      <span className="text-stone-300 font-medium">{p.docNumber}</span>
                      <span className="text-stone-600">{p.date}</span>
                      {p.party && <span className="text-stone-500">{p.party}</span>}
                      <span className="ml-auto tabular-nums text-stone-300">{money(p.amount)}</span>
                    </label>
                  );
                })}
              </div>
            </Section>
          )}
          {/* Memo + totals */}
          <div className="flex flex-wrap items-start justify-between gap-5 pt-1">
            <Field label="Memo" className="flex-1 min-w-[240px]">
              <input value={memo} onChange={e => setMemo(e.target.value)} placeholder="Internal note (optional)" className={input} />
            </Field>
            {(cfg.mode === "lineItems") && (
              <div className="w-64 rounded-xl border border-stone-800/80 bg-stone-900/40 p-4 text-[13px] space-y-2">
                <div className="flex justify-between text-stone-400"><span>Subtotal</span><span className="tabular-nums text-stone-200">{money(totals.net)}</span></div>
                {cfg.tax && <div className="flex justify-between text-stone-400"><span>Tax</span><span className="tabular-nums text-stone-200">{money(totals.tax)}</span></div>}
                <div className="flex justify-between items-baseline border-t border-stone-800 pt-2 mt-1"><span className="text-stone-300 font-medium">Total</span><span className="tabular-nums text-lg font-semibold text-white">{money(totals.total)} <span className="text-[12px] font-normal text-stone-500">{currency || home}</span></span></div>
              </div>
            )}
            {(cfg.mode === "deposit" || cfg.mode === "payment" || cfg.mode === "transfer") && (
              <div className="w-56 rounded-xl border border-stone-800/80 bg-stone-900/40 p-4 text-[13px]">
                <div className="flex justify-between items-baseline"><span className="text-stone-300 font-medium">Total</span><span className="tabular-nums text-lg font-semibold text-white">{money(totals.total)} <span className="text-[12px] font-normal text-stone-500">{currency || home}</span></span></div>
              </div>
            )}
          </div>

          </div>
        )}
        </div>

        {/* Footer */}
        {!loading && (
          <div className="flex items-center justify-end gap-3 px-6 py-3 border-t border-stone-800 bg-stone-900 shrink-0">
            <button onClick={close} className="text-[13px] text-stone-400 hover:text-stone-200 px-3 py-2">Cancel</button>
            <button onClick={submit} disabled={posting} className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-2">
              {posting ? <Loader size={14} className="animate-spin" /> : <Check size={15} />} {editId ? "Save changes" : cfg.submit}
            </button>
          </div>
        )}
      </div>

      {quickAdd && (
        <QuickAdd kind={quickAdd.kind} home={home} accounts={accounts} taxes={taxes}
          onClose={() => setQuickAdd(null)} onCreated={onQuickCreated} />
      )}
    </div>
  );
}
