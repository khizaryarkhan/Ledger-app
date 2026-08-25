"use client";

/**
 * Printable Estimate / Purchase Order / Sales Order.
 *
 * These are the documents that leave the building — a PO goes to a supplier, a
 * quote goes to a customer — so unlike the ledger documents they need a clean
 * white sheet with the company's own branding. Same approach as
 * /print/invoice/[id]: plain inline styles (no app theme), auto-opens the
 * browser print dialog, and "Save as PDF" from there is the PDF path.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (n: number) => (Math.round(n * 1e4) / 1e4).toLocaleString();

const KIND_META: Record<string, { label: string; party: string; note: string }> = {
  Estimate:      { label: "QUOTE",          party: "For",       note: "Valid until" },
  PurchaseOrder: { label: "PURCHASE ORDER", party: "Supplier",  note: "Deliver by" },
  SalesOrder:    { label: "SALES ORDER",    party: "Customer",  note: "Required by" },
};

export default function PrintTradeDocPage() {
  const params = useParams();
  const id = String(params.id || "");
  const kind = String(params.kind || "");
  const [data, setData] = useState<any>(null);
  const [org, setOrg] = useState<any>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([
      fetch(`/api/trade-documents/${kind}/${id}/print`).then(r => r.json()).catch(() => null),
      fetch(`/api/org/settings`).then(r => r.json()).catch(() => null),
    ]).then(([d, o]) => {
      if (d?.doc) setData(d); else setErr(d?.error || "Document not found");
      setOrg(o);
    });
  }, [id, kind]);

  const doc = data?.doc;
  const lines: any[] = data?.lines ?? [];
  const meta = useMemo(() => KIND_META[doc?.kind] ?? { label: "DOCUMENT", party: "Party", note: "Valid until" }, [doc]);

  // Auto-open the print dialog once the sheet has rendered.
  useEffect(() => { if (doc && org) { const t = setTimeout(() => window.print(), 400); return () => clearTimeout(t); } }, [doc, org]);

  if (err) return <div style={{ padding: 40, fontFamily: "system-ui", color: "#111" }}>{err}</div>;
  if (!doc) return <div style={{ padding: 40, fontFamily: "system-ui", color: "#111" }}>Loading…</div>;

  const orgName = org?.displayName || org?.name || "Your Company";
  const currency = doc.currency || org?.currency || "";
  const showQtyCols = lines.some(l => l.qty > 0);

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
            <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: 1, color: "#0f766e" }}>{meta.label}</div>
            <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>{doc.docNumber}</div>
          </div>
        </div>

        {/* Meta */}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: "uppercase", color: "#888", letterSpacing: 1, marginBottom: 4 }}>{meta.party}</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{doc.partyLabel || "—"}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 13, color: "#333" }}>
            <div><span style={{ color: "#888" }}>Date: </span>{doc.issueDate}</div>
            {doc.expiryDate && <div><span style={{ color: "#888" }}>{meta.note}: </span>{doc.expiryDate}</div>}
          </div>
        </div>

        {/* Lines */}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f4f4f5", textAlign: "left" }}>
              <th style={{ padding: "10px 12px" }}>Item</th>
              {showQtyCols && <th style={{ padding: "10px 12px", textAlign: "right", width: 110 }}>Qty</th>}
              {showQtyCols && <th style={{ padding: "10px 12px", textAlign: "right", width: 110 }}>Rate</th>}
              <th style={{ padding: "10px 12px", textAlign: "right", width: 130 }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id ?? i} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "10px 12px" }}>
                  <div style={{ fontWeight: l.name ? 600 : 400 }}>{l.name || l.description || "—"}</div>
                  {l.name && l.description && l.description !== l.name && (
                    <div style={{ color: "#666", fontSize: 12, marginTop: 2 }}>{l.description}</div>
                  )}
                </td>
                {showQtyCols && (
                  <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {l.qty ? `${qtyFmt(l.qty)}${l.uom ? ` ${l.uom}` : ""}` : ""}
                  </td>
                )}
                {showQtyCols && (
                  <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {l.rate ? money(l.rate) : ""}
                  </td>
                )}
                <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
          <table style={{ fontSize: 13, minWidth: 260 }}>
            <tbody>
              <tr><td style={{ padding: "4px 12px", color: "#555" }}>Subtotal</td><td style={{ padding: "4px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(doc.subtotal)}</td></tr>
              {doc.taxTotal > 0 && <tr><td style={{ padding: "4px 12px", color: "#555" }}>Tax</td><td style={{ padding: "4px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(doc.taxTotal)}</td></tr>}
              <tr style={{ borderTop: "2px solid #111", fontWeight: 700, fontSize: 15 }}>
                <td style={{ padding: "8px 12px" }}>Total</td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(doc.total)} {currency}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {doc.memo && <div style={{ marginTop: 40, fontSize: 12, color: "#666", borderTop: "1px solid #eee", paddingTop: 12 }}>{doc.memo}</div>}
        <div style={{ marginTop: 24, fontSize: 11, color: "#aaa", textAlign: "center" }}>Generated by {orgName}</div>
      </div>
    </div>
  );
}
