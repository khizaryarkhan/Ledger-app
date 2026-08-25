/**
 * Amount in words — a statutory requirement on invoices in many jurisdictions
 * (and a fraud control everywhere: the figure can be altered, the words are
 * much harder to). Short-scale English, e.g.
 *   1440.5, "EUR", "Cent" → "One thousand four hundred forty euro and fifty cents only"
 */

const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES: [number, string][] = [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"]];

function underThousand(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} hundred`); n %= 100; }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "")); }
  else if (n > 0) parts.push(ONES[n]);
  return parts.join(" ");
}

function whole(n: number): string {
  if (n === 0) return "zero";
  const parts: string[] = [];
  for (const [value, label] of SCALES) {
    if (n >= value) { parts.push(`${underThousand(Math.floor(n / value))} ${label}`); n %= value; }
  }
  if (n > 0) parts.push(underThousand(n));
  return parts.join(" ");
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * `currencyLabel` is what to call a whole unit (e.g. "euro", "US dollars"),
 * `minorLabel` a hundredth (e.g. "cents"). Falls back to the plain code when a
 * currency isn't in the table, which still reads correctly ("… PKR and 50/100").
 */
export function amountInWords(amount: number, currencyCode?: string | null): string {
  const negative = amount < 0;
  const abs = Math.abs(Math.round((Number(amount) || 0) * 100) / 100);
  const units = Math.floor(abs);
  const minor = Math.round((abs - units) * 100);

  const names = CURRENCY_WORDS[(currencyCode ?? "").toUpperCase()];
  const unitLabel = names?.[0] ?? (currencyCode || "").toUpperCase();
  const minorLabel = names?.[1] ?? null;

  let out = `${whole(units)}${unitLabel ? ` ${unitLabel}` : ""}`;
  if (minor > 0) {
    out += minorLabel ? ` and ${whole(minor)} ${minorLabel}` : ` and ${minor}/100`;
  }
  return `${negative ? "Minus " : ""}${cap(out.trim())} only`;
}

// Plural forms — documents always state a total, which reads as plural except
// for exactly one unit, and "one euros" is worse than always-plural here.
const CURRENCY_WORDS: Record<string, [string, string]> = {
  USD: ["US dollars", "cents"], EUR: ["euro", "cents"], GBP: ["pounds sterling", "pence"],
  PKR: ["rupees", "paisa"], INR: ["rupees", "paise"], AED: ["dirhams", "fils"],
  SAR: ["riyals", "halalas"], CAD: ["Canadian dollars", "cents"], AUD: ["Australian dollars", "cents"],
  CHF: ["francs", "centimes"], JPY: ["yen", "sen"], CNY: ["yuan", "fen"],
  ZAR: ["rand", "cents"], NGN: ["naira", "kobo"], KES: ["shillings", "cents"],
  SGD: ["Singapore dollars", "cents"], MYR: ["ringgit", "sen"], BDT: ["taka", "poisha"],
  LKR: ["rupees", "cents"], TRY: ["lira", "kurus"], NZD: ["New Zealand dollars", "cents"],
};
