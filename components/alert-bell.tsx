"use client";

/**
 * Header alert bell — a lightweight "N things need attention" surface for
 * supply-chain delays (Job Work / PO / MO past their expected date, per
 * inngest/functions/chase.ts's supplyChainWatchdog). Polls the same list the
 * Delivery Risk report and the Order Production Tracker's badges read.
 * Intentionally minimal: no per-user read state or preferences — that's
 * future scope, this is just "here's what's at risk right now."
 */

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Bell, AlertTriangle } from "lucide-react";
import { useData } from "./data-provider";

const SOURCE_LABEL: Record<string, string> = { jobwork: "Job Work", po: "Purchase Order", mo: "Manufacturing Order" };
const POLL_MS = 5 * 60 * 1000;

export function AlertBell() {
  const { orgSettings } = useData();
  const manufacturingEnabled = Array.isArray(orgSettings?.enabledModules) && orgSettings.enabledModules.includes("manufacturing");
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<any[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!manufacturingEnabled) return;
    let cancelled = false;
    const load = () => fetch("/api/inventory/alerts").then(r => r.json()).then(d => {
      if (!cancelled) setAlerts(Array.isArray(d?.alerts) ? d.alerts : []);
    }).catch(() => {});
    load();
    const t = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [manufacturingEnabled]);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  if (!manufacturingEnabled) return null;

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} title="Supply-chain alerts"
        className="relative p-1.5 rounded-md hover:bg-stone-800 text-stone-500 hover:text-stone-200 transition-colors">
        <Bell size={16} />
        {alerts.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-[3px] rounded-full bg-rose-500 text-white text-[9px] font-semibold flex items-center justify-center leading-none">
            {alerts.length > 9 ? "9+" : alerts.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 bg-stone-900 border border-stone-700 rounded-xl shadow-2xl shadow-black/50 py-1.5 w-80 max-h-96 overflow-y-auto">
          <div className="px-3 pb-1.5 text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Supply-chain alerts</div>
          {alerts.length === 0 ? (
            <div className="px-3 py-4 text-[12px] text-stone-500">Nothing at risk right now.</div>
          ) : (
            <>
              {alerts.slice(0, 8).map((a: any) => (
                <div key={a.id} className="flex items-start gap-2 px-3 py-2 hover:bg-stone-800">
                  <AlertTriangle size={13} className={`mt-0.5 shrink-0 ${a.severity === "critical" ? "text-rose-400" : "text-amber-400"}`} />
                  <div className="min-w-0">
                    <div className="text-[11px] text-stone-500">{SOURCE_LABEL[a.sourceType] ?? a.sourceType}{a.salesOrderDocNumber ? ` · ${a.salesOrderDocNumber}` : ""}</div>
                    <div className="text-[12.5px] text-stone-200 leading-snug">{a.message}</div>
                  </div>
                </div>
              ))}
              <Link href="/accounting/reports/delivery-risk" onClick={() => setOpen(false)}
                className="block px-3 pt-2 mt-1 border-t border-stone-800 text-[12px] text-sky-400 hover:text-sky-300">
                View all in Delivery Risk →
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
