"use client";

/**
 * Order Production Tracker — everything happening behind one Sales Order, in
 * one place: which Purchase Orders/Job Work/Manufacturing Orders are tagged
 * to it (Phase 1's salesOrderId links), their live status, and any open
 * delay alert (Phase 3). Existing per-document detail views aren't
 * duplicated here — each node links out to its own console.
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Loader, ShoppingCart, Factory, Workflow, Truck, AlertTriangle } from "lucide-react";

const money = (n: number) => (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Pill({ children, tone }: { children: React.ReactNode; tone: "gray" | "blue" | "amber" | "green" | "violet" }) {
  const cls = {
    gray:   "bg-stone-800 text-stone-400 border-stone-700",
    blue:   "bg-sky-500/10 text-sky-400 border-sky-800",
    amber:  "bg-amber-500/10 text-amber-400 border-amber-800",
    green:  "bg-emerald-500/12 text-emerald-400 border-emerald-800/50",
    violet: "bg-violet-500/10 text-violet-400 border-violet-800",
  }[tone];
  return <span className={`text-[11px] font-medium border rounded-full px-2 py-0.5 ${cls}`}>{children}</span>;
}

function moTone(status: string): "gray" | "blue" | "amber" | "green" | "violet" {
  if (status === "Completed") return "green";
  if (status === "InProgress") return "amber";
  if (status === "Released") return "violet";
  if (status === "Scheduled") return "blue";
  return "gray";
}
function jwTone(status: string): "gray" | "blue" | "amber" | "green" | "violet" {
  if (status === "Closed") return "green";
  if (status === "PartiallyReceived") return "amber";
  return "blue";
}
function poTone(status: string): "gray" | "blue" | "amber" | "green" | "violet" {
  if (status === "Closed" || status === "Converted") return "green";
  return "blue";
}

function AlertLine({ alert }: { alert: { message: string; severity: string } | null }) {
  if (!alert) return null;
  return (
    <div className={`mt-1 flex items-center gap-1.5 text-[11px] ${alert.severity === "critical" ? "text-rose-400" : "text-amber-400"}`}>
      <AlertTriangle size={11} /> {alert.message}
    </div>
  );
}

function Step({ icon: Icon, label, children }: { icon: any; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="w-8 h-8 rounded-full bg-stone-900 border border-stone-700 flex items-center justify-center shrink-0"><Icon size={14} className="text-stone-400" /></div>
        <div className="flex-1 w-px bg-stone-800 my-1" />
      </div>
      <div className="flex-1 min-w-0 pb-6">
        <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-1.5">{label}</div>
        {children}
      </div>
    </div>
  );
}

export default function OrderTrackerPage() {
  const id = String(useParams().id || "");
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`/api/inventory/orders/${id}/tracker`).then(r => r.json()).then(d => {
      if (d?.salesOrder) setData(d); else setErr(d?.error || "Not found");
    }).catch(() => setErr("Could not load this order"));
  }, [id]);

  if (err) return <div className="p-6 text-sm text-rose-400">{err}</div>;
  if (!data) return <div className="p-6 text-sm text-stone-500 inline-flex items-center gap-2"><Loader size={14} className="animate-spin" /> Loading…</div>;

  const { salesOrder: so, procurement, manufacturing, jobWork, shipments } = data;
  const openAlerts = [...procurement, ...manufacturing, ...jobWork].filter((s: any) => s.alert).length;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <button onClick={() => router.back()} className="inline-flex items-center gap-1 text-[13px] text-stone-500 hover:text-stone-200 mb-4"><ChevronLeft size={14} /> Back</button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-stone-100">{so.docNumber}</h1>
          <p className="text-sm text-stone-400 mt-0.5">{so.partyLabel} · {so.issueDate} · {money(so.total)}</p>
        </div>
        <div className="text-right">
          <Pill tone={so.status === "Closed" ? "green" : "blue"}>{so.status}</Pill>
          {openAlerts > 0 && (
            <div className="mt-1.5 text-[11px] text-rose-400 inline-flex items-center gap-1"><AlertTriangle size={11} /> {openAlerts} step{openAlerts !== 1 ? "s" : ""} at risk</div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-stone-800 bg-stone-900/40 p-5">
        <Step icon={ShoppingCart} label="Procurement">
          {procurement.length === 0 ? <p className="text-[12px] text-stone-600">No purchase orders linked to this order.</p> : (
            <div className="space-y-2">
              {procurement.map((p: any) => (
                <Link key={p.id} href="/accounting/trade/purchase-orders" className="block rounded-lg border border-stone-800 hover:border-stone-600 bg-stone-950/40 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[12px] text-stone-300">{p.docNumber}</span>
                    <Pill tone={poTone(p.status)}>{p.status}</Pill>
                  </div>
                  <div className="text-[11px] text-stone-500 mt-0.5">{money(p.total)}{p.expectedDate ? ` · expected ${p.expectedDate}` : ""}</div>
                  <AlertLine alert={p.alert} />
                </Link>
              ))}
            </div>
          )}
        </Step>

        <Step icon={Factory} label="Job Work">
          {jobWork.length === 0 ? <p className="text-[12px] text-stone-600">No job work orders linked to this order.</p> : (
            <div className="space-y-2">
              {jobWork.map((j: any) => (
                <Link key={j.id} href="/accounting/jobwork" className="block rounded-lg border border-stone-800 hover:border-stone-600 bg-stone-950/40 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[12px] text-stone-300">{j.docNumber}</span>
                    <Pill tone={jwTone(j.status)}>{j.status}</Pill>
                  </div>
                  <div className="text-[11px] text-stone-500 mt-0.5">{j.itemName ?? "—"} · {j.sentQty.toLocaleString()} · {j.vendorLabel ?? "—"}{j.expectedReturnDate ? ` · expected ${j.expectedReturnDate}` : ""}</div>
                  <AlertLine alert={j.alert} />
                </Link>
              ))}
            </div>
          )}
        </Step>

        <Step icon={Workflow} label="Production">
          {manufacturing.length === 0 ? <p className="text-[12px] text-stone-600">No manufacturing orders linked to this order.</p> : (
            <div className="space-y-2">
              {manufacturing.map((m: any) => (
                <Link key={m.id} href="/supply-chain" className="block rounded-lg border border-stone-800 hover:border-stone-600 bg-stone-950/40 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[12px] text-stone-300">{m.moNo}</span>
                    <Pill tone={moTone(m.status)}>{m.status}</Pill>
                  </div>
                  <div className="text-[11px] text-stone-500 mt-0.5">{m.itemName ?? "—"} · {m.qty.toLocaleString()}{m.dueDate ? ` · due ${m.dueDate}` : ""}</div>
                  <AlertLine alert={m.alert} />
                </Link>
              ))}
            </div>
          )}
        </Step>

        <Step icon={Truck} label="Shipment & invoicing">
          {shipments.length === 0 ? <p className="text-[12px] text-stone-600">Not shipped yet.</p> : (
            <div className="space-y-2">
              {shipments.map((s: any) => (
                <Link key={s.id} href="/supply-chain/shipping" className="block rounded-lg border border-stone-800 hover:border-stone-600 bg-stone-950/40 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[12px] text-stone-300">{s.shipmentNo}</span>
                    <Pill tone={s.status === "Posted" ? "green" : "gray"}>{s.status}</Pill>
                  </div>
                  <div className="text-[11px] text-stone-500 mt-0.5">{s.shipmentDate} · {money(s.invoicedAmount)} of {money(s.saleTotal)} invoiced</div>
                </Link>
              ))}
            </div>
          )}
        </Step>
      </div>
    </div>
  );
}
