"use client";

/**
 * Delivery Risk — every open Job Work / Purchase Order / Manufacturing Order
 * currently flagged by the supplyChainWatchdog cron (inngest/functions/
 * chase.ts) as running past its expected date, grouped by the Sales Order
 * it's for. Reads the same /api/inventory/alerts list the header bell and
 * the Order Production Tracker's per-step badges read.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { ReportShell } from "@/components/ui";

const SOURCE_LABEL: Record<string, string> = { jobwork: "Job Work", po: "Purchase Order", mo: "Manufacturing Order" };

export function DeliveryRiskReport() {
  const [alerts, setAlerts] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const d = await fetch(`/api/inventory/alerts`).then(r => r.json()).catch(() => null);
    setAlerts(Array.isArray(d?.alerts) ? d.alerts : []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const groups = new Map<string, { label: string; href: string | null; alerts: any[] }>();
  for (const a of alerts ?? []) {
    const key = a.salesOrderId ?? "unlinked";
    if (!groups.has(key)) {
      groups.set(key, {
        label: a.salesOrderDocNumber ?? "Not linked to a Sales Order",
        href: a.salesOrderId ? `/accounting/trade/sales-orders/${a.salesOrderId}` : null,
        alerts: [],
      });
    }
    groups.get(key)!.alerts.push(a);
  }

  return (
    <ReportShell title="Delivery Risk" sub="Job Work, Purchase Orders and Manufacturing Orders currently running past their expected date, grouped by the Sales Order they're for." icon={AlertTriangle} onRefresh={load} loading={loading}>
      {(!alerts || alerts.length === 0) ? (
        <div className="rounded-xl border border-dashed border-stone-800 p-10 text-center text-stone-500 text-sm">
          {loading ? "Loading…" : "Nothing at risk right now — every open step is within its expected date."}
        </div>
      ) : (
        <div className="space-y-4">
          {[...groups.entries()].map(([key, g]) => (
            <div key={key} className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-800 bg-stone-950/40">
                {g.href ? (
                  <Link href={g.href} className="text-[13px] font-semibold text-sky-400 hover:text-sky-300">{g.label} →</Link>
                ) : (
                  <span className="text-[13px] font-semibold text-stone-300">{g.label}</span>
                )}
                <span className="text-[11px] text-stone-500">{g.alerts.length} at risk</span>
              </div>
              <div className="divide-y divide-stone-800/60">
                {g.alerts.map((a: any) => (
                  <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                    <AlertTriangle size={13} className={a.severity === "critical" ? "text-rose-400" : "text-amber-400"} />
                    <span className="text-[11px] font-medium text-stone-500 w-40 shrink-0">{SOURCE_LABEL[a.sourceType] ?? a.sourceType}</span>
                    <span className="font-mono text-[12px] text-stone-300 w-28 shrink-0">{a.sourceDocNumber ?? "—"}</span>
                    <span className="text-[12.5px] text-stone-300">{a.message}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </ReportShell>
  );
}
