import { Suspense } from "react";
import { StockValuationReport } from "@/components/stock-reports";

export default function StockValuationPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-stone-500">Loading…</div>}>
      <StockValuationReport />
    </Suspense>
  );
}
