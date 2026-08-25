"use client";

/**
 * The printed business document — one template for every outbound document
 * (Invoice, Bill, Credit note, Quote, Purchase Order, Sales Order).
 *
 * Design notes, because printed documents have different rules to screens:
 *  - Greyscale + a single near-black accent. A printed document sits next to
 *    the customer's own letterhead and gets photocopied and faxed; a colour
 *    theme fights their logo and turns to mud in mono. Restraint reads as
 *    expensive here.
 *  - A4 with 14mm margins, `thead` as a table-header-group so the column
 *    headers repeat on page 2, and rows that never split across a page break.
 *  - Tabular figures everywhere money appears, so columns align down the page.
 *  - Every block is conditional: a company with no tax number or no bank
 *    details simply doesn't render that block, rather than printing an empty
 *    label. The document should never look half-filled.
 */

import type { PrintDocument } from "@/lib/accounting/document-print";

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (n: number) => (Math.round(n * 1e4) / 1e4).toLocaleString();

const CSS = `
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#f1f1f0;color:#16181d;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    -webkit-font-smoothing:antialiased;font-size:13px;line-height:1.5}
  .sheet{width:210mm;min-height:297mm;margin:24px auto;background:#fff;padding:16mm 15mm;
    box-shadow:0 1px 3px rgba(0,0,0,.10),0 12px 32px rgba(0,0,0,.10)}
  .num{font-variant-numeric:tabular-nums}
  .muted{color:#6b7280}
  .label{font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;color:#8b8f98;font-weight:600}

  /* Masthead */
  .top{display:flex;justify-content:space-between;align-items:flex-start;gap:32px}
  .co-name{font-size:17px;font-weight:700;letter-spacing:-.01em;line-height:1.25}
  .co-meta{margin-top:7px;font-size:11.5px;color:#5b6069;line-height:1.65;white-space:pre-line}
  .doc-title{font-size:27px;font-weight:800;letter-spacing:.055em;line-height:1;text-align:right}
  .doc-no{margin-top:8px;font-size:13px;font-weight:600;text-align:right}
  .status{display:inline-block;margin-top:8px;font-size:9.5px;font-weight:700;letter-spacing:.08em;
    text-transform:uppercase;border:1px solid #16181d;border-radius:2px;padding:2px 7px}
  .rule{height:2px;background:#16181d;margin:16px 0 0}

  /* Party + meta */
  .parties{display:flex;justify-content:space-between;gap:36px;margin-top:22px}
  .party-name{font-size:14px;font-weight:700;margin-top:5px}
  .party-lines{margin-top:3px;font-size:11.5px;color:#5b6069;line-height:1.6;white-space:pre-line}
  .meta{min-width:210px}
  .meta-row{display:flex;justify-content:space-between;gap:20px;padding:3px 0;font-size:12px}
  .meta-row + .meta-row{border-top:1px solid #f0f0ef}

  /* Lines */
  table.lines{width:100%;border-collapse:collapse;margin-top:26px;font-size:12px}
  table.lines thead{display:table-header-group}
  table.lines th{font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;color:#6b7280;
    font-weight:700;text-align:left;padding:0 8px 7px;border-bottom:1.5px solid #16181d}
  table.lines td{padding:9px 8px;border-bottom:1px solid #ededec;vertical-align:top}
  table.lines tr{break-inside:avoid;page-break-inside:avoid}
  th.r,td.r{text-align:right}
  td.idx{color:#a1a5ad;font-size:11px;width:22px}
  .item{font-weight:600}
  .desc{color:#5b6069;font-size:11.5px;margin-top:2px}

  /* Totals */
  .foot{display:flex;justify-content:space-between;gap:36px;margin-top:20px;align-items:flex-start}
  .totals{min-width:268px;margin-left:auto}
  .t-row{display:flex;justify-content:space-between;gap:24px;padding:5px 0;font-size:12.5px}
  .t-sep{border-top:1px solid #e6e6e5}
  .t-grand{border-top:2px solid #16181d;margin-top:5px;padding-top:9px;font-size:15px;font-weight:800}
  .t-due{border-top:1px solid #e6e6e5;margin-top:3px;padding-top:7px;font-weight:700}
  .words{margin-top:16px;font-size:11.5px;line-height:1.6}

  /* Blocks */
  /* align-items:flex-start so each panel is only as tall as its own content —
     stretched-equal panels leave a dead white gap under the shorter one. */
  .blocks{margin-top:26px;display:flex;gap:26px;flex-wrap:wrap;align-items:flex-start}
  .block{flex:1;min-width:230px;border:1px solid #e6e6e5;border-radius:3px;padding:11px 13px}
  .block-body{margin-top:6px;font-size:11.5px;color:#3f444c;line-height:1.7;white-space:pre-line}
  .kv{display:flex;justify-content:space-between;gap:14px}
  .kv + .kv{margin-top:2px}

  .footer{margin-top:30px;padding-top:11px;border-top:1px solid #e6e6e5;
    font-size:10.5px;color:#8b8f98;text-align:center;line-height:1.7;white-space:pre-line}

  .toolbar{width:210mm;margin:20px auto -8px;display:flex;justify-content:flex-end;gap:8px}
  .btn{background:#16181d;color:#fff;border:0;border-radius:5px;padding:9px 17px;font-size:12.5px;
    font-weight:600;cursor:pointer;font-family:inherit}
  .btn.ghost{background:#fff;color:#16181d;border:1px solid #d6d6d4}

  @media print{
    html,body{background:#fff}
    .sheet{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}
    .noprint{display:none!important}
    @page{size:A4;margin:14mm}
  }
`;

export function PrintDocumentSheet({ data }: { data: PrintDocument }) {
  const { company, doc, party, lines, totals } = data;
  const c = company ?? ({} as any);

  const showQty = lines.some(l => l.qty != null);
  const showRate = lines.some(l => l.rate != null);
  const showTax = lines.some(l => l.taxPct != null);
  // Bank details answer "how do I pay you" — only meaningful on a document
  // where the other side owes us money.
  const showBank = !doc.isPurchase && doc.kind !== "SalesOrder"
    && !!(c.bank?.accountNumber || c.bank?.iban || c.bank?.name);
  const showBalance = totals.paid > 0.005;

  const companyMeta = [
    ...(c.addressLines ?? []),
    [c.phone, c.email].filter(Boolean).join("  ·  ") || null,
    c.website,
    c.taxNumber ? `Tax reg. ${c.taxNumber}` : null,
    c.registrationNumber ? `Reg. no. ${c.registrationNumber}` : null,
  ].filter(Boolean).join("\n");

  const partyMeta = [
    ...(party.addressLines ?? []),
    [party.phone, party.email].filter(Boolean).join("  ·  ") || null,
    party.taxNumber ? `Tax reg. ${party.taxNumber}` : null,
  ].filter(Boolean).join("\n");

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="toolbar noprint">
        <button className="btn ghost" onClick={() => window.close()}>Close</button>
        <button className="btn" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>

      <div className="sheet">
        {/* Masthead */}
        <div className="top">
          <div style={{ maxWidth: "58%" }}>
            {c.logoUrl ? (
              <img src={c.logoUrl} alt="" style={{ maxHeight: 52, maxWidth: 220, objectFit: "contain", marginBottom: 9 }} />
            ) : null}
            <div className="co-name">{c.name ?? "Your Company"}</div>
            {companyMeta && <div className="co-meta">{companyMeta}</div>}
          </div>
          <div>
            <div className="doc-title">{doc.label}</div>
            {doc.docNumber && <div className="doc-no">{doc.docNumber}</div>}
            {doc.status && doc.status !== "Posted" && <div style={{ textAlign: "right" }}><span className="status">{doc.status}</span></div>}
          </div>
        </div>
        <div className="rule" />

        {/* Counterparty + document meta */}
        <div className="parties">
          <div style={{ maxWidth: "55%" }}>
            <div className="label">{doc.partyHeading}</div>
            <div className="party-name">{party.name ?? "—"}</div>
            {partyMeta && <div className="party-lines">{partyMeta}</div>}
          </div>
          <div className="meta">
            <div className="meta-row"><span className="muted">Date</span><span className="num">{doc.date}</span></div>
            {doc.dueDate && <div className="meta-row"><span className="muted">{doc.dueLabel}</span><span className="num">{doc.dueDate}</span></div>}
            {doc.reference && <div className="meta-row"><span className="muted">Reference</span><span>{doc.reference}</span></div>}
            <div className="meta-row"><span className="muted">Currency</span><span>{doc.currency}</span></div>
          </div>
        </div>

        {/* Lines */}
        <table className="lines">
          <thead>
            <tr>
              <th style={{ width: 22 }}>#</th>
              <th>Description</th>
              {showQty && <th className="r" style={{ width: 96 }}>Qty</th>}
              {showRate && <th className="r" style={{ width: 96 }}>Unit price</th>}
              {showTax && <th className="r" style={{ width: 72 }}>Tax</th>}
              <th className="r" style={{ width: 108 }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="idx num">{i + 1}</td>
                <td>
                  <div className="item">{l.name || l.description || "—"}</div>
                  {l.name && l.description && l.description !== l.name && <div className="desc">{l.description}</div>}
                </td>
                {showQty && <td className="r num">{l.qty != null ? `${qtyFmt(l.qty)}${l.uom ? ` ${l.uom}` : ""}` : ""}</td>}
                {showRate && <td className="r num">{l.rate != null ? money(l.rate) : ""}</td>}
                {showTax && <td className="r num">{l.taxPct != null ? `${l.taxPct}%` : ""}</td>}
                <td className="r num">{money(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="foot">
          <div style={{ flex: 1, minWidth: 200 }} />
          <div className="totals">
            <div className="t-row"><span className="muted">Subtotal</span><span className="num">{money(totals.subtotal)}</span></div>
            {totals.taxes.map((t, i) => (
              <div className="t-row t-sep" key={i}><span className="muted">{t.label}</span><span className="num">{money(t.amount)}</span></div>
            ))}
            <div className="t-row t-grand"><span>Total</span><span className="num">{money(totals.total)} {doc.currency}</span></div>
            {showBalance && (
              <>
                <div className="t-row t-due"><span className="muted">Amount paid</span><span className="num">{money(totals.paid)}</span></div>
                <div className="t-row"><span style={{ fontWeight: 700 }}>Balance due</span><span className="num" style={{ fontWeight: 700 }}>{money(totals.balance)} {doc.currency}</span></div>
              </>
            )}
          </div>
        </div>

        <div className="words">
          <span className="label">Amount in words</span>
          <div style={{ marginTop: 3 }}>{totals.inWords}</div>
        </div>

        {/* Payment instructions / terms / notes */}
        {(showBank || c.terms || doc.memo) && (
          <div className="blocks">
            {showBank && (
              <div className="block">
                <div className="label">Payment details</div>
                <div className="block-body">
                  {c.bank.name && <div className="kv"><span className="muted">Bank</span><span>{c.bank.name}</span></div>}
                  {c.bank.branch && <div className="kv"><span className="muted">Branch</span><span>{c.bank.branch}</span></div>}
                  {c.bank.accountName && <div className="kv"><span className="muted">Account name</span><span>{c.bank.accountName}</span></div>}
                  {c.bank.accountNumber && <div className="kv"><span className="muted">Account no.</span><span className="num">{c.bank.accountNumber}</span></div>}
                  {c.bank.iban && <div className="kv"><span className="muted">IBAN</span><span className="num">{c.bank.iban}</span></div>}
                  {c.bank.swift && <div className="kv"><span className="muted">SWIFT/BIC</span><span className="num">{c.bank.swift}</span></div>}
                  {doc.docNumber && <div className="kv"><span className="muted">Payment ref.</span><span>{doc.docNumber}</span></div>}
                </div>
              </div>
            )}
            {(c.terms || doc.memo) && (
              <div className="block">
                <div className="label">{doc.memo ? "Notes" : "Terms & conditions"}</div>
                <div className="block-body">{[doc.memo, c.terms].filter(Boolean).join("\n\n")}</div>
              </div>
            )}
          </div>
        )}

        <div className="footer">
          {[c.footer,
            [c.name, c.registrationNumber ? `Reg. no. ${c.registrationNumber}` : null, c.taxNumber ? `Tax reg. ${c.taxNumber}` : null]
              .filter(Boolean).join("  ·  "),
          ].filter(Boolean).join("\n")}
        </div>
      </div>
    </>
  );
}
