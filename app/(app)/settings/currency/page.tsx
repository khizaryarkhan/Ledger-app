"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CurrencySettings } from "@/components/currency-settings";

export default function CurrencySettingsPage() {
  return (
    <div className="p-6 max-w-[680px] mx-auto">
      <Link href="/settings" className="inline-flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-300 mb-6 transition-colors">
        <ArrowLeft size={13} /> Back to Settings
      </Link>

      <div className="mb-6">
        <h1 className="text-base font-semibold text-white">Currency</h1>
        <p className="text-xs text-stone-500 mt-0.5">
          The home currency your books are kept in, and whether transactions may be entered in foreign currencies.
        </p>
      </div>

      <CurrencySettings />
    </div>
  );
}
