"use client";

/**
 * Printable ledger document — Invoice, Sales receipt, Credit note, Refund,
 * Bill, Expense, Supplier credit. Kept at this path because existing links
 * point here; the heading and party wording follow the document's real type.
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PrintDocumentSheet } from "@/components/print-document";
import type { PrintDocument } from "@/lib/accounting/document-print";

export default function PrintLedgerDocumentPage() {
  const id = String(useParams().id || "");
  const [data, setData] = useState<PrintDocument | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`/api/print/document?kind=ledger&id=${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(d => { if (d?.doc) setData(d); else setErr(d?.error || "Document not found"); })
      .catch(() => setErr("Could not load this document"));
  }, [id]);

  // Open the print dialog once the sheet has actually rendered.
  useEffect(() => { if (data) { const t = setTimeout(() => window.print(), 500); return () => clearTimeout(t); } }, [data]);

  if (err) return <div style={{ padding: 40, fontFamily: "system-ui" }}>{err}</div>;
  if (!data) return <div style={{ padding: 40, fontFamily: "system-ui", color: "#6b7280" }}>Loading…</div>;
  return <PrintDocumentSheet data={data} />;
}
