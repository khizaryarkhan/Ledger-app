"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { LotTracePrintSheet } from "@/components/lot-trace-print";

export default function PrintLotTracePage() {
  const id = String(useParams().id || "");
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`/api/inventory/lots/${id}/trace-report`)
      .then(r => r.json())
      .then(d => { if (d?.lot) setData(d); else setErr(d?.error || "Lot not found"); })
      .catch(() => setErr("Could not load this report"));
  }, [id]);

  useEffect(() => {
    if (!data) return;
    // A fixed delay before printing is fragile — a report this size (many
    // raw materials/processing rows) can still be mid-layout at 500ms on a
    // slower machine, so the captured PDF can come out truncated even though
    // the on-screen view (given more time to settle) looks complete. Two
    // nested rAFs guarantee at least one full paint has actually happened
    // before we print, regardless of how large the report is.
    let cancelled = false;
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => { if (!cancelled) window.print(); });
    });
    return () => { cancelled = true; cancelAnimationFrame(raf1); };
  }, [data]);

  if (err) return <div style={{ padding: 40, fontFamily: "system-ui" }}>{err}</div>;
  if (!data) return <div style={{ padding: 40, fontFamily: "system-ui", color: "#6b7280" }}>Loading…</div>;
  return <LotTracePrintSheet data={data} />;
}
