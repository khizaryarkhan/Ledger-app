"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { FinancialYearSettings } from "@/components/financial-year-settings";

export default function FinancialYearSettingsPage() {
  return (
    <div className="p-6 max-w-[680px] mx-auto">
      <Link href="/settings" className="inline-flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-300 mb-6 transition-colors">
        <ArrowLeft size={13} /> Back to Settings
      </Link>

      <div className="mb-6">
        <h1 className="text-base font-semibold text-white">Financial year &amp; period close</h1>
        <p className="text-xs text-stone-500 mt-0.5">
          When your fiscal year starts, and the lock date before which entries can no longer be posted or edited.
        </p>
      </div>

      <FinancialYearSettings />
    </div>
  );
}
