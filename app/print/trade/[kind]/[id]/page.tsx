"use client";

/** Printable Quote / Purchase Order / Sales Order — the documents that get sent
 *  to a customer or supplier. Same sheet as ledger documents. */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PrintDocumentSheet } from "@/components/print-document";
import type { PrintDocument } from "@/lib/accounting/document-print";

export default function PrintTradeDocumentPage() {
  const id = String(useParams().id || "");
  const [data, setData] = useState<PrintDocument | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`/api/print/document?kind=trade&id=${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(d => { if (d?.doc) setData(d); else setErr(d?.error || "Document not found"); })
      .catch(() => setErr("Could not load this document"));
  }, [id]);

  useEffect(() => { if (data) { const t = setTimeout(() => window.print(), 500); return () => clearTimeout(t); } }, [data]);

  if (err) return <div style={{ padding: 40, fontFamily: "system-ui" }}>{err}</div>;
  if (!data) return <div style={{ padding: 40, fontFamily: "system-ui", color: "#6b7280" }}>Loading…</div>;
  return <PrintDocumentSheet data={data} />;
}
