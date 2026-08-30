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

  // Print is triggered by LotTracePrintSheet itself, once it has measured its
  // own rendered height and the @page rule sized to that height is committed
  // to the DOM — printing from here (before that measurement) would capture
  // the fallback multi-page A4 layout instead of the final single-page one.

  if (err) return <div style={{ padding: 40, fontFamily: "system-ui" }}>{err}</div>;
  if (!data) return <div style={{ padding: 40, fontFamily: "system-ui", color: "#6b7280" }}>Loading…</div>;
  return <LotTracePrintSheet data={data} />;
}
