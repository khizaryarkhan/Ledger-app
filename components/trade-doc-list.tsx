"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, RefreshCw, Check, FileText, ShoppingCart, ChevronDown, ChevronRight, Layers, X, Loader } from "lucide-react";

type Kind = "estimates" | "purchase-orders" | "sales-orders";
const META: Record<Kind, { title: string; singular: string; newType: string; icon: any; convertTo: string; invoiceVerb: string; fulfil?: string }> = {
  "estimates":       { title: "Estimates",       singular: "estimate",       newType: "Estimate",     icon: FileText,     convertTo: "invoice", invoiceVerb: "Invoice" },
  "purchase-orders": { title: "Purchase Orders", singular: "purchase order", newType: "PurchaseOrder", icon: ShoppingCart, convertTo: "bill",    invoiceVerb: "Bill" },
  // Sales Orders are fulfilled via Shipping (not converted directly), so the
  // convert action is hidden — see `canConvert` below.
  "sales-orders":    { title: "Sales Orders",    singular: "sales order",    newType: "SalesOrder",   icon: ShoppingCart, convertTo: "",        invoiceVerb: "", fulfil: "/accounting/shipping" },
};
const linkType = (k: Kind) => k === "estimates" ? "Estimate" : k === "purchase-orders" ? "PurchaseOrder" : "SalesOrder";

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function TradeDocList({ kind }: { kind: Kind }) {
  const meta = META[kind];
  const [rows, setRows] = useState<any[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, any[]>>({});
  const [modal, setModal] = useState<any | null>(null);

  async function load() {
    const r = await fetch(`/api/trade-documents/${kind}`).then(x => x.json()).catch(() => []);
    setRows(Array.isArray(r) ? r : []);
  }
  useEffect(() => { setRows(null); setMsg(""); setExpanded(null); setLinks({}); load(); }, [kind]);

  async function invoiceFull(id: string) {
    if (!confirm(`Create a ${meta.convertTo} for the full remaining amount?`)) return;
    setBusyId(id); setMsg("");
    try {
      const res = await fetch(`/api/trade-documents/${kind}/${id}/convert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Failed"); return; }
      setMsg(`Created ${meta.convertTo} ${d.docNumber ?? ""} · TXN-${String(d.txnNo ?? 0).padStart(6, "0")}${d.status === "Closed" ? " — fully invoiced." : ` — ${money(d.remainingNet)} still remaining.`}`);
      await load(); if (expanded === id) openLinks(id, true);
    } finally { setBusyId(null); }
  }

  async function openLinks(id: string, force = false) {
    if (!force && expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    const l = await fetch(`/api/transactions/links?type=${linkType(kind)}&id=${id}`).then(r => r.json()).catch(() => []);
    setLinks(m => ({ ...m, [id]: Array.isArray(l) ? l : [] }));
  }

  const Icon = meta.icon;
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-teal-500/15 flex items-center justify-center"><Icon size={18} className="text-teal-400" /></div>
          <h1 className="text-xl font-semibold text-stone-100">{meta.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={rows === null ? "animate-spin" : ""} /></button>
          <Link href={`/accounting/new/${meta.newType}`} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-2 hover:bg-emerald-700">
            <Plus size={14} /> New {meta.singular}
          </Link>
        </div>
      </div>

      {msg && <div className="mb-4 text-[12px] text-emerald-400 inline-flex items-center gap-1.5 bg-emerald-950/30 border border-emerald-900 rounded-lg px-3 py-2"><Check size={13} /> {msg}</div>}

      <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[760px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                <th className="w-6"></th>
                <th className="text-left px-3 py-2.5">Number</th>
                <th className="text-left px-3 py-2.5">{kind === "purchase-orders" ? "Supplier" : "Customer"}</th>
                <th className="text-left px-3 py-2.5">Date</th>
                <th className="text-right px-3 py-2.5">Total</th>
                <th className="text-left px-3 py-2.5 w-40">{meta.fulfil ? "Fulfilment" : `${meta.invoiceVerb}d`}</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {rows === null && <tr><td colSpan={7} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
              {rows !== null && rows.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-stone-500">No {meta.title.toLowerCase()} yet — create one with the New button.</td></tr>}
              {(rows ?? []).map(r => (
                <FragmentRow key={r.id}>
                  <tr className="border-b border-stone-800/60">
                    <td className="pl-3 py-2">
                      <button onClick={() => openLinks(r.id)} className="text-stone-600 hover:text-stone-300">{expanded === r.id ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
                    </td>
                    <td className="px-3 py-2 font-mono text-[12px] text-stone-300">{r.docNumber}</td>
                    <td className="px-3 py-2 text-stone-200">{r.partyLabel || "—"}</td>
                    <td className="px-3 py-2 text-stone-400">{r.issueDate}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-stone-200">{money(r.total)} {r.currency || ""}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-stone-800 overflow-hidden min-w-[60px]">
                          <div className={`h-full ${r.pct >= 100 ? "bg-emerald-500" : "bg-teal-500"}`} style={{ width: `${Math.min(100, r.pct)}%` }} />
                        </div>
                        <span className="text-[11px] text-stone-500 tabular-nums w-9 text-right">{r.pct}%</span>
                      </div>
                      {r.remainingNet > 0.005 && <div className="text-[10px] text-stone-600 mt-0.5">{money(r.remainingNet)} remaining</div>}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {meta.fulfil ? (
                        <Link href={meta.fulfil} className="text-[11px] font-medium text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1">Fulfil in Shipping →</Link>
                      ) : r.status !== "Closed" ? (
                        <div className="inline-flex items-center gap-2">
                          <button onClick={() => setModal(r)} disabled={busyId === r.id} className="text-[11px] font-medium text-teal-400 hover:text-teal-300 inline-flex items-center gap-1 disabled:opacity-50"><Layers size={12} /> Partial…</button>
                          <button onClick={() => invoiceFull(r.id)} disabled={busyId === r.id} className="text-[11px] font-medium bg-stone-800 hover:bg-stone-700 text-stone-200 rounded px-2 py-1 disabled:opacity-50">{meta.invoiceVerb} remaining</button>
                        </div>
                      ) : (
                        <span className="text-[10px] font-medium border rounded-full px-2 py-0.5 bg-emerald-500/12 text-emerald-400 border-emerald-800/50">Fully {meta.invoiceVerb.toLowerCase()}d</span>
                      )}
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr className="bg-stone-950/40 border-b border-stone-800/60">
                      <td></td>
                      <td colSpan={6} className="px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wider text-stone-600 mb-1">Related transactions</div>
                        {!links[r.id] ? <div className="text-[12px] text-stone-500 inline-flex items-center gap-1"><Loader size={11} className="animate-spin" /> Loading…</div>
                          : links[r.id].length === 0 ? <div className="text-[12px] text-stone-600">No linked documents yet.</div>
                          : (
                            <div className="space-y-1">
                              {links[r.id].map((lk, i) => (
                                <div key={i} className="flex items-center gap-3 text-[12px]">
                                  <span className="text-stone-500 w-24">{lk.relation === "progress_invoice" ? "Invoiced" : lk.relation === "po_bill" ? "Billed" : lk.relation}</span>
                                  <span className="font-mono text-stone-300">{lk.docNumber}</span>
                                  <span className="text-stone-500">{lk.type}</span>
                                  <span className="text-stone-400">{lk.date}</span>
                                  <span className="tabular-nums text-stone-300 ml-auto">{money(lk.linkedAmount)}</span>
                                  <Link href="/accounting/journal" className="text-teal-400 hover:text-teal-300">view</Link>
                                </div>
                              ))}
                            </div>
                          )}
                      </td>
                    </tr>
                  )}
                </FragmentRow>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && <ProgressModal kind={kind} meta={meta} doc={modal} onClose={() => setModal(null)} onDone={(m) => { setModal(null); setMsg(m); load(); if (expanded === modal.id) openLinks(modal.id, true); }} />}
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) { return <>{children}</>; }

function ProgressModal({ kind, meta, doc, onClose, onDone }: any) {
  const [lines, setLines] = useState<any[] | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [pct, setPct] = useState("100");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`/api/trade-documents/${kind}/${doc.id}/lines`).then(r => r.json()).then((ls: any[]) => {
      setLines(ls);
      const init: Record<string, string> = {};
      ls.forEach(l => { init[l.id] = l.remaining > 0 ? String(l.remaining) : "0"; });
      setAmounts(init);
    }).catch(() => setLines([]));
  }, [kind, doc.id]);

  function applyPct(p: string) {
    setPct(p);
    const f = Math.max(0, Math.min(100, Number(p) || 0)) / 100;
    const next: Record<string, string> = {};
    (lines ?? []).forEach(l => { next[l.id] = (Math.round(l.remaining * f * 100) / 100).toString(); });
    setAmounts(next);
  }

  const total = (lines ?? []).reduce((s, l) => s + (Number(amounts[l.id]) || 0), 0);

  async function submit() {
    setBusy(true); setErr("");
    try {
      const payload = { lines: (lines ?? []).map(l => ({ lineId: l.id, amount: Number(amounts[l.id]) || 0 })).filter(x => x.amount > 0) };
      if (payload.lines.length === 0) { setErr("Enter an amount to invoice."); return; }
      const res = await fetch(`/api/trade-documents/${kind}/${doc.id}/convert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || "Failed"); return; }
      onDone(`Created ${meta.convertTo} ${d.docNumber ?? ""} · TXN-${String(d.txnNo ?? 0).padStart(6, "0")}${d.status === "Closed" ? " — fully invoiced." : ` — ${money(d.remainingNet)} still remaining.`}`);
    } finally { setBusy(false); }
  }

  const input = "bg-stone-950 border border-stone-700 rounded-lg px-2.5 py-1.5 text-sm text-stone-100 text-right tabular-nums";
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-stone-900 border border-stone-700 rounded-2xl w-full max-w-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-stone-800">
          <div>
            <h2 className="text-base font-semibold text-white">{meta.invoiceVerb} {doc.docNumber}</h2>
            <p className="text-[12px] text-stone-500">Choose how much of each line to {meta.convertTo === "invoice" ? "invoice" : "bill"} now — the rest stays open for later.</p>
          </div>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-300"><X size={18} /></button>
        </div>
        <div className="p-5">
          {err && <div className="mb-3 text-[12px] text-rose-400">{err}</div>}
          <div className="flex items-center gap-2 mb-3 text-[12px] text-stone-400">
            Quick fill:
            <input type="number" min="0" max="100" value={pct} onChange={e => applyPct(e.target.value)} className="bg-stone-950 border border-stone-700 rounded px-2 py-1 w-16 text-right" />% of remaining
            <button onClick={() => applyPct("100")} className="text-teal-400 hover:text-teal-300 ml-1">all</button>
          </div>
          {!lines ? <div className="text-[12px] text-stone-500 inline-flex items-center gap-1"><Loader size={12} className="animate-spin" /> Loading…</div> : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                  <th className="text-left py-2">Line</th>
                  <th className="text-right py-2 w-28">Remaining</th>
                  <th className="text-right py-2 w-32">{meta.invoiceVerb} now</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(l => (
                  <tr key={l.id} className="border-b border-stone-800/50">
                    <td className="py-2 text-stone-200">{l.description || <span className="text-stone-600">(no description)</span>}</td>
                    <td className="py-2 text-right tabular-nums text-stone-400">{money(l.remaining)}</td>
                    <td className="py-2 text-right"><input type="number" step="0.01" min="0" max={l.remaining} value={amounts[l.id] ?? ""} onChange={e => setAmounts(a => ({ ...a, [l.id]: e.target.value }))} className={`${input} w-28`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="flex items-center justify-between mt-4">
            <div className="text-[13px] text-stone-300">This {meta.convertTo}: <span className="font-semibold text-white tabular-nums">{money(total)}</span> <span className="text-stone-600 text-[11px]">(before tax)</span></div>
            <div className="flex items-center gap-3">
              <button onClick={onClose} className="text-[13px] text-stone-500 hover:text-stone-300">Cancel</button>
              <button onClick={submit} disabled={busy} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-2">
                {busy ? <Loader size={14} className="animate-spin" /> : <Check size={15} />} Create {meta.convertTo}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
