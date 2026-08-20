"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Settings, BookOpen } from "lucide-react";

// Configure menu — the gear in the top bar. Settings + Help & Guide moved here
// from the sidebar footer so it's the same, out-of-the-way place in every module.
export function ConfigMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} title="Settings & help"
        className="p-1.5 rounded-md hover:bg-stone-800 text-stone-500 hover:text-stone-200 transition-colors">
        <Settings size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 bg-stone-900 border border-stone-700 rounded-xl shadow-2xl shadow-black/50 py-1 min-w-[180px]">
          <Link href="/settings" onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-stone-200 hover:bg-stone-800 hover:text-white transition-colors">
            <Settings size={14} className="text-stone-500" /> Settings
          </Link>
          <Link href="/guide" onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-stone-200 hover:bg-stone-800 hover:text-white transition-colors">
            <BookOpen size={14} className="text-stone-500" /> Help &amp; Guide
          </Link>
        </div>
      )}
    </div>
  );
}
