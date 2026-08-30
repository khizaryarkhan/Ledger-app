import { Suspense } from "react";
import { JobWorkYieldReport } from "@/components/jobwork-yield-report";

export default function JobWorkYieldPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-stone-500">Loading…</div>}>
      <JobWorkYieldReport />
    </Suspense>
  );
}
