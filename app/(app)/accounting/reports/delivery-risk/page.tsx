import { Suspense } from "react";
import { DeliveryRiskReport } from "@/components/delivery-risk-report";

export default function DeliveryRiskPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-stone-500">Loading…</div>}>
      <DeliveryRiskReport />
    </Suspense>
  );
}
