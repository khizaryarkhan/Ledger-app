/**
 * Display formatting. Deliberately mirrors the web app's `lib/format.ts`:
 * money is rounded to whole units for scannability, and dates render as
 * "3 Mar 26" so a row fits on a phone.
 */

export function money(amount: number | null | undefined, currency?: string | null): string {
  const n = Number(amount ?? 0);
  const rounded = Math.round(n);
  try {
    return new Intl.NumberFormat("en-IE", {
      style: "currency", currency: currency || "EUR",
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(rounded);
  } catch {
    // Unknown/empty currency code — never let a bad code blank out a figure.
    return `${currency ?? ""} ${rounded.toLocaleString("en-IE")}`.trim();
  }
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

/** ISO date `days` from today — the promise-date quick chips. */
export function isoInDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Last day of the current month, the most common promise ("end of month"). */
export function endOfMonthIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

/** "+42d" for an overdue invoice, "in 5d" for one that isn't yet due. */
export function overdueLabel(days: number): string {
  if (days > 0) return `${days}d overdue`;
  if (days === 0) return "due today";
  return `due in ${Math.abs(days)}d`;
}
