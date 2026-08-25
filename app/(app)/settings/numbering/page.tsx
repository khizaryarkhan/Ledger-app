"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { NumberingSettings } from "@/components/numbering-settings";

export default function NumberingSettingsPage() {
  return (
    <div className="p-6 max-w-[860px] mx-auto">
      <Link href="/settings" className="inline-flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-300 mb-6 transition-colors">
        <ArrowLeft size={13} /> Back to Settings
      </Link>

      <div className="mb-6">
        <h1 className="text-base font-semibold text-white">Transaction numbers</h1>
        <p className="text-xs text-stone-500 mt-0.5">
          The prefix, next number and padding for each document series — invoices, bills, payments, journals and more.
        </p>
      </div>

      <NumberingSettings />
    </div>
  );
}
