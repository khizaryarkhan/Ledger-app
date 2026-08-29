import { Suspense } from "react";
import { LotTraceabilityReport } from "@/components/lot-traceability-report";

export default function LotTraceabilityPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-stone-500">Loading…</div>}>
      <LotTraceabilityReport />
    </Suspense>
  );
}
