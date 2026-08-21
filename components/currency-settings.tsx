"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { Coins, Check, Loader, Lock } from "lucide-react";
import { CURRENCIES } from "@/lib/accounting/currencies";

// Home currency + multi-currency toggle. The home currency is the base your
// books are kept in; enabling multi-currency lets transactions be entered in
// foreign currencies with an exchange rate (QuickBooks-style).
export function CurrencySettings() {
  const [home, setHome] = useState("");
  const [mc, setMc] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/org/settings").then(r => r.json()).then((o) => {
      setHome(o.currency || "PKR"); setMc(!!o.multicurrencyEnabled);
    }).finally(() => setLoaded(true));
  }, []);

  async function save(patch: Record<string, any>) {
    setBusy(true); setSaved(false);
    try {
      const res = await fetch("/api/org/settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 1800); }
    } finally { setBusy(false); }
  }

  const options = CURRENCIES.some(c => c.code === home) ? CURRENCIES : [{ code: home, name: home }, ...CURRENCIES];

  return (
    <Card className="p-5 mb-4">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-stone-800 flex items-center justify-center shrink-0">
          <Coins size={18} className="text-stone-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-sm font-semibold text-white">Currency</h3>
            {busy && <Loader size={13} className="text-stone-500 animate-spin" />}
            {saved && <span className="text-[11px] text-emerald-400 inline-flex items-center gap-1"><Check size={12} /> Saved</span>}
          </div>
          <p className="text-[12px] text-stone-400 mb-4">Your home currency and whether foreign‑currency transactions are allowed.</p>

          {!loaded ? (
            <div className="text-[12px] text-stone-500 flex items-center gap-2"><Loader size={13} className="animate-spin" /> Loading…</div>
          ) : (
            <div className="space-y-4 max-w-md">
              <label className="block">
                <span className="block text-[12px] font-medium text-stone-300 mb-1">Home currency</span>
                <select
                  value={home}
                  disabled={mc}
                  onChange={(e) => { setHome(e.target.value); save({ currency: e.target.value }); }}
                  className="block w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-100 disabled:opacity-60 disabled:cursor-not-allowed">
                  {options.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
                </select>
                {mc ? (
                  <span className="block text-[11px] text-amber-500/90 mt-1 inline-flex items-center gap-1"><Lock size={11} /> Locked — the home currency can't change once multi‑currency is on, so historical exchange rates stay valid.</span>
                ) : (
                  <span className="block text-[11px] text-stone-500 mt-1">The base currency your ledger and financial statements are kept in. Set this before entering transactions — <b>it becomes permanent once you enable multi‑currency below.</b></span>
                )}
              </label>

              <button
                type="button"
                onClick={() => {
                  const v = !mc;
                  if (v && !confirm("Enable multi-currency?\n\nOnce enabled, your home currency (" + home + ") becomes permanent and can't be changed — this keeps every stored exchange rate valid. Continue?")) return;
                  setMc(v); save({ multicurrencyEnabled: v });
                }}
                className="flex items-center gap-3 group">
                <span className={`relative w-9 h-5 rounded-full transition-colors ${mc ? "bg-emerald-600" : "bg-stone-700"}`}>
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${mc ? "translate-x-4" : ""}`} />
                </span>
                <span className="text-left">
                  <span className="block text-[13px] font-medium text-stone-200">Enable multi‑currency</span>
                  <span className="block text-[11px] text-stone-500">Assign currencies to customers &amp; suppliers and enter foreign‑currency transactions with exchange rates.</span>
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
