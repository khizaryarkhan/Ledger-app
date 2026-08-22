"use client";

/**
 * Global ⌘K search — a spotlight palette over every org entity. Debounced,
 * grouped, fully keyboard-navigable (↑/↓/Enter, Esc). Opens with ⌘K / Ctrl-K
 * or the header trigger. Results deep-link to the right module.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader, CornerDownLeft, Users, Building2, Contact, BookOpen, Package, FileText, ShoppingCart, Receipt } from "lucide-react";

const GROUP_ICON: Record<string, any> = {
  "Customers": Users, "Suppliers": Building2, "Employees": Contact,
  "Chart of Accounts": BookOpen, "Products & Services": Package,
  "Transactions": Receipt, "Estimates & POs": FileText, "Invoices (AR)": FileText,
};

type Hit = { group: string; type: string; id: string; title: string; subtitle: string | null; href: string };

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState<{ group: string; hits: Hit[] }[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqId = useRef(0);

  // ⌘K / Ctrl-K to open.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(o => !o); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  useEffect(() => { if (open) { setTimeout(() => inputRef.current?.focus(), 20); } else { setQ(""); setGroups([]); setSel(0); } }, [open]);

  // Debounced search.
  useEffect(() => {
    if (q.trim().length < 2) { setGroups([]); setLoading(false); return; }
    setLoading(true);
    const id = ++reqId.current;
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`).then(r => r.json()).then(d => {
        if (id !== reqId.current) return; // ignore stale
        setGroups(Array.isArray(d?.groups) ? d.groups : []); setSel(0);
      }).catch(() => setGroups([])).finally(() => { if (id === reqId.current) setLoading(false); });
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  const flat = useMemo(() => groups.flatMap(g => g.hits), [groups]);

  function go(hit: Hit) { setOpen(false); router.push(hit.href); }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel(s => Math.min(s + 1, flat.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
    else if (e.key === "Enter" && flat[sel]) { e.preventDefault(); go(flat[sel]); }
  }

  return (
    <>
      {/* Header trigger */}
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-2 h-7 pl-2.5 pr-2 rounded-md bg-stone-900 border border-stone-800 text-stone-500 hover:border-stone-600 hover:text-stone-300 transition-colors min-w-[180px] md:min-w-[280px]">
        <Search size={13} />
        <span className="text-[12px] flex-1 text-left">Search everything…</span>
        <kbd className="hidden md:inline text-[10px] font-sans bg-stone-800 border border-stone-700 rounded px-1.5 py-0.5 text-stone-500">⌘K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative w-full max-w-2xl bg-stone-900 border border-stone-700 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-800">
              {loading ? <Loader size={16} className="animate-spin text-stone-500" /> : <Search size={16} className="text-stone-500" />}
              <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
                placeholder="Search customers, suppliers, invoices, accounts, TXN-000123…"
                className="flex-1 bg-transparent text-sm text-stone-100 placeholder-stone-600 outline-none" />
              <kbd className="text-[10px] bg-stone-800 border border-stone-700 rounded px-1.5 py-0.5 text-stone-500">Esc</kbd>
            </div>

            {/* Results */}
            <div className="max-h-[60vh] overflow-y-auto py-2">
              {q.trim().length < 2 ? (
                <div className="px-4 py-8 text-center text-[13px] text-stone-500">Type at least 2 characters to search across everything in your books.</div>
              ) : !loading && flat.length === 0 ? (
                <div className="px-4 py-8 text-center text-[13px] text-stone-500">No matches for “{q}”.</div>
              ) : (
                groups.map(g => {
                  const Icon = GROUP_ICON[g.group] || FileText;
                  return (
                    <div key={g.group} className="mb-1">
                      <div className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-stone-600">{g.group}</div>
                      {g.hits.map(hit => {
                        const idx = flat.indexOf(hit);
                        const active = idx === sel;
                        return (
                          <button key={hit.type + hit.id} onMouseEnter={() => setSel(idx)} onClick={() => go(hit)}
                            className={`w-full flex items-center gap-3 px-4 py-2 text-left ${active ? "bg-stone-800" : "hover:bg-stone-800/50"}`}>
                            <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${active ? "bg-teal-500/20 text-teal-300" : "bg-stone-800 text-stone-500"}`}><Icon size={14} /></div>
                            <div className="min-w-0 flex-1">
                              <div className="text-[13px] text-stone-100 truncate">{hit.title}</div>
                              {hit.subtitle && <div className="text-[11px] text-stone-500 truncate">{hit.subtitle}</div>}
                            </div>
                            {active && <CornerDownLeft size={13} className="text-stone-500 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
