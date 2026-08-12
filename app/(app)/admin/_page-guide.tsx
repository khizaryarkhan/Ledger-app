"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { HelpCircle, X, BookOpen } from "lucide-react";
import { guideForPath } from "@/lib/admin/page-guides";

const SEEN_KEY = "pa-page-guides-seen";
const html = (s: string) => ({ __html: s });

export function PageGuide() {
  const pathname = usePathname() || "";
  const guide = guideForPath(pathname);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(true);   // assume seen until we read storage (no flash)

  useEffect(() => {
    if (!guide) return;
    try {
      const list: string[] = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]");
      setSeen(list.includes(guide.title));
    } catch { setSeen(true); }
  }, [guide?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!guide) return null;

  const markSeen = () => {
    try {
      const list: string[] = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]");
      if (!list.includes(guide.title)) localStorage.setItem(SEEN_KEY, JSON.stringify([...list, guide.title]));
    } catch { /* ignore */ }
    setSeen(true);
  };
  const openGuide = () => { setOpen(true); markSeen(); };

  return (
    <>
      <button onClick={openGuide} title="How to use this page"
        className="relative h-9 px-3 rounded-xl inline-flex items-center gap-1.5 text-[12.5px] text-stone-300 hover:text-white transition-colors"
        style={{ background: "#111726", border: "0.5px solid #202A3E" }}>
        <HelpCircle size={14} className="text-stone-400" /> Guide
        {!seen && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-[#0B0E15] animate-pulse" />}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative w-full max-w-md h-full overflow-y-auto shadow-2xl" style={{ background: "#0E1320", borderLeft: "0.5px solid #202A3E" }} onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 flex items-center justify-between px-5 py-4" style={{ background: "#0E1320", borderBottom: "0.5px solid #202A3E" }}>
              <div className="flex items-center gap-2">
                <HelpCircle size={16} className="text-emerald-400" />
                <h2 className="font-semibold text-white text-[15px]">{guide.title}</h2>
              </div>
              <button onClick={() => setOpen(false)} className="p-1 rounded text-stone-400 hover:text-white hover:bg-stone-800"><X size={16} /></button>
            </div>

            <div className="px-5 py-4 space-y-5">
              <p className="text-[13.5px] text-stone-300 leading-relaxed" dangerouslySetInnerHTML={html(guide.intro)} />

              {guide.steps?.length ? (
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-2">How to use it</div>
                  <ol className="space-y-2">
                    {guide.steps.map((s, i) => (
                      <li key={i} className="flex gap-2.5 text-[13px] text-stone-300">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-400 text-[11px] font-semibold flex items-center justify-center">{i + 1}</span>
                        <span dangerouslySetInnerHTML={html(s)} />
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}

              {guide.tips?.length ? (
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-2">Tips</div>
                  <ul className="space-y-1.5">
                    {guide.tips.map((t, i) => (
                      <li key={i} className="flex gap-2 text-[12.5px] text-stone-400">
                        <span className="text-emerald-400">•</span><span dangerouslySetInnerHTML={html(t)} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <Link href="/admin/guide" onClick={() => setOpen(false)}
                className="inline-flex items-center gap-1.5 text-[12.5px] text-emerald-400 hover:text-emerald-300">
                <BookOpen size={14} /> Open the full guide
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
