"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PrintInvoicePage() {
  const id = String(useParams().id || "");
  const [tx, setTx] = useState<any>(null);
  const [org, setOrg] = useState<any>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/ledger/journal/${id}`).then(r => r.json()).catch(() => null),
      fetch(`/api/org/settings`).then(r => r.json()).catch(() => null),
    ]).then(([t, o]) => { setTx(t); setOrg(o); });
  }, [id]);

  const e = tx?.entry;
  const { items, tax, subtotal, total, currency, customer } = useMemo(() => {
    const lines: any[] = tx?.lines ?? [];
    const isCtrl = (l: any) => l.accountType === "Accounts Receivable" || l.accountType === "Accounts Payable";
    const isTax = (l: any) => l.accountSubtype === "SalesTaxPayable";
    const isBank = (l: any) => l.accountType === "Bank" || l.accountType === "Credit Card";
    const itemLines = lines.filter(l => !isCtrl(l) && !isTax(l) && !isBank(l)).map(l => ({
      desc: l.description || l.accountName, amount: (l.credit || l.debit || 0),
    }));
    const taxLine = lines.find(isTax);
    const sub = Math.round(itemLines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
    const taxAmt = taxLine ? (taxLine.credit || taxLine.debit || 0) : 0;
    const cust = lines.find(l => l.name)?.name ?? "—";
    return { items: itemLines, tax: taxAmt, subtotal: sub, total: tx?.total ?? sub + taxAmt, currency: lines.find(l => l.currency)?.currency || org?.currency || "", customer: cust };
  }, [tx, org]);

  // Auto-open the print dialog once loaded.
  useEffect(() => { if (e && org) { const t = setTimeout(() => window.print(), 400); return () => clearTimeout(t); } }, [e, org]);

  if (!e) return <div style={{ padding: 40, fontFamily: "system-ui", color: "#111" }}>Loading…</div>;
  const orgName = org?.displayName || org?.name || "Your Company";
  const docLabel = e.sourceType === "CreditNote" ? "CREDIT NOTE" : e.sourceType === "SalesReceipt" ? "SALES RECEIPT" : e.sourceType === "RefundReceipt" ? "REFUND" : "INVOICE";

  return (
    <div style={{ background: "#fff", color: "#111", minHeight: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <style>{`@media print { .noprint { display:none !important; } @page { margin: 16mm; } } body { background:#fff; }`}</style>

      <div style={{ maxWidth: 800, margin: "0 auto", padding: "32px 40px" }}>
        <div className="noprint" style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 16 }}>
          <button onClick={() => window.print()} style={{ background: "#0f766e", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>Print / Save PDF</button>
        </div>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #0f766e", paddingBottom: 20, marginBottom: 24 }}>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            {org?.logoUrl ? <img src={org.logoUrl} alt="" style={{ height: 48, objectFit: "contain" }} /> : null}
            <div style={{ fontSize: 20, fontWeight: 700 }}>{orgName}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: 1, color: "#0f766e" }}>{docLabel}</div>
            <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>{e.docNumber}</div>
          </div>
        </div>

        {/* Meta */}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: "uppercase", color: "#888", letterSpacing: 1, marginBottom: 4 }}>Bill to</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{customer}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 13, color: "#333" }}>
            <div><span style={{ color: "#888" }}>Date: </span>{e.entryDate}</div>
            {e.dueDate && <div><span style={{ color: "#888" }}>Due: </span>{e.dueDate}</div>}
            {e.reference && <div><span style={{ color: "#888" }}>Ref: </span>{e.reference}</div>}
          </div>
        </div>

        {/* Lines */}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f4f4f5", textAlign: "left" }}>
              <th style={{ padding: "10px 12px" }}>Description</th>
              <th style={{ padding: "10px 12px", textAlign: "right", width: 140 }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((l, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "10px 12px" }}>{l.desc}</td>
                <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
          <table style={{ fontSize: 13, minWidth: 260 }}>
            <tbody>
              <tr><td style={{ padding: "4px 12px", color: "#555" }}>Subtotal</td><td style={{ padding: "4px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(subtotal)}</td></tr>
              {tax > 0 && <tr><td style={{ padding: "4px 12px", color: "#555" }}>Tax</td><td style={{ padding: "4px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(tax)}</td></tr>}
              <tr style={{ borderTop: "2px solid #111", fontWeight: 700, fontSize: 15 }}>
                <td style={{ padding: "8px 12px" }}>Total</td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(total)} {currency}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {e.memo && <div style={{ marginTop: 40, fontSize: 12, color: "#666", borderTop: "1px solid #eee", paddingTop: 12 }}>{e.memo}</div>}
        <div style={{ marginTop: 24, fontSize: 11, color: "#aaa", textAlign: "center" }}>Generated by {orgName}</div>
      </div>
    </div>
  );
}
