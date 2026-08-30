"use client";

/**
 * Printable batch traceability & cost reconciliation report for one FIFO lot —
 * the formal, audit-style document (raw material procurement, subcontract
 * processing, cost rollup, outbound distribution, sign-off) rather than the
 * on-screen tree view. Follows the same print convention as
 * components/print-document.tsx (A4 sheet, accent-banded tables, "Print /
 * Save as PDF" via window.print()) so it looks like the rest of this app's
 * printed output, not a bolted-on one-off.
 */

import { Fragment } from "react";

const money = (n: number) => (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (n: number) => (Math.round((n ?? 0) * 1e4) / 1e4).toLocaleString();

function css(accent: string) {
  return `
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#eceded;color:#1b1f24;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    -webkit-font-smoothing:antialiased;font-size:12.5px;line-height:1.5}
  .sheet{width:297mm;min-height:210mm;margin:22px auto;background:#fff;padding:12mm 14mm;
    box-shadow:0 1px 2px rgba(0,0,0,.10),0 14px 38px rgba(0,0,0,.12);position:relative}
  .num{font-variant-numeric:tabular-nums}
  .muted{color:#6a707a}
  .cap{font-size:9px;letter-spacing:.11em;text-transform:uppercase;font-weight:700;color:#8a9099}

  .head{display:flex;justify-content:space-between;align-items:flex-start;gap:28px;border-bottom:2px solid ${accent};padding-bottom:10px}
  .logo{max-height:44px;max-width:180px;object-fit:contain;display:block;margin-bottom:6px}
  .co-name{font-size:14px;font-weight:700}
  .title{font-size:20px;font-weight:800;letter-spacing:.01em;color:${accent};text-align:right}
  .title-sub{margin-top:2px;font-size:10.5px;color:#6a707a;text-align:right;letter-spacing:.04em}

  .metabar{display:flex;flex-wrap:wrap;gap:0;margin-top:12px;border:1px solid #e3e5e8;border-radius:3px;overflow:hidden}
  .metabar .cell{flex:1;min-width:130px;padding:7px 12px;border-right:1px solid #e3e5e8}
  .metabar .cell:last-child{border-right:none}
  .metabar .cell:nth-child(even){background:#fafbfc}
  .metabar .v{font-size:13px;font-weight:700;margin-top:2px}
  .metabar .v.pass{color:#1a7f4b}

  .section{margin-top:18px}
  .section-title{font-size:11.5px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;color:${accent};
    display:flex;align-items:center;gap:7px;margin-bottom:6px}
  .section-title .n{width:18px;height:18px;border-radius:50%;background:${accent};color:#fff;font-size:10px;
    display:flex;align-items:center;justify-content:center;flex-shrink:0}

  table.rows{width:100%;border-collapse:collapse;font-size:11px}
  table.rows thead{display:table-header-group}
  table.rows th{background:${accent};color:#fff;font-size:8.5px;letter-spacing:.08em;text-transform:uppercase;
    font-weight:700;text-align:left;padding:6px 8px}
  table.rows td{padding:6px 8px;border-bottom:1px solid #eceef0;vertical-align:top}
  table.rows tbody tr:nth-child(even){background:#fafbfc}
  table.rows tr{break-inside:avoid;page-break-inside:avoid}
  table.rows tr.sub td{color:#6a707a;font-size:10.5px}
  th.r,td.r{text-align:right}
  .item{font-weight:600}
  .tag{font-size:9.5px;color:#8a9099}
  table.rows tfoot td{border-top:2px solid ${accent};font-weight:700;padding-top:7px}

  .empty{padding:10px 8px;color:#8a9099;font-size:11px;font-style:italic;border:1px dashed #e3e5e8;border-radius:3px}

  .sign{margin-top:26px;display:flex;gap:32px}
  .sigbox{flex:1}
  .sigline{border-top:1px solid #9aa0a8;padding-top:5px;font-size:10px;color:#6a707a}
  .signame{font-size:11.5px;font-weight:700;color:#1b1f24;margin-top:10px}

  .foot{margin-top:16px;padding-top:8px;border-top:1px solid #e3e5e8;font-size:9px;color:#8a9099;text-align:center}

  a.doclink{color:${accent};text-decoration:underline;font-weight:600}

  .bar{width:297mm;margin:18px auto -6px;display:flex;justify-content:flex-end;gap:8px}
  .btn{background:${accent};color:#fff;border:0;border-radius:5px;padding:9px 18px;font-size:12.5px;
    font-weight:600;cursor:pointer;font-family:inherit}
  .btn.g{background:#fff;color:#1b1f24;border:1px solid #d2d5d9}

  @media print{
    html,body{background:#fff}
    .sheet{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}
    .noprint{display:none!important}
    @page{size:A4 landscape;margin:10mm}
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  }
`;
}

function Doc({ href, children }: { href: string | null | undefined; children: React.ReactNode }) {
  if (!href) return <>{children}</>;
  return <a className="doclink" href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
}

export function LotTracePrintSheet({ data }: { data: any }) {
  const { lot, operator, rawMaterials, processing, costRollup, distribution, company } = data;
  const c = company ?? {};
  const accent = c.accent || "#1F3A5F";
  const totalCost = costRollup.find((r: any) => r.label.startsWith("Total"))?.amount ?? 0;
  const declaredValue = round2(lot.unitCost * lot.origQty);
  const reconciled = Math.abs(totalCost - declaredValue) < 0.01 || rawMaterials.length === 0;

  function round2(n: number) { return Math.round(n * 100) / 100; }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css(accent) }} />

      <div className="bar noprint">
        <button className="btn g" onClick={() => window.close()}>Close</button>
        <button className="btn" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>

      <div className="sheet">
        <div className="head">
          <div>
            {c.logoUrl ? <img className="logo" src={c.logoUrl} alt="" /> : null}
            <div className="co-name">{c.name ?? "Your Company"}</div>
          </div>
          <div>
            <div className="title">Batch Traceability &amp; Cost Reconciliation Report</div>
            <div className="title-sub">Finished SKU: {lot.itemName} ({lot.lotNo ?? lot.id.slice(0, 8)})</div>
          </div>
        </div>

        <div className="metabar">
          <div className="cell"><div className="cap">Lot / Batch</div><div className="v">{lot.lotNo ?? lot.id.slice(0, 8)}</div></div>
          <div className="cell"><div className="cap">Total Quantity</div><div className="v num">{qtyFmt(lot.origQty)}</div></div>
          <div className="cell"><div className="cap">Unit Cost</div><div className="v num">{money(lot.unitCost)}</div></div>
          <div className="cell"><div className="cap">Total Valuation</div><div className="v num">{money(declaredValue)}</div></div>
          <div className="cell"><div className="cap">Operator</div><div className="v">{operator ?? "—"}</div></div>
          <div className="cell"><div className="cap">Reconciliation</div><div className={`v${reconciled ? " pass" : ""}`}>{reconciled ? "PASSED" : "REVIEW"}</div></div>
        </div>

        {/* 1. Raw materials */}
        <div className="section">
          <div className="section-title"><span className="n">1</span> Raw Material Procurement &amp; Consumption</div>
          {rawMaterials.length === 0 ? <div className="empty">No purchased raw materials in this lot's ancestry — it may have been produced entirely from other manufactured/job-worked stock.</div> : (
            <table className="rows">
              <thead><tr>
                <th>Item</th><th className="r">Qty</th><th>UoM</th><th className="r">Rate</th><th className="r">Amount</th><th>Source / Reference</th>
              </tr></thead>
              <tbody>
                {rawMaterials.map((r: any, i: number) => (
                  <Fragment key={i}>
                    <tr>
                      <td className="item">{r.itemName} <span className="tag">Purchase</span></td>
                      <td className="r num">{qtyFmt(r.purchasedQty)}</td><td>{r.uom ?? ""}</td>
                      <td className="r num">{money(r.rate)}</td><td className="r num">{money(r.purchasedAmount)}</td>
                      <td>
                        {r.supplierLabel ?? "—"}
                        {r.poNumber ? <> (<Doc href={r.poId ? `/print/trade/purchase-orders/${r.poId}` : null}>{r.poNumber}</Doc>{r.receiptNo ? <> / <Doc href={r.receiptEntryId ? `/accounting/transactions/${r.receiptEntryId}` : null}>{r.receiptNo}</Doc></> : null})</> : r.receiptNo ? <> (<Doc href={r.receiptEntryId ? `/accounting/transactions/${r.receiptEntryId}` : null}>{r.receiptNo}</Doc>)</> : null}
                      </td>
                    </tr>
                    <tr className="sub">
                      <td>↳ Consumed</td>
                      <td className="r num">{qtyFmt(r.consumedQty)}</td><td>{r.uom ?? ""}</td>
                      <td className="r num">{money(r.rate)}</td><td className="r num">{money(r.consumedAmount)}</td>
                      <td>{r.issuedTo}</td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 2. Processing */}
        <div className="section">
          <div className="section-title"><span className="n">2</span> Subcontract Processing &amp; Internal Assembly</div>
          {processing.length === 0 ? <div className="empty">No processing steps recorded.</div> : (
            <table className="rows">
              <thead><tr>
                <th>Order ID</th><th>Activity / Process</th><th className="r">Qty</th><th>UoM</th><th className="r">Rate</th><th className="r">Amount</th><th>Provider</th><th>Date</th>
              </tr></thead>
              <tbody>
                {processing.map((p: any, i: number) => (
                  <tr key={i}>
                    <td className="item"><Doc href={p.entryId ? `/accounting/transactions/${p.entryId}` : null}>{p.orderId}</Doc></td><td>{p.activity}</td>
                    <td className="r num">{qtyFmt(p.qty)}</td><td>{p.uom ?? ""}</td>
                    <td className="r num">{money(p.rate)}</td><td className="r num">{money(p.amount)}</td>
                    <td>{p.provider}</td><td>{p.date ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 3. Cost rollup */}
        <div className="section">
          <div className="section-title"><span className="n">3</span> Cost Rollup Summary</div>
          <table className="rows">
            <thead><tr><th>Cost Element</th><th>Detail</th><th className="r">Amount</th><th className="r">Share</th></tr></thead>
            <tbody>
              {costRollup.map((r: any, i: number) => (
                <tr key={i} style={r.label.startsWith("Total") ? { fontWeight: 700, borderTop: `2px solid ${accent}` } : undefined}>
                  <td>{r.label}</td><td className="muted">{r.detail}</td>
                  <td className="r num">{money(r.amount)}</td><td className="r num">{r.sharePct.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 4. Distribution */}
        <div className="section">
          <div className="section-title"><span className="n">4</span> Outbound Commercial Distribution</div>
          {distribution.length === 0 ? <div className="empty">Not yet shipped/sold — still on hand or consumed internally only.</div> : (
            <table className="rows">
              <thead><tr>
                <th>Shipment</th><th>Invoice</th><th>Sold-To Customer</th><th className="r">Qty</th><th>UoM</th><th className="r">Unit Price</th><th className="r">Amount</th><th>Date</th>
              </tr></thead>
              <tbody>
                {distribution.map((d: any, i: number) => (
                  <tr key={i}>
                    <td className="item"><Doc href={d.shipmentEntryId ? `/accounting/transactions/${d.shipmentEntryId}` : null}>{d.shipmentNo ?? "—"}</Doc></td>
                    <td>{d.invoiceNo ? <Doc href={d.invoiceEntryId ? `/accounting/transactions/${d.invoiceEntryId}` : null}>{d.invoiceNo}</Doc> : "Not yet invoiced"}</td>
                    <td>{d.customerLabel ?? "—"}</td><td className="r num">{qtyFmt(d.qty)}</td><td>{d.uom ?? ""}</td>
                    <td className="r num">{money(d.unitPrice)}</td><td className="r num">{money(d.amount)}</td><td>{d.date ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="sign">
          <div className="sigbox"><div className="sigline">Prepared by</div><div className="signame">{operator ?? "—"}</div></div>
          <div className="sigbox"><div className="sigline">Reviewed by</div></div>
          <div className="sigbox"><div className="sigline">Approved by</div></div>
        </div>

        <div className="foot">Generated from {c.name ?? "the system"}'s inventory ledger — every figure traces back to a posted transaction. {new Date().toISOString().slice(0, 10)}</div>
      </div>
    </>
  );
}
