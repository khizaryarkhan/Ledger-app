"use client";

/**
 * The printed business document — one template for every outbound document
 * (Invoice, Bill, Credit note, Quote, Purchase Order, Sales Order).
 *
 * Design follows commercial-invoice convention rather than an editorial look,
 * because these documents are read by an accounts-payable clerk who is
 * scanning for four things: who is this from, what is it for, how much, and
 * how do I pay it. So:
 *  - Brand accent (org-configurable) carries the document title, the table
 *    header fill and the balance-due block. Everything else is dark ink on
 *    white — two colours, high contrast, per invoice-design convention.
 *  - The table header is a solid accent band with white uppercase labels, and
 *    rows are zebra-striped, so a long line list stays readable.
 *  - BALANCE DUE is the single most prominent number after the title: reversed
 *    out of an accent block. Due date sits beside it.
 *  - Bill-to and ship-to sit side by side; on a purchase order "ship to" is our
 *    own address, which is exactly what the supplier needs.
 *  - Numbers are right-aligned and tabular; labels left-aligned.
 *  - A4, repeating table header on page 2+, rows that never split, and a
 *    signature block on documents that get authorised (PO, quote).
 */

import type { PrintDocument } from "@/lib/accounting/document-print";

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (n: number) => (Math.round(n * 1e4) / 1e4).toLocaleString();

/** Mix an accent colour toward white, for tints that stay in the same hue. */
function tint(hex: string, amount: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return "#f4f6f9";
  const [r, g, b] = [1, 2, 3].map(i => parseInt(m[i], 16));
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function css(accent: string) {
  const accentSoft = tint(accent, 0.92);
  const accentLine = tint(accent, 0.75);
  return `
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#eceded;color:#1b1f24;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    -webkit-font-smoothing:antialiased;font-size:13px;line-height:1.5}
  .sheet{width:210mm;min-height:297mm;margin:22px auto;background:#fff;padding:15mm 14mm 12mm;
    box-shadow:0 1px 2px rgba(0,0,0,.10),0 14px 38px rgba(0,0,0,.12);position:relative}
  .num{font-variant-numeric:tabular-nums}
  .muted{color:#6a707a}
  .cap{font-size:9px;letter-spacing:.11em;text-transform:uppercase;font-weight:700;color:#8a9099}

  /* ── Masthead ─────────────────────────────────────────────── */
  .head{display:flex;justify-content:space-between;align-items:flex-start;gap:28px}
  .logo{max-height:56px;max-width:210px;object-fit:contain;display:block;margin-bottom:9px}
  .co-name{font-size:16px;font-weight:700;letter-spacing:-.01em}
  .co-meta{margin-top:6px;font-size:11px;color:#5f656e;line-height:1.6;white-space:pre-line}
  .title{font-size:34px;font-weight:800;letter-spacing:.02em;line-height:.95;color:${accent};text-align:right}
  .title-sub{margin-top:6px;font-size:11px;color:#6a707a;text-align:right}

  /* Metadata card, top right under the title */
  .metacard{margin-top:12px;min-width:236px;border:1px solid ${accentLine};border-radius:3px;overflow:hidden}
  .metacard .r{display:flex;justify-content:space-between;gap:16px;padding:5px 10px;font-size:11.5px}
  .metacard .r:nth-child(odd){background:${accentSoft}}
  .metacard .r b{font-weight:600}

  /* ── Parties ──────────────────────────────────────────────── */
  .parties{display:flex;gap:14px;margin-top:22px}
  .pbox{flex:1;border:1px solid #e3e5e8;border-radius:3px;padding:9px 11px 10px;min-width:0}
  /* A lone party box stretched to full width reads as a half-empty panel —
     hold it to the same width it would have if paired. */
  .pbox:only-child{max-width:58%}
  .pbox .cap{color:${accent}}
  .pname{font-size:13.5px;font-weight:700;margin-top:4px}
  .plines{margin-top:2px;font-size:11px;color:#5f656e;line-height:1.55;white-space:pre-line}

  /* ── Lines ────────────────────────────────────────────────── */
  table.lines{width:100%;border-collapse:collapse;margin-top:20px;font-size:12px}
  table.lines thead{display:table-header-group}
  table.lines th{background:${accent};color:#fff;font-size:9px;letter-spacing:.1em;text-transform:uppercase;
    font-weight:700;text-align:left;padding:8px}
  table.lines td{padding:8px;border-bottom:1px solid #eceef0;vertical-align:top}
  table.lines tbody tr:nth-child(even){background:#fafbfc}
  table.lines tr{break-inside:avoid;page-break-inside:avoid}
  th.r,td.r{text-align:right}
  td.idx{color:#a5abb3;font-size:10.5px;width:24px}
  .item{font-weight:600}
  .desc{color:#5f656e;font-size:11px;margin-top:1px}

  /* ── Totals ───────────────────────────────────────────────── */
  .totwrap{display:flex;justify-content:space-between;gap:22px;margin-top:16px;align-items:flex-start}
  .totals{min-width:272px;margin-left:auto}
  .t{display:flex;justify-content:space-between;gap:22px;padding:5px 10px;font-size:12.5px}
  .t.alt{background:#fafbfc}
  .t.total{border-top:1.5px solid #1b1f24;font-weight:700;font-size:13.5px;padding-top:7px}
  .due{margin-top:8px;background:${accent};color:#fff;border-radius:3px;padding:10px 12px;
    display:flex;justify-content:space-between;align-items:center;gap:16px}
  .due .lab{font-size:9.5px;letter-spacing:.11em;text-transform:uppercase;font-weight:700;opacity:.85}
  .due .val{font-size:17px;font-weight:800}
  .words{flex:1;min-width:210px;padding-top:4px}
  .words .v{margin-top:3px;font-size:11.5px;line-height:1.55}

  /* ── Panels ───────────────────────────────────────────────── */
  /* Grid rather than wrapping flex, so a third panel sits half-width under the
     first two instead of stretching across the page. */
  .panels{margin-top:20px;display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
  .panel{border:1px solid #e3e5e8;border-radius:3px;padding:9px 11px 10px;min-width:0}
  .panel .cap{color:${accent}}
  .pbody{margin-top:5px;font-size:11px;color:#42474f;line-height:1.65;white-space:pre-line}
  .kv{display:flex;justify-content:space-between;gap:12px}
  .kv + .kv{margin-top:1px}

  .sign{margin-top:26px;display:flex;gap:40px}
  .sigline{flex:1;border-top:1px solid #9aa0a8;padding-top:5px;font-size:10.5px;color:#6a707a}

  .foot{margin-top:22px;padding-top:9px;border-top:2px solid ${accent};
    font-size:10px;color:#7c828b;text-align:center;line-height:1.6;white-space:pre-line}

  .bar{width:210mm;margin:18px auto -6px;display:flex;justify-content:flex-end;gap:8px}
  .btn{background:${accent};color:#fff;border:0;border-radius:5px;padding:9px 18px;font-size:12.5px;
    font-weight:600;cursor:pointer;font-family:inherit}
  .btn.g{background:#fff;color:#1b1f24;border:1px solid #d2d5d9}

  @media print{
    html,body{background:#fff}
    .sheet{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}
    .noprint{display:none!important}
    @page{size:A4;margin:13mm}
    /* Keep accent fills when printing — a table header that drops to white
       loses the column structure entirely. */
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  }
`;
}

export function PrintDocumentSheet({ data }: { data: PrintDocument }) {
  const { company, doc, party, lines, totals } = data;
  const c = company ?? ({} as any);
  const accent = c.accent || "#1F3A5F";

  const showQty = lines.some(l => l.qty != null);
  const showRate = lines.some(l => l.rate != null);
  const showTax = lines.some(l => l.taxPct != null);
  const showBank = !doc.isPurchase && doc.kind !== "SalesOrder"
    && !!(c.bank?.accountNumber || c.bank?.iban || c.bank?.name);
  const paidSomething = totals.paid > 0.005;
  // Orders and quotes state an order value, not money owed today.
  const isOrderDoc = doc.kind === "PurchaseOrder" || doc.kind === "SalesOrder" || doc.kind === "Estimate";

  const companyMeta = [
    ...(c.addressLines ?? []),
    [c.phone, c.email].filter(Boolean).join("  ·  ") || null,
    c.website,
  ].filter(Boolean).join("\n");

  const partyMeta = [
    ...(party.addressLines ?? []),
    [party.phone, party.email].filter(Boolean).join("  ·  ") || null,
    party.taxNumber ? `Tax reg. ${party.taxNumber}` : null,
  ].filter(Boolean).join("\n");

  // On a purchase order the supplier needs to know where to deliver — which is
  // our address, not theirs. On a sales document it's the customer's.
  const shipTo = doc.isPurchase
    ? { heading: "Ship to", name: c.name, meta: (c.addressLines ?? []).join("\n") }
    : null;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css(accent) }} />

      <div className="bar noprint">
        <button className="btn g" onClick={() => window.close()}>Close</button>
        <button className="btn" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>

      <div className="sheet">
        {/* Masthead */}
        <div className="head">
          <div style={{ maxWidth: "52%" }}>
            {c.logoUrl ? <img className="logo" src={c.logoUrl} alt="" /> : null}
            <div className="co-name">{c.name ?? "Your Company"}</div>
            {companyMeta && <div className="co-meta">{companyMeta}</div>}
            {(c.taxNumber || c.registrationNumber) && (
              <div className="co-meta" style={{ marginTop: 4 }}>
                {[c.taxNumber ? `Tax reg. ${c.taxNumber}` : null,
                  c.registrationNumber ? `Reg. no. ${c.registrationNumber}` : null].filter(Boolean).join("\n")}
              </div>
            )}
          </div>

          <div>
            <div className="title">{doc.label}</div>
            {doc.status && doc.status !== "Posted" && doc.status !== "Open" && (
              <div className="title-sub">{doc.status}</div>
            )}
            <div className="metacard">
              {doc.docNumber && <div className="r"><span className="muted">{doc.label === "INVOICE" ? "Invoice no." : "Document no."}</span><b>{doc.docNumber}</b></div>}
              <div className="r"><span className="muted">Date</span><b className="num">{doc.date}</b></div>
              {doc.dueDate && <div className="r"><span className="muted">{doc.dueLabel}</span><b className="num">{doc.dueDate}</b></div>}
              {doc.reference && <div className="r"><span className="muted">Reference</span><b>{doc.reference}</b></div>}
              <div className="r"><span className="muted">Currency</span><b>{doc.currency}</b></div>
            </div>
          </div>
        </div>

        {/* Parties */}
        <div className="parties">
          <div className="pbox">
            <div className="cap">{doc.partyHeading}</div>
            <div className="pname">{party.name ?? "—"}</div>
            {partyMeta && <div className="plines">{partyMeta}</div>}
          </div>
          {shipTo && (
            <div className="pbox">
              <div className="cap">{shipTo.heading}</div>
              <div className="pname">{shipTo.name}</div>
              {shipTo.meta && <div className="plines">{shipTo.meta}</div>}
            </div>
          )}
        </div>

        {/* Lines */}
        <table className="lines">
          <thead>
            <tr>
              <th style={{ width: 24 }}>#</th>
              <th>Description</th>
              {showQty && <th className="r" style={{ width: 92 }}>Qty</th>}
              {showRate && <th className="r" style={{ width: 92 }}>Unit price</th>}
              {showTax && <th className="r" style={{ width: 62 }}>Tax</th>}
              <th className="r" style={{ width: 104 }}>Amount</th>
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

        {/* Totals + amount in words */}
        <div className="totwrap">
          <div className="words">
            <div className="cap">Amount in words</div>
            <div className="v">{totals.inWords}</div>
          </div>
          <div className="totals">
            <div className="t alt"><span className="muted">Subtotal</span><span className="num">{money(totals.subtotal)}</span></div>
            {totals.taxes.map((t, i) => (
              <div className={`t${i % 2 ? " alt" : ""}`} key={i}><span className="muted">{t.label}</span><span className="num">{money(t.amount)}</span></div>
            ))}
            {/* The accent block below always carries the figure that matters.
                A plain "Total" row is only worth showing when something has
                been paid against it, otherwise it just prints the same number
                twice, one line apart. */}
            {paidSomething && (
              <>
                <div className="t total"><span>Total</span><span className="num">{money(totals.total)} {doc.currency}</span></div>
                <div className="t alt"><span className="muted">Amount paid</span><span className="num">−{money(totals.paid)}</span></div>
              </>
            )}
            <div className="due">
              <span className="lab">{isOrderDoc ? "Order total" : paidSomething ? "Balance due" : "Total due"}</span>
              <span className="val num">{money(paidSomething ? totals.balance : totals.total)} {doc.currency}</span>
            </div>
          </div>
        </div>

        {/* Payment details / terms / notes */}
        {(showBank || c.terms || doc.memo) && (
          <div className="panels">
            {showBank && (
              <div className="panel">
                <div className="cap">Payment details</div>
                <div className="pbody">
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
            {doc.memo && (
              <div className="panel">
                <div className="cap">Notes</div>
                <div className="pbody">{doc.memo}</div>
              </div>
            )}
            {c.terms && (
              <div className="panel">
                <div className="cap">Terms &amp; conditions</div>
                <div className="pbody">{c.terms}</div>
              </div>
            )}
          </div>
        )}

        {/* Authorisation — a PO or quote is acted on only once signed off. */}
        {doc.needsSignature && (
          <div className="sign">
            <div className="sigline">Authorised by — {c.name ?? ""}</div>
            <div className="sigline">Date</div>
          </div>
        )}

        <div className="foot">
          {[c.footer,
            [c.name, c.registrationNumber ? `Reg. no. ${c.registrationNumber}` : null,
             c.taxNumber ? `Tax reg. ${c.taxNumber}` : null, c.website].filter(Boolean).join("  ·  "),
          ].filter(Boolean).join("\n")}
        </div>
      </div>
    </>
  );
}
