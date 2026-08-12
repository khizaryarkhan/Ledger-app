/**
 * Lightweight spam heuristics for the public lead-capture form. Conservative by
 * design — real leads score ~0, so a high threshold drops obvious bot spam
 * (random-string names, letters-in-phone, gmail dot-trick emails, single-token
 * gibberish messages) without risking genuine submissions. Reusable for a
 * cleanup tool over existing leads.
 */

// A single long letters-only token with an unnatural vowel distribution or lots
// of case flips — i.e. machine-generated, not a real name/word.
export function isGibberish(s?: string | null): boolean {
  const t = (s ?? "").trim();
  if (!t || t.includes(" ")) return false;      // multi-word is fine
  if (t.length < 10) return false;
  if (!/^[A-Za-z]+$/.test(t)) return false;      // pure letters only
  const vowels = (t.match(/[aeiou]/gi) || []).length;
  const ratio = vowels / t.length;
  const caseSwitches = (t.match(/[a-z][A-Z]|[A-Z][a-z]/g) || []).length;
  return ratio < 0.22 || ratio > 0.55 || caseSwitches >= 4;
}

export interface SpamFields {
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  message?: string | null;
  companyName?: string | null;
}

export function spamScore(f: SpamFields): number {
  let score = 0;
  if (isGibberish(f.fullName)) score += 2;
  if (isGibberish(f.companyName)) score += 1;
  if (isGibberish(f.message)) score += 1;
  // A phone with a run of letters is never a phone number.
  if (f.phone && /[A-Za-z]{4,}/.test(f.phone)) score += 2;
  // Gmail dot-trick: many dots in the local part to fan one inbox into "unique" addresses.
  const local = (f.email || "").split("@")[0] || "";
  if ((local.match(/\./g) || []).length >= 3) score += 1;
  // A message that's one random alphanumeric token (no spaces) — filler.
  if (f.message && /^[A-Za-z0-9]{6,}$/.test(f.message.trim())) score += 1;
  return score;
}

/** Reject at >=4: both observed spam samples score 4–6; genuine leads score 0–2. */
export function looksLikeSpam(f: SpamFields): { spam: boolean; score: number } {
  const score = spamScore(f);
  return { spam: score >= 4, score };
}
