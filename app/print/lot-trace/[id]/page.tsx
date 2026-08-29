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

  useEffect(() => { if (data) { const t = setTimeout(() => window.print(), 500); return () => clearTimeout(t); } }, [data]);

  if (err) return <div style={{ padding: 40, fontFamily: "system-ui" }}>{err}</div>;
  if (!data) return <div style={{ padding: 40, fontFamily: "system-ui", color: "#6b7280" }}>Loading…</div>;
  return <LotTracePrintSheet data={data} />;
}
