"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, Badge } from "@/components/ui";
import { fmt } from "@/lib/format";
import { Receipt, CreditCard, FileMinus, FileX, ArrowDownLeft, ArrowUpRight, BookOpen, Landmark, WalletCards, Send, ClipboardList } from "lucide-react";

type Txn = {
  id: string;
  refId: string;
  txnDate: string;
  type: "Invoice" | "Credit Memo" | "Payment" | "Refund Receipt" | "Journal Entry" | "Deposit" | "Cheque Expense" | "Estimate";
  number: string | null;
  amount: number;
  balance: number;
  currency: string;
  status: string;
  memo: string | null;
  meta?: Record<string, any>;
};

const TYPE_FILTERS: Array<{ id: string; label: string }> = [
  { id: "all", label: "All transactions" },
  { id: "Invoice", label: "Invoices" },
  { id: "Credit Memo", label: "Credit Memos" },
  { id: "Payment", label: "Payments" },
  { id: "Refund Receipt", label: "Refund Receipts" },
  { id: "Journal Entry", label: "Journal Entries" },
  { id: "Deposit", label: "Deposits" },
  { id: "Cheque Expense", label: "Cheque Expenses" },
  { id: "Estimate", label: "Estimates" },
];

const DATE_FILTERS: Array<{ id: string; label: string }> = [
  { id: "all", label: "All time" },
  { id: "this-year", label: "This year" },
  { id: "last-12", label: "Last 12 months" },
  { id: "last-90", label: "Last 90 days" },
  { id: "last-30", label: "Last 30 days" },
];

function typeIcon(type: string) {
  switch (type) {
    case "Invoice":         return <Receipt size={13} className="text-stone-400" />;
    case "Credit Memo":     return <FileMinus size={13} className="text-amber-400" />;
    case "Payment":         return <ArrowDownLeft size={13} className="text-emerald-400" />;
    case "Refund Receipt":  return <ArrowUpRight size={13} className="text-rose-400" />;
    case "Journal Entry":   return <BookOpen size={13} className="text-stone-400" />;
    case "Deposit":         return <Landmark size={13} className="text-sky-400" />;
    case "Cheque Expense":  return <WalletCards size={13} className="text-violet-400" />;
    case "Estimate":        return <ClipboardList size={13} className="text-sky-400" />;
    default:                return <FileX size={13} className="text-stone-500" />;
  }
}

function statusBadge(status: string) {
  const map: Record<string, { variant: any; label: string }> = {
    "Paid":              { variant: "green",  label: "Paid" },
    "Partially Paid":    { variant: "amber",  label: "Partially Paid" },
    "Unpaid":            { variant: "neutral",label: "Unpaid" },
    "Voided":            { variant: "neutral",label: "Voided" },
    "Closed":            { variant: "green",  label: "Closed" },
    "Applied":           { variant: "green",  label: "Applied" },
    "Partially Applied": { variant: "amber",  label: "Partially Applied" },
    "Posted":            { variant: "neutral",label: "Posted" },
    "Pending":           { variant: "amber",  label: "Pending" },
    "Accepted":          { variant: "green",  label: "Accepted" },
    "Rejected":          { variant: "red",    label: "Rejected" },
  };
  const cfg = map[status] || { variant: "neutral", label: status };
  return <Badge variant={cfg.variant} size="sm">{cfg.label}</Badge>;
}

function withinDateRange(dateStr: string, range: string): boolean {
  if (range === "all") return true;
  const d = new Date(dateStr + "T00:00:00Z").getTime();
  const now = Date.now();
  if (range === "this-year") {
    const y = new Date(now).getUTCFullYear();
    return new Date(dateStr).getUTCFullYear() === y;
  }
  const ms = range === "last-12" ? 365*86400000
           : range === "last-90" ? 90*86400000
           : range === "last-30" ? 30*86400000 : 0;
  return d >= now - ms;
}

export function TransactionsTab({
  fetchUrl,
  scope,
  onSendSelected,
}: {
  fetchUrl: string;
  scope: "customer" | "project";
  onSendSelected?: (refIds: string[]) => void;
}) {
  const [rows, setRows] = useState<Txn[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    fetch(fetchUrl)
      .then(r => r.ok ? r.json() : { rows: [], counts: {} })
      .then(data => {
        setRows(data.rows || []);
        setCounts(data.counts || {});
      })
      .finally(() => setLoading(false));
  }, [fetchUrl]);

  const filtered = useMemo(() => rows.filter(r => {
    if (typeFilter !== "all" && r.type !== typeFilter) return false;
    if (!withinDateRange(r.txnDate, dateFilter)) return false;
    return true;
  }), [rows, typeFilter, dateFilter]);

  // Running totals for the visible set.
  // Every row's signed amount feeds the running net so JEs and Deposits are
  // included — those types weren't being summed before and made the Net
  // footer disagree with the customer's actual AR position.
  const totals = useMemo(() => {
    let arIncrease = 0, arDecrease = 0, openBalance = 0;
    for (const r of filtered) {
      const a = r.amount;
      if (a > 0) arIncrease += a;
      else       arDecrease += Math.abs(a);
      if (r.type === "Invoice") openBalance += r.balance;
    }
    return { arIncrease, arDecrease, net: arIncrease - arDecrease, openBalance };
  }, [filtered]);

  // Invoice rows that are selectable (open/unpaid invoices only)
  const selectableRefIds = useMemo(
    () => filtered.filter(r => r.type === "Invoice" && r.balance > 0.005).map(r => r.refId),
    [filtered]
  );
  const allSelected = selectableRefIds.length > 0 && selectableRefIds.every(id => selected.has(id));
  const someSelected = selectableRefIds.some(id => selected.has(id));

  function toggleRow(refId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(refId) ? next.delete(refId) : next.add(refId);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(prev => { const next = new Set(prev); selectableRefIds.forEach(id => next.delete(id)); return next; });
    } else {
      setSelected(prev => new Set([...prev, ...selectableRefIds]));
    }
  }

  const selectedIds = [...selected].filter(id => selectableRefIds.includes(id));
  const hasSelection = selectedIds.length > 0;

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <Card padding="sm">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Type</label>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
              className="h-8 px-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-200 focus:border-emerald-500 focus:outline-none">
              {TYPE_FILTERS.map(f => {
                const n = f.id === "all" ? (counts.total ?? 0) : (counts[f.id] ?? 0);
                if (scope === "project" && f.id === "Refund Receipt") return null;
                return <option key={f.id} value={f.id}>{f.label} {n > 0 ? `(${n})` : ""}</option>;
              })}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Date</label>
            <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}
              className="h-8 px-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-200 focus:border-emerald-500 focus:outline-none">
              {DATE_FILTERS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>

          {/* Send selected action */}
          {hasSelection && onSendSelected && (
            <button
              onClick={() => onSendSelected(selectedIds)}
              className="flex items-center gap-2 h-8 px-3 text-sm font-medium rounded-md bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
            >
              <Send size={13} />
              Send {selectedIds.length} invoice{selectedIds.length !== 1 ? "s" : ""}
            </button>
          )}

          {/* Net change in visible set */}
          {filtered.length > 0 && (
            <div className="ml-auto flex items-center gap-4 text-[11px]">
              <div>
                <div className="text-stone-500 uppercase tracking-wider mb-0.5">Billed</div>
                <div className="text-stone-300 tabular-nums">{fmt.money(totals.arIncrease, filtered[0]?.currency || "EUR")}</div>
              </div>
              <div>
                <div className="text-stone-500 uppercase tracking-wider mb-0.5">Received</div>
                <div className="text-stone-300 tabular-nums">{fmt.money(totals.arDecrease, filtered[0]?.currency || "EUR")}</div>
              </div>
              <div>
                <div className="text-stone-500 uppercase tracking-wider mb-0.5">Open AR</div>
                <div className="font-semibold tabular-nums text-rose-400">{fmt.money(totals.openBalance, filtered[0]?.currency || "EUR")}</div>
              </div>
              <div>
                <div className="text-stone-500 uppercase tracking-wider mb-0.5">Net</div>
                <div className="font-semibold tabular-nums text-stone-100">{fmt.money(totals.net, filtered[0]?.currency || "EUR")}</div>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Table */}
      <Card padding="none">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
              {onSendSelected && (
                <th className="px-3 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={toggleAll}
                    className="rounded border-stone-600 bg-stone-800 text-emerald-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                    title="Select all open invoices"
                  />
                </th>
              )}
              <th className="text-left font-semibold px-4 py-3 w-28">Date</th>
              <th className="text-left font-semibold px-4 py-3 w-40">Type</th>
              <th className="text-left font-semibold px-4 py-3 w-28">Number</th>
              <th className="text-left font-semibold px-4 py-3">Memo</th>
              <th className="text-right font-semibold px-4 py-3 w-28">Total</th>
              <th className="text-right font-semibold px-4 py-3 w-28">Balance</th>
              <th className="text-left font-semibold px-4 py-3 w-28">Status</th>
              <th className="text-right font-semibold px-4 py-3 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={onSendSelected ? 9 : 8} className="px-4 py-8 text-center text-stone-500 text-sm">Loading…</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={onSendSelected ? 9 : 8} className="px-4 py-8 text-center text-stone-500 text-sm">No transactions found for this filter.</td></tr>
            )}
            {filtered.map(r => {
              const showBalance = r.balance > 0.005;
              const isSelectable = onSendSelected && r.type === "Invoice" && showBalance;
              const isSelected = selected.has(r.refId);
              return (
                <tr
                  key={r.id}
                  onClick={isSelectable ? () => toggleRow(r.refId) : undefined}
                  className={`border-b border-stone-800/60 transition-colors ${
                    isSelectable ? "cursor-pointer" : ""
                  } ${isSelected ? "bg-emerald-900/20 hover:bg-emerald-900/30" : "hover:bg-stone-800/40"}`}
                >
                  {onSendSelected && (
                    <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                      {isSelectable && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(r.refId)}
                          className="rounded border-stone-600 bg-stone-800 text-emerald-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                        />
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3 text-stone-300 tabular-nums text-[12px]">
                    {new Date(r.txnDate + "T00:00:00Z").toLocaleDateString("en-IE", { day: "2-digit", month: "short", year: "numeric" })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {typeIcon(r.type)}
                      <span className="text-stone-200">{r.type}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-stone-400 tabular-nums text-[12px]">{r.number || "—"}</td>
                  <td className="px-4 py-3 text-stone-500 text-[12px] truncate max-w-[300px]">{r.memo || ""}</td>
                  <td className={`px-4 py-3 text-right tabular-nums font-medium ${r.amount < 0 ? "text-amber-400" : "text-stone-100"}`}>
                    {fmt.money(r.amount, r.currency)}
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums font-semibold ${
                    showBalance
                      ? (r.type === "Invoice" ? "text-rose-400" : "text-amber-400")
                      : "text-stone-600"
                  }`}>
                    {showBalance ? fmt.money(r.balance, r.currency) : "—"}
                  </td>
                  <td className="px-4 py-3">{statusBadge(r.status)}</td>
                  <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                    {(r.type === "Invoice" || r.type === "Credit Memo") && (
                      <Link href={`/invoices/${r.refId}`} className="text-[12px] text-emerald-400 hover:text-emerald-300 font-medium">
                        View
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && filtered.length > 0 && (
          <div className="px-4 py-2 border-t border-stone-800 text-[11px] text-stone-500 flex items-center justify-between">
            <span>
              {hasSelection ? `${selectedIds.length} invoice${selectedIds.length !== 1 ? "s" : ""} selected · ` : ""}
              Showing {filtered.length} of {rows.length} transactions
            </span>
            <span className="text-stone-600">Balance shown for unpaid invoices and partially-applied credits/payments only</span>
          </div>
        )}
      </Card>
    </div>
  );
}
