// Deterministic quote verification (CLAUDE.md, non-negotiable 1). Code, not a model, decides
// whether a quote is really in the message it cites. Mirrored in SQL by app.norm_quote().

const QUOTE_CHARS: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'",
  "“": '"', "”": '"', "„": '"', "‟": '"',
  "–": "-", "—": "-", "−": "-",
};

/** NFKC, typographic quotes and dashes to ASCII, lower case, whitespace collapsed. */
export function normaliseForQuote(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’‚‛“”„‟–—−]/g, (c) => QUOTE_CHARS[c])
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Shortest acceptable quote, so that "I" or "ok" cannot "verify" against any message. */
export const MIN_QUOTE_CHARS = 12;

export type QuoteCheck = { ok: true } | { ok: false; reason: "quote_too_short" | "quote_not_found" };

export function verifyQuote(quote: string, eventText: string): QuoteCheck {
  const q = normaliseForQuote(quote);
  const t = normaliseForQuote(eventText);
  if (q.length < Math.min(MIN_QUOTE_CHARS, t.length) || q.length === 0) return { ok: false, reason: "quote_too_short" };
  return t.includes(q) ? { ok: true } : { ok: false, reason: "quote_not_found" };
}

// Capitalised words that commonly start or fill a note without naming anyone.
const NOTE_WORDS = new Set(
  `a an the this that these those it its they them their he she his her we our you your i ask get book send make check keep do
  don't need needs must should contact before after only if when apply talk remind note watch confirm collect pay return submit
  bring use plan start call email message follow wait from with for and or but not no yes also once until by on in at to of`.split(/\s+/),
);

/**
 * A context note is stored at the level of the one message it cites, but the model wrote it
 * having seen other messages too. So a note may not name a person, organisation or number
 * that is absent from that message (and from the obligation it is attached to).
 */
export function noteGrounded(note: string, eventText: string, targetText: string): boolean {
  const known = normaliseForQuote(`${eventText} ${targetText}`);
  const knownDigits = known.replace(/[,\s]/g, "");
  for (const m of note.matchAll(/[\p{Lu}][\p{L}'.-]*|\d[\d,.]*/gu)) {
    const w = m[0].replace(/[.,']+$/, "");
    if (/^\d/.test(w)) {
      if (!knownDigits.includes(w.replace(/,/g, ""))) return false;
      continue;
    }
    const lower = w.toLowerCase();
    if (NOTE_WORDS.has(lower) || lower.length < 2) continue;
    if (!known.includes(lower)) return false;
  }
  return true;
}
